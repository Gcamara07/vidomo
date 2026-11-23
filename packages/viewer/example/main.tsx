/**
 * Exemplo isolado do <Viewer> com status falsos (sem Supabase).
 *   pnpm --filter @vidomo/viewer example
 * Query string:
 *   ?demo=vista|blocos conjunto de teste (padrão: vista). blocos = condomínio de teste
 *                      (20 blocos × 4 andares × 4 unidades; GLBs locais, fora do git:
 *                      `pnpm model:compress modelos/teste-blocos-leve.glb` e o de detalhes)
 *   ?model=<url>       GLB leve (padrão: o do demo, servido de scripts/out)
 *   ?detail=<url>      GLB de detalhes (padrão: o do demo; ?detail=none desliga)
 *   ?tower=B09         abre no modo bloco (com 2+ torres)
 *   ?floor=B09__F02    abre no modo andar (útil para medir fps com `pnpm measure --url`)
 *   ?cam=px,py,pz,tx,ty,tz  câmera inicial (posição e alvo), para capturas reproduzíveis
 *   ?interior=none     sem maquetes no modo andar (só o Vista tem interiores: GLBs de
 *                      `pnpm model:compress modelos/interior-tipo-a-simples.glb` etc.)
 * Controles: vista geral / bloco / andar, seletor de bloco e de andar, rótulos dos blocos,
 * filtros de status e dormitórios (esmaecem unidades), estado serializável (onViewChange).
 */
import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  BRAND,
  STATUS_LABELS,
  UNIT_STATUSES,
  Viewer,
  parseUnitKey,
  swatchBackground,
  unitObjectKey,
  floorObjectKey,
  type UnitStatus,
  type UnitStatusMap,
  type ViewerManifest,
  type ViewerMode,
  type ViewerStats,
  type ViewerViewState,
} from '../src';

/** Conjuntos de teste: só dados (o viewer não sabe qual é qual). */
interface Demo {
  title: string;
  model: string;
  detail: string;
  towers: string[];
  floors: number;
  perFloor: number;
  bedroomsOf: (key: string) => number;
  /** Interiores por tipo e tipo de cada unidade (como o app monta a partir do banco). */
  interiors?: ViewerManifest['interiors'];
  typeOf?: (key: string) => string;
}
const DEMOS: Record<string, Demo> = {
  vista: {
    title: 'Residencial Vista',
    model: '/residencial-vista-leve.glb',
    detail: '/residencial-vista-detalhes.glb',
    towers: ['TA'],
    floors: 10,
    perFloor: 4,
    // Como no seed: finais 1 e 3 = 2 dorms (Tipo A); 2 e 4 = 3 dorms (Tipo B).
    bedroomsOf: (key) => (Number(parseUnitKey(key)?.code.slice(-1)) % 2 === 1 ? 2 : 3),
    // Tipo A nos finais 1 e 3 (modelado sobre a U201); Tipo B nos finais 2 e 4 (sobre a U202).
    interiors: {
      A: {
        simpleUrl: '/interior-tipo-a-simples.glb',
        detailUrl: '/interior-tipo-a.glb',
        referenceUnit: 'TA__F02__U201',
      },
      B: {
        simpleUrl: '/interior-tipo-b-simples.glb',
        detailUrl: '/interior-tipo-b.glb',
        referenceUnit: 'TA__F02__U202',
      },
    },
    typeOf: (key) => (Number(parseUnitKey(key)?.code.slice(-1)) % 2 === 1 ? 'A' : 'B'),
  },
  blocos: {
    title: 'Condomínio de teste',
    model: '/teste-blocos-leve.glb',
    detail: '/teste-blocos-detalhes.glb',
    towers: Array.from({ length: 20 }, (_, i) => `B${String(i + 1).padStart(2, '0')}`),
    floors: 4,
    perFloor: 4,
    bedroomsOf: () => 2,
  },
};

const params = new URLSearchParams(location.search);
const demo = DEMOS[params.get('demo') ?? 'vista'] ?? DEMOS.vista!;
const bedroomsOf = demo.bedroomsOf;
const FLOORS = Array.from({ length: demo.floors }, (_, i) => demo.floors - i);
const manifest: ViewerManifest = {
  modelUrl: params.get('model') ?? demo.model,
  detailModelUrl:
    params.get('detail') === 'none' ? undefined : (params.get('detail') ?? demo.detail),
};

/** Unidades falsas: torres × andares × unidades por andar (código = andar·100 + posição). */
const UNIT_KEYS = demo.towers.flatMap((t) =>
  Array.from({ length: demo.floors }, (_, f) =>
    Array.from({ length: demo.perFloor }, (_, p) => unitObjectKey(t, f + 1, (f + 1) * 100 + p + 1)),
  ).flat(),
);
if (demo.interiors && demo.typeOf && params.get('interior') !== 'none') {
  manifest.interiors = demo.interiors;
  manifest.unitTypes = Object.fromEntries(UNIT_KEYS.map((k) => [k, demo.typeOf!(k)]));
}
const BEDROOMS = [...new Set(UNIT_KEYS.map(bedroomsOf))].sort((a, b) => a - b);
const MULTI = demo.towers.length > 1;
const INITIAL_FLOOR = params.get('floor');
const INITIAL_TOWER = params.get('tower');
const CAM = params.get('cam')?.split(',').map(Number);
const INITIAL_CAMERA =
  CAM?.length === 6 && CAM.every(Number.isFinite)
    ? {
        position: CAM.slice(0, 3) as [number, number, number],
        target: CAM.slice(3) as [number, number, number],
      }
    : undefined;
