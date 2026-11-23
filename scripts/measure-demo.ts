/**
 * Mede a página pública num build de PRODUÇÃO com o perfil "4G lento" do DevTools
 * (ou "4G rápido" com --network fast4g).
 *
 *   pnpm --filter @vidomo/web build && pnpm --filter @vidomo/web exec next start -p 3100
 *   pnpm measure [--url …/e/residencial-vista] [--runs 3] [--network slow4g|fast4g] [--browser <exe>]
 *
 * Usa o Chrome/Edge instalado (puppeteer-core, sem baixar navegador) e o protocolo do
 * DevTools (CDP) para aplicar o mesmo throttling do menu "Slow 4G", cache desligado,
 * tela de celular 360×800 @2x.
 *
 * Métricas por execução:
 *   - FCP: tempo até a página aparecer (nome, legenda e placeholder vêm no HTML)
 *   - prédio interativo: performance.mark('vidomo:viewer-ready') (onReady do <Viewer>,
 *     modelo leve na tela)
 *   - detalhes na tela: performance.mark('vidomo:detail-ready') (onDetailReady), se houver
 *   - JS por conteúdo: página (Next/React/componentes), viewer (three.js) e supabase-js
 *   - GLB leve e de detalhes: bytes transferidos
 *   - fps: quadros com desenho WebGL por segundo durante 3 s girando o prédio (com as
 *     duas camadas carregadas)
 *   - trocas (depois do fps): do toque no seletor até a câmera chegar
 *     (performance.mark('vidomo:view-settled'), já com a transição de 0,5 s):
 *     vista geral → bloco e bloco → andar (vários blocos), andar → andar (todos)
 *   - maquetes (Bloco 3): do toque até as maquetes do andar entrarem na tela
 *     (performance.mark('vidomo:interiors-ready')), na 1ª entrada e na troca de andar; fps
 *     girando no modo andar
 *   - "Ver apartamento": abre a página com ?u=<--unit>, espera a ficha (o GLB detalhado
 *     baixa em segundo plano), toca no botão e mede até o modelo na tela
 *     (performance.mark('vidomo:apartment-ready')); fps com o giro automático
 *   - GLBs por fase: leve e detalhes do prédio, maquetes (modo andar) e apartamento
 */
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import puppeteer, { type Browser, type CDPSession, type Page } from 'puppeteer-core';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3100/e/residencial-vista' },
    runs: { type: 'string', default: '3' },
    browser: { type: 'string' },
    network: { type: 'string', default: 'slow4g' },
    unit: { type: 'string', default: '802' },
    json: { type: 'boolean', default: false },
  },
});

/** Presets de rede do Chrome DevTools ("Slow 4G" e "Fast 4G"). */
const NETWORKS = {
  slow4g: {
    label: '4G lento',
    offline: false,
    latency: 150 * 3.75, // ms
    downloadThroughput: ((1.6 * 1000 * 1000) / 8) * 0.9, // bytes/s ≈ 1,44 Mbit/s
    uploadThroughput: ((750 * 1000) / 8) * 0.9,
  },
  fast4g: {
    label: '4G rápido',
    offline: false,
    latency: 60 * 2.75,
    downloadThroughput: ((9 * 1000 * 1000) / 8) * 0.9, // ≈ 8,1 Mbit/s
    uploadThroughput: ((1.5 * 1000 * 1000) / 8) * 0.9,
  },
} as const;

const networkKey = (values.network ?? 'slow4g') as keyof typeof NETWORKS;
if (!(networkKey in NETWORKS)) throw new Error('--network deve ser slow4g ou fast4g');
const { label: NETWORK_LABEL, ...NETWORK } = NETWORKS[networkKey];

const PROFILES = [
  { suffix: '', cpu: 1 },
  { suffix: ' + CPU 4× mais lenta', cpu: 4 },
] as const;