/** Rótulo curto na vista geral: dígitos do código ('B09' → '09'). */
const TOWER_LABELS = Object.fromEntries(
  demo.towers.map((t) => [t, { label: t.replace(/^\D+/, '') || t, title: `Bloco ${t}` }]),
);

function initialStatus(): UnitStatusMap {
  const cycle: UnitStatus[] = [
    'available',
    'reserved',
    'available',
    'sold',
    'negotiating',
    'unavailable',
  ];
  return Object.fromEntries(UNIT_KEYS.map((k, i) => [k, cycle[i % cycle.length]!]));
}

function swatchStyle(status: UnitStatus): CSSProperties {
  return {
    width: 16,
    height: 16,
    flex: 'none',
    border: `1px solid ${BRAND.musgo}`,
    background: swatchBackground(status),
  };
}

const mono: CSSProperties = { fontFamily: '"IBM Plex Mono", ui-monospace, monospace' };

function App() {
  const [status, setStatus] = useState<UnitStatusMap>(initialStatus);
  const [selected, setSelected] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [readyMs, setReadyMs] = useState<number | null>(null);
  const [stats, setStats] = useState<ViewerStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewerMode>(
    INITIAL_FLOOR ? 'floor' : INITIAL_TOWER ? 'tower' : 'building',
  );
  const [activeTower, setActiveTower] = useState<string>(
    INITIAL_FLOOR?.split('__')[0] ?? INITIAL_TOWER ?? demo.towers[0]!,
  );
  const [activeFloor, setActiveFloor] = useState<string | null>(INITIAL_FLOOR);
  const [labels, setLabels] = useState(true);
  // O painel de baixo cobre o 3D: o viewer enquadra na área livre acima dele.
  const panelRef = useRef<HTMLElement>(null);
  const [panelH, setPanelH] = useState(0);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPanelH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [statusFilter, setStatusFilter] = useState<Set<UnitStatus>>(() => new Set(UNIT_STATUSES));
  const [bedroomFilter, setBedroomFilter] = useState<Set<number>>(() => new Set(BEDROOMS));
  const [view, setView] = useState<ViewerViewState | null>(null);

  const dimmedUnits = useMemo(
    () =>
      new Set(
        UNIT_KEYS.filter((k) => !statusFilter.has(status[k]!) || !bedroomFilter.has(bedroomsOf(k))),
      ),
    [status, statusFilter, bedroomFilter],
  );
  const goFloor = (key: string) => {
    const tower = key.split('__')[0]!;
    setActiveTower(tower);
    setActiveFloor(key);
    setMode('floor');
  };
  const goTower = (tower: string) => {
    setActiveTower(tower);
    setSelected(null);
    // Uma torre só: não há modo bloco (o viewer também o pularia).
    setMode(MULTI ? 'tower' : 'building');
  };
  const goOverview = () => {
    setSelected(null);
    setMode('building');
  };
  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  const randomChange = useCallback(() => {
    setStatus((prev) => {
      const key = UNIT_KEYS[Math.floor(Math.random() * UNIT_KEYS.length)]!;
      const options = UNIT_STATUSES.filter((s) => s !== prev[key]);
      return { ...prev, [key]: options[Math.floor(Math.random() * options.length)]! };
    });
  }, []);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(randomChange, 1500);
    return () => clearInterval(id);
  }, [auto, randomChange]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(UNIT_STATUSES.map((s) => [s, 0])) as Record<UnitStatus, number>;
    for (const s of Object.values(status)) c[s]++;
    return c;
  }, [status]);

  const parts = selected ? parseUnitKey(selected) : null;

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Viewer
        manifest={manifest}
        unitStatus={status}
        mode={mode}
        activeTower={activeTower}
        activeFloor={activeFloor}
        dimmedUnits={dimmedUnits}
        selectedUnit={selected}
        onSelectUnit={setSelected}
        onSelectFloor={goFloor}
        onSelectTower={goTower}
        towerLabels={labels ? TOWER_LABELS : undefined}
        onViewChange={setView}
        onReady={() => {
          // Mesmas marcas da página pública: `pnpm measure --url <exemplo>` funciona aqui.
          performance.mark('vidomo:viewer-ready');
          setReadyMs(Math.round(performance.now()));
        }}
        onDetailReady={() => performance.mark('vidomo:detail-ready')}
        onError={(e) => setError(e.message)}
        onStats={setStats}
        initialCamera={INITIAL_CAMERA}
        insets={{ top: 48, bottom: panelH + 12 }}
        style={{ position: 'absolute', inset: 0 }}
      />

      <header
        style={{
          position: 'absolute',
          top: 12,
          left: 16,
          right: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          pointerEvents: 'none',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: 'Fraunces, Georgia, serif',
            fontWeight: 500,
            fontSize: 22,
            color: BRAND.musgo,
          }}
        >
          {demo.title} <em>· viewer</em>
        </h1>
        <span style={{ ...mono, fontSize: 11, color: '#6B6A63' }}>
          {error ? `erro: ${error}` : readyMs === null ? 'carregando…' : `pronto em ${readyMs} ms`}
          {stats && ` · ${stats.drawCalls} draw calls · ${Math.round(stats.fps)} fps`}
        </span>
      </header>

      <section
        ref={panelRef}
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 'max(12px, env(safe-area-inset-bottom))',
          maxWidth: 520,
          background: 'rgba(243,239,231,0.94)',
          border: `1px solid ${BRAND.musgo}`,
          padding: '10px 12px',
          display: 'grid',
          gap: 10,
          fontSize: 13,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
          {UNIT_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={statusFilter.has(s)}
              onClick={() => setStatusFilter((f) => toggle(f, s))}
              style={{ ...chipStyle, opacity: statusFilter.has(s) ? 1 : 0.4 }}
            >
              <span style={swatchStyle(s)} />
              {STATUS_LABELS[s]} <span style={{ ...mono, color: '#6B6A63' }}>{counts[s]}</span>
            </button>
          ))}
          {BEDROOMS.map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={bedroomFilter.has(b)}
              onClick={() => setBedroomFilter((f) => toggle(f, b))}
              style={{ ...chipStyle, opacity: bedroomFilter.has(b) ? 1 : 0.4 }}
            >
              {b} dorms
            </button>
          ))}
        </div>

        {MULTI && (
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
            <button
              type="button"
              onClick={goOverview}
              style={{ ...floorBtn, ...(mode === 'building' ? floorBtnOn : {}) }}
            >
              Condomínio
            </button>
            {demo.towers.map((t) => {
              const on = mode !== 'building' && activeTower === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => goTower(t)}
                  style={{ ...floorBtn, ...(on ? floorBtnOn : {}) }}
                >
                  {TOWER_LABELS[t]!.label}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
          <button
            type="button"
            onClick={() => (MULTI ? goTower(activeTower) : goOverview())}
            style={{
              ...floorBtn,
              ...(mode === (MULTI ? 'tower' : 'building') ? floorBtnOn : {}),
            }}
          >
            {MULTI ? `Bloco ${TOWER_LABELS[activeTower]!.label}` : 'Ver prédio'}
          </button>
          {FLOORS.map((n) => {
            const key = floorObjectKey(activeTower, n);
            const on = mode === 'floor' && activeFloor === key;
            return (
              <button
                key={n}
                type="button"
                onClick={() => goFloor(key)}
                style={{ ...floorBtn, ...(on ? floorBtnOn : {}) }}
              >
                {n}º
              </button>
            );
          })}
        </div>

        <div style={{ ...mono, fontSize: 12, minHeight: 18 }}>
          {selected && parts ? (
            <>
              {selected} · bloco {parts.tower} · andar {parts.floor} · unidade {parts.code} ·{' '}
              {STATUS_LABELS[status[selected]!]}
            </>
          ) : (
            <span style={{ color: '#6B6A63' }}>toque numa unidade</span>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" onClick={randomChange} style={buttonStyle}>
            Mudar um status
          </button>
          <button type="button" onClick={() => setAuto((a) => !a)} style={buttonStyle}>
            {auto ? 'Parar automático' : 'Automático (1,5 s)'}
          </button>
          {MULTI && (
            <button type="button" onClick={() => setLabels((l) => !l)} style={buttonStyle}>
              {labels ? 'Sem rótulos' : 'Rótulos'}
            </button>
          )}
          <details style={{ ...mono, fontSize: 11 }}>
            <summary>estado</summary>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(view)}</pre>
          </details>
          {selected && (
            <select
              value={status[selected]}
              onChange={(e) =>
                setStatus((prev) => ({ ...prev, [selected]: e.target.value as UnitStatus }))
              }
              style={{ ...buttonStyle, background: '#fff' }}
            >
              {UNIT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          )}
        </div>
      </section>
    </div>
  );
}

const chipStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 6px',
  border: `1px solid ${BRAND.areia}`,
  background: 'transparent',
  cursor: 'pointer',
};

const floorBtn: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  flex: 'none',
  minWidth: 40,
  minHeight: 34,
  border: `1px solid ${BRAND.musgo}`,
  background: 'transparent',
  color: BRAND.musgo,
  cursor: 'pointer',
};
const floorBtnOn: CSSProperties = { background: BRAND.musgo, color: BRAND.papel };

const buttonStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 13,
  padding: '8px 12px',
  minHeight: 36,
  border: `1px solid ${BRAND.musgo}`,
  background: BRAND.musgo,
  color: BRAND.papel,
  cursor: 'pointer',
};

// Reaproveita a raiz quando o Vite reexecuta este módulo (HMR).
const container = document.getElementById('root') as HTMLElement & { __root?: Root };
container.__root ??= createRoot(container);
container.__root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