const BROWSER_CANDIDATES = [
  values.browser,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((p): p is string => !!p);

/**
 * Conta quadros em que o WebGL desenhou algo (o viewer usa frameloop "demand").
 * Em string: o tsx injeta helpers (__name) em funções, e eles não existem na página.
 */
const FRAME_COUNTER = `
  window.__drew = false;
  window.__drawFrames = 0;
  window.__countFrames = false;
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const orig = proto[fn];
      if (!orig) continue;
      proto[fn] = function (...args) { window.__drew = true; return orig.apply(this, args); };
    }
  }
  (function tick() {
    if (window.__countFrames && window.__drew) window.__drawFrames++;
    window.__drew = false;
    requestAnimationFrame(tick);
  })();
`;

interface RunResult {
  fcpMs: number;
  viewerReadyMs: number;
  /** null quando a página não tem modelo de detalhes. */
  detailReadyMs: number | null;
  /** JS da página (Next, React, componentes): o que a página precisa para aparecer. */
  pageJsBytes: number;
  /** Chunk do three.js / R3F / viewer. */
  viewerJsBytes: number;
  /** Chunk do supabase-js (tempo real), carregado sob demanda. */
  supabaseJsBytes: number;
  baseGlbBytes: number;
  detailGlbBytes: number;
  fps: number;
  /** GLBs das maquetes (modo andar) e do "Ver apartamento" transferidos. */
  interiorGlbBytes: number;
  apartmentGlbBytes: number;
  /** 1ª entrada num andar e troca de andar: até as maquetes entrarem na tela. */
  firstInteriorsMs: number | null;
  floorInteriorsMs: number | null;
  /** fps girando no modo andar (com as maquetes, se houver). */
  floorFps: number;
  /** "Ver apartamento": toque até o modelo detalhado na tela; fps com o giro. */
  apartmentMs: number | null;
  apartmentFps: number | null;
  renderer: string;
  /** Troca de vista pelo seletor (ms), null quando não se aplica (ex.: um bloco só). */
  towerSwitchMs: number | null;
  floorSwitchMs: number | null;
  floorToFloorMs: number | null;
}

/**
 * Toca no botão do seletor e espera a câmera chegar: a última marca 'vidomo:view-settled'
 * depois do toque, sem marca nova por 800 ms (abrir um bloco também muda a área livre e
 * pode reenquadrar). Em string pelo mesmo motivo do FRAME_COUNTER.
 */
interface SwitchResult {
  /** Câmera chegou (ms desde o toque). */
  settled: number;
  /** Maquetes do andar na tela (ms desde o toque); null se não houver maquetes. */
  interiors: number | null;
}

const SWITCH_TIMER = (selector: string) => `new Promise((resolve) => {
  const btn = document.querySelector(${JSON.stringify(selector)});
  if (!btn) return resolve(null);
  const before = performance.getEntriesByName('vidomo:view-settled').length;
  const beforeInt = performance.getEntriesByName('vidomo:interiors-ready').length;
  const t0 = performance.now();
  btn.click();
  let last = null;
  let lastSeen = performance.now();
  let interiors = null;
  const id = setInterval(() => {
    const marks = performance.getEntriesByName('vidomo:view-settled');
    if (marks.length > before && marks.at(-1).startTime !== last) {
      last = marks.at(-1).startTime;
      lastSeen = performance.now();
    }
    const im = performance.getEntriesByName('vidomo:interiors-ready');
    if (interiors === null && im.length > beforeInt) interiors = im.at(-1).startTime - t0;
    const quiet = performance.now() - lastSeen > 800;
    // Sem maquetes: até 3 s depois da câmera parar (empreendimento sem interior).
    const doneInt = interiors !== null || performance.now() - lastSeen > 3000;
    if ((last !== null && quiet && doneInt) || performance.now() - t0 > 15000) {
      clearInterval(id);
      resolve(last === null ? null : { settled: last - t0, interiors });
    }
  }, 20);
})`;

/** Toca em "Ver apartamento" e espera o modelo detalhado na tela (ms), ou null sem botão. */
const APARTMENT_TIMER = `new Promise((resolve) => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Ver apartamento'));
  if (!btn) return resolve(null);
  const t0 = performance.now();
  btn.click();
  const id = setInterval(() => {
    const m = performance.getEntriesByName('vidomo:apartment-ready');
    if (m.length) { clearInterval(id); resolve(m[0].startTime - t0); }
    else if (performance.now() - t0 > 20000) { clearInterval(id); resolve(null); }
  }, 20);
})`;

/** Quadros desenhados por segundo durante `ms` (sem interação). */
async function countFps(page: Page, ms: number): Promise<number> {
  await page.evaluate('window.__drawFrames = 0; window.__countFrames = true;');
  const start = Date.now();
  await new Promise((r) => setTimeout(r, ms));
  const frames = (await page.evaluate(
    'window.__countFrames = false; window.__drawFrames',
  )) as number;
  return frames / ((Date.now() - start) / 1000);
}

/** Gira com o mouse por ~3 s e conta quadros desenhados por segundo. */
async function dragFps(page: Page): Promise<number> {
  const box = await page.evaluate(() => {
    const r = document.querySelector('canvas')!.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.evaluate('window.__drawFrames = 0; window.__countFrames = true;');
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < 3000) {
    i++;
    await page.mouse.move(box.x + Math.sin(i / 10) * 120, box.y + Math.cos(i / 13) * 30);
    await new Promise((r) => setTimeout(r, 8));
  }
  const frames = (await page.evaluate(
    'window.__countFrames = false; window.__drawFrames',
  )) as number;
  await page.mouse.up();
  return frames / ((Date.now() - start) / 1000);
}

async function measureOnce(browser: Browser, url: string, cpu: number): Promise<RunResult> {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.emulate({
    viewport: { width: 360, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: false },
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; SM-A155M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  });

  const cdp: CDPSession = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', NETWORK);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });

  const requests = new Map<string, { url: string; type: string }>();
  const bytes = {
    page: 0,
    viewer: 0,
    supabase: 0,
    baseGlb: 0,
    detailGlb: 0,
    interiorGlb: 0,
    apartmentGlb: 0,
  };
  // Fase da medição: cada GLB conta na fase em que foi pedido pela primeira vez.
  let phase: 'building' | 'interiors' | 'apartment' = 'building';
  const seenGlb = new Set<string>();
  let glbCount = 0;
  let glbRequested = 0;
  cdp.on('Network.requestWillBeSent', (e) => {
    if (new URL(e.request.url).pathname.endsWith('.glb')) glbRequested++;
  });
  const pending: Promise<void>[] = [];
  cdp.on('Network.responseReceived', (e) =>
    requests.set(e.requestId, { url: e.response.url, type: e.type }),
  );
  cdp.on('Network.loadingFinished', (e) => {
    const r = requests.get(e.requestId);
    if (!r) return;
    const path = new URL(r.url).pathname;
    const size = e.encodedDataLength;
    if (path.endsWith('.glb')) {
      if (seenGlb.has(path)) return;
      seenGlb.add(path);
      // Prédio: o primeiro GLB é o leve (pré-carregado); os seguintes, detalhes. Depois,
      // maquetes (modo andar) e o apartamento.
      if (phase === 'interiors') bytes.interiorGlb += size;
      else if (phase === 'apartment') bytes.apartmentGlb += size;
      else if (glbCount++ === 0) bytes.baseGlb += size;
      else bytes.detailGlb += size;
    } else if (r.type === 'Script' && phase === 'building') {
      // JS só da primeira página (a do "Ver apartamento" recarrega a mesma página).
      // Classifica pelo conteúdo: os nomes dos chunks mudam a cada build.
      pending.push(
        cdp
          .send('Network.getResponseBody', { requestId: e.requestId })
          .then(({ body, base64Encoded }) => {
            const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
            if (text.includes('WebGLRenderer')) bytes.viewer += size;
            else if (text.includes('phx_join')) bytes.supabase += size;
            else bytes.page += size;
          })
          .catch(() => {
            bytes.page += size;
          }),
      );
    }
  });

  await page.evaluateOnNewDocument(FRAME_COUNTER);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => performance.getEntriesByName('vidomo:viewer-ready').length > 0, {
    timeout: 120_000,
    polling: 50,
  });

  // Dá tempo de o viewer pedir o GLB de detalhes, se houver, e espera ele entrar na tela.
  await new Promise((r) => setTimeout(r, 1500));
  let detailReadyMs: number | null = null;
  if (glbRequested > 1) {
    await page.waitForFunction(
      () => performance.getEntriesByName('vidomo:detail-ready').length > 0,
      { timeout: 180_000, polling: 100 },
    );
    detailReadyMs = await page.evaluate(
      () => performance.getEntriesByName('vidomo:detail-ready')[0]!.startTime,
    );
  }
  await new Promise((r) => setTimeout(r, 300));

  const timing = await page.evaluate(() => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? NaN;
    const ready = performance.getEntriesByName('vidomo:viewer-ready')[0]!.startTime;
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'desconhecido';
    return { fcp, ready, renderer };
  });

  // fps: gira o prédio por ~3 s com o mouse e conta quadros desenhados.
  const box = await page.evaluate(() => {
    const r = document.querySelector('canvas')!.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.evaluate('window.__drawFrames = 0; window.__countFrames = true;');
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < 3000) {
    i++;
    await page.mouse.move(box.x + Math.sin(i / 10) * 120, box.y + Math.cos(i / 13) * 30);
    await new Promise((r) => setTimeout(r, 8));
  }
  const frames = (await page.evaluate(
    'window.__countFrames = false; window.__drawFrames',
  )) as number;
  const elapsed = (Date.now() - start) / 1000;
  await page.mouse.up();

  // Trocas de vista pelo seletor (depois de soltar o mouse e a câmera parar).
  await new Promise((r) => setTimeout(r, 1200));
  phase = 'interiors';
  const many = await page.evaluate(() => !!document.querySelector('nav[aria-label="Blocos"]'));
  let towerSwitchMs: number | null = null;
  let floorSwitchMs: number | null = null;
  let floorSwitch: SwitchResult | null = null;
  if (many) {
    // Um bloco do meio da lista, e o andar mais alto dele.
    towerSwitchMs =
      (
        (await page.evaluate(
          SWITCH_TIMER('nav[aria-label="Blocos"] button[data-tower]:nth-of-type(9)'),
        )) as SwitchResult | null
      )?.settled ?? null;
    floorSwitch = (await page.evaluate(
      SWITCH_TIMER('nav[aria-label^="Andares do"] button[data-floor]'),
    )) as SwitchResult | null;
    floorSwitchMs = floorSwitch?.settled ?? null;
  }
  // Andar → andar: o seguinte (mais baixo) na lista. Junto, o tempo até as maquetes.
  const floorSel = many ? 'nav[aria-label^="Andares do"]' : 'nav[aria-label="Andares"]';
  let firstInteriorsMs: number | null = null;
  if (!many) {
    const first = (await page.evaluate(
      SWITCH_TIMER(`${floorSel} button[data-floor]`),
    )) as SwitchResult | null;
    firstInteriorsMs = first?.interiors ?? null;
  } else {
    firstInteriorsMs = floorSwitch?.interiors ?? null;
  }
  const floorToFloor = (await page.evaluate(
    SWITCH_TIMER(`${floorSel} button[data-floor][aria-pressed="true"] + button[data-floor]`),
  )) as SwitchResult | null;
  const floorToFloorMs = floorToFloor?.settled ?? null;
  const floorInteriorsMs = floorToFloor?.interiors ?? null;
  await new Promise((r) => setTimeout(r, 800));
  const floorFps = await dragFps(page);

  // "Ver apartamento": a ficha da unidade (o GLB detalhado baixa em segundo plano), toque
  // no botão e espera o modelo na tela.
  phase = 'apartment';
  let apartmentMs: number | null = null;
  let apartmentFps: number | null = null;
  const unitUrl = new URL(url);
  unitUrl.searchParams.set('u', values.unit!);
  await page.goto(unitUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => performance.getEntriesByName('vidomo:viewer-ready').length > 0, {
    timeout: 120_000,
    polling: 50,
  });
  // Tempo de leitura da ficha antes do toque (o pré-carregamento acontece aqui).
  await new Promise((r) => setTimeout(r, 2500));
  apartmentMs = (await page.evaluate(APARTMENT_TIMER)) as number | null;
  if (apartmentMs !== null) {
    await new Promise((r) => setTimeout(r, 800));
    apartmentFps = await countFps(page, 3000);
  }

  await Promise.all(pending);
  await context.close();
  return {
    fcpMs: timing.fcp,
    viewerReadyMs: timing.ready,
    detailReadyMs,
    pageJsBytes: bytes.page,
    viewerJsBytes: bytes.viewer,
    supabaseJsBytes: bytes.supabase,
    baseGlbBytes: bytes.baseGlb,
    detailGlbBytes: bytes.detailGlb,
    fps: frames / elapsed,
    interiorGlbBytes: bytes.interiorGlb,
    apartmentGlbBytes: bytes.apartmentGlb,
    firstInteriorsMs,
    floorInteriorsMs,
    floorFps,
    apartmentMs,
    apartmentFps,
    renderer: timing.renderer,
    towerSwitchMs,
    floorSwitchMs,
    floorToFloorMs,
  };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;
const sec = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

async function main() {
  const executablePath = BROWSER_CANDIDATES.find((p) => existsSync(p));
  if (!executablePath) throw new Error('Chrome/Edge não encontrado. Use --browser <caminho>.');

  const url = values.url!;
  const runs = Number(values.runs);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });

  const report: Record<string, RunResult[]> = {};
  try {
    for (const profile of PROFILES) {
      const results: RunResult[] = [];
      const name = NETWORK_LABEL + profile.suffix;
      report[name] = results;
      for (let r = 0; r < runs; r++) {
        const res = await measureOnce(browser, url, profile.cpu);
        results.push(res);
        if (!values.json) {
          const detail = res.detailReadyMs === null ? '' : ` · detalhes ${sec(res.detailReadyMs)}`;
          const sw = [
            res.towerSwitchMs !== null ? `bloco ${sec(res.towerSwitchMs)}` : null,
            res.floorSwitchMs !== null ? `andar ${sec(res.floorSwitchMs)}` : null,
            res.floorToFloorMs !== null ? `andar→andar ${sec(res.floorToFloorMs)}` : null,
            res.firstInteriorsMs !== null ? `maquetes 1ª ${sec(res.firstInteriorsMs)}` : null,
            res.floorInteriorsMs !== null ? `maquetes troca ${sec(res.floorInteriorsMs)}` : null,
            `andar ${res.floorFps.toFixed(0)} fps`,
            res.apartmentMs !== null ? `apartamento ${sec(res.apartmentMs)}` : null,
            res.apartmentFps !== null ? `${res.apartmentFps.toFixed(0)} fps` : null,
          ].filter(Boolean);
          console.error(
            `  ${name} #${r + 1}: FCP ${sec(res.fcpMs)} · pronto ${sec(res.viewerReadyMs)}${detail} · ${res.fps.toFixed(0)} fps${sw.length ? ` · ${sw.join(' · ')}` : ''}`,
          );
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (values.json) {
    console.log(JSON.stringify({ url, browser: executablePath, report }, null, 2));
    return;
  }

  console.log(`\nURL: ${url}`);
  console.log(`Navegador: ${executablePath}`);
  console.log(`GPU (WebGL): ${Object.values(report)[0]![0]!.renderer}`);
  console.log(`Execuções por perfil: ${runs} (mediana)\n`);
  for (const [name, rs] of Object.entries(report)) {
    const med = (pick: (r: RunResult) => number) => median(rs.map(pick));
    const details = rs.map((r) => r.detailReadyMs).filter((d): d is number => d !== null);
    console.log(`== ${name}`);
    console.log(`  JS da página (gzip):           ${kb(med((r) => r.pageJsBytes))}`);
    console.log(`  JS do viewer/three.js (gzip):  ${kb(med((r) => r.viewerJsBytes))}`);
    console.log(`  JS do supabase-js (gzip):      ${kb(med((r) => r.supabaseJsBytes))}`);
    console.log(`  GLB leve transferido:          ${kb(med((r) => r.baseGlbBytes))}`);
    console.log(`  GLB de detalhes transferido:   ${kb(med((r) => r.detailGlbBytes))}`);
    console.log(`  GLB das maquetes (andar):      ${kb(med((r) => r.interiorGlbBytes))}`);
    console.log(`  GLB do apartamento:            ${kb(med((r) => r.apartmentGlbBytes))}`);
    console.log(`  Página aparece (FCP):          ${sec(med((r) => r.fcpMs))}`);
    console.log(`  Prédio interativo:             ${sec(med((r) => r.viewerReadyMs))}`);
    console.log(
      `  Detalhes na tela:              ${details.length ? sec(median(details)) : '— (sem modelo de detalhes)'}`,
    );
    console.log(`  fps girando o prédio:          ${med((r) => r.fps).toFixed(0)}`);
    const medOf = (pick: (r: RunResult) => number | null) => {
      const xs = rs.map(pick).filter((x): x is number => x !== null);
      return xs.length ? sec(median(xs)) : '—';
    };
    console.log(`  Troca vista geral → bloco:     ${medOf((r) => r.towerSwitchMs)}`);
    console.log(`  Troca bloco → andar:           ${medOf((r) => r.floorSwitchMs)}`);
    console.log(`  Troca andar → andar:           ${medOf((r) => r.floorToFloorMs)}`);
    console.log(`  Maquetes, 1ª entrada no andar: ${medOf((r) => r.firstInteriorsMs)}`);
    console.log(`  Maquetes, troca de andar:      ${medOf((r) => r.floorInteriorsMs)}`);
    console.log(`  fps girando no modo andar:     ${med((r) => r.floorFps).toFixed(0)}`);
    console.log(`  "Ver apartamento" aberto:      ${medOf((r) => r.apartmentMs)}`);
    const aptFps = rs.map((r) => r.apartmentFps).filter((x): x is number => x !== null);
    console.log(
      `  fps no "Ver apartamento":      ${aptFps.length ? median(aptFps).toFixed(0) : '—'}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
