/**
 * Envio da fila de notificações (Bloco 2, Etapa 4): e-mail pelo Resend e webhook assinado
 * com HMAC-SHA256. Sem dependências e sem `Deno`: roda na Edge Function (index.ts) e nos
 * testes do Vitest. O banco decide o que enviar, para onde e quando reenviar; aqui só se
 * monta a mensagem, envia e devolve o resultado.
 *
 * Nada de dado pessoal, URL ou segredo nos logs nem no erro gravado: só códigos.
 */

export type Channel = 'email' | 'webhook';
export type DeliveryEvent = 'lead.created' | 'lead.deleted' | 'test';

export interface JobUnit {
  code: string;
  floor: number | null;
  type: string | null;
}

export interface JobLead {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  message: string | null;
  source: string;
  status: string;
  created_at: string;
  unit: JobUnit | null;
}

/** Uma entrega pega no lote (claim_notification_deliveries). */
export interface Job {
  delivery_id: string;
  channel: Channel;
  event: DeliveryEvent;
  attempt: number;
  organization: { id: string; name: string };
  site_url: string;
  /** webhook */
  url?: string;
  secret?: string;
  /** e-mail */
  to?: string[];
  /** lead.created */
  development?: { slug: string; name: string };
  lead?: JobLead | { id: string };
}

export interface Outcome {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  durationMs: number;
  /** Começo do corpo da resposta de falha do webhook (já mascarado); null no resto. */
  responseBody?: string | null;
}

export interface Store {
  claim(channels: Channel[], limit: number): Promise<Job[]>;
  complete(job: Job, outcome: Outcome): Promise<void>;
}

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export const EMAIL_FROM = 'Vidomo <leads@notificacoes.vidomo.com.br>';
export const RESEND_URL = 'https://api.resend.com/emails';
export const REQUEST_TIMEOUT_MS = 10_000;
export const USER_AGENT = 'Vidomo-Webhooks/1.0';

const SOURCE_LABELS: Record<string, string> = {
  portal: 'Portal',
  unit_link: 'Link da unidade',
  stand: 'Estande',
  manual: 'Manual',
};

// ---------------------------------------------------------------------------
// Links e formatação
// ---------------------------------------------------------------------------

/** Mesmo formato do link canônico da ficha (apps/web/src/lib/lead-form.ts → unitLink). */
export function unitUrl(siteUrl: string, slug: string, code: string): string {
  return `${siteUrl}/e/${encodeURIComponent(slug)}?u=${encodeURIComponent(code)}`;
}

export function panelLeadUrl(siteUrl: string, leadId: string): string {
  return `${siteUrl}/painel/leads?lead=${encodeURIComponent(leadId)}`;
}

/** 5516997694880 → (16) 99769-4880. */
export function formatPhone(phone: string | null): string {
  if (!phone) return '';
  const d = phone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function isFullLead(lead: Job['lead']): lead is JobLead {
  return !!lead && 'name' in lead;
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

/** Dados fictícios do evento test (mesmo formato do lead.created). */
export function testData(siteUrl: string, now: Date) {
  return {
    development: { slug: 'empreendimento-teste', name: 'Empreendimento de teste' },
    lead: {
      id: '00000000-0000-4000-8000-000000000000',
      name: 'Lead de teste',
      phone: '5511999999999',
      email: 'lead.teste@exemplo.com',
      message: 'Mensagem de teste enviada pelo painel do Vidomo.',
      source: 'portal',
      status: 'new',
      created_at: now.toISOString(),
      unit: {
        code: '101',
        floor: 1,
        type: 'Tipo A',
        url: unitUrl(siteUrl, 'empreendimento-teste', '101'),
      },
    },
  };
}

/** Corpo do webhook, com as chaves na ordem documentada no README. */
export function webhookPayload(job: Job, now: Date): Record<string, unknown> {
  const head = {
    event: job.event,
    delivery_id: job.delivery_id,
    sent_at: now.toISOString(),
  };

  if (job.event === 'lead.deleted') {
    return { ...head, lead: { id: job.lead?.id } };
  }

  const organization = { id: job.organization.id, name: job.organization.name };
  if (job.event === 'test') {
    return { ...head, organization, ...testData(job.site_url, now) };
  }

  const lead = job.lead;
  const development = job.development;
  if (!isFullLead(lead) || !development) throw new Error('lead.created sem dados do lead');
  return {
    ...head,
    organization,
    development: { slug: development.slug, name: development.name },
    lead: {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      message: lead.message,
      source: lead.source,
      status: lead.status,
      created_at: new Date(lead.created_at).toISOString(),
      unit: lead.unit
        ? {
            code: lead.unit.code,
            floor: lead.unit.floor,
            type: lead.unit.type,
            url: unitUrl(job.site_url, development.slug, lead.unit.code),
          }
        : null,
    },
  };
}

/** HMAC-SHA256 em hex (WebCrypto: Deno e Node). */
export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function webhookRequest(job: Job, now: Date) {
  if (!job.url || !job.secret) throw new Error('webhook sem URL ou segredo');
  const body = JSON.stringify(webhookPayload(job, now));
  return {
    url: job.url,
    body,
    headers: {
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
      'x-vidomo-signature': `sha256=${await hmacSha256Hex(job.secret, body)}`,
      'x-vidomo-delivery': job.delivery_id,
      'x-vidomo-event': job.event,
    },
  };
}

// ---------------------------------------------------------------------------
// E-mail
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unitLabel(unit: JobUnit | null): string {
  if (!unit) return 'Sem unidade (interesse no empreendimento)';
  const parts = [unit.code];
  if (unit.floor !== null) parts.push(`${unit.floor}º andar`);
  if (unit.type) parts.push(unit.type);
  return parts.join(' · ');
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
  replyTo: string | null;
}

/** E-mail de lead novo para a equipe comercial. */
export function leadEmail(job: Job): EmailContent {
  const lead = job.lead;
  const development = job.development;
  if (!isFullLead(lead) || !development) throw new Error('lead.created sem dados do lead');

  const panelUrl = panelLeadUrl(job.site_url, lead.id);
  const unitPageUrl = lead.unit ? unitUrl(job.site_url, development.slug, lead.unit.code) : null;
  const subject = `Novo lead: ${lead.unit ? `${lead.unit.code} · ` : ''}${development.name}`;
  const phone = formatPhone(lead.phone);
  const source = SOURCE_LABELS[lead.source] ?? lead.source;
  const received = formatDateTime(lead.created_at);

  const rows: [string, string, string | null][] = [
    ['Unidade', unitLabel(lead.unit), unitPageUrl],
    ['Nome', lead.name, null],
    [
      'Telefone',
      phone || '—',
      lead.phone ? `https://wa.me/${lead.phone.replace(/\D/g, '')}` : null,
    ],
    ['E-mail', lead.email ?? '—', lead.email ? `mailto:${lead.email}` : null],
    ['Mensagem', lead.message ?? '—', null],
    ['Origem', source, null],
    ['Recebido em', received, null],
  ];

  const text = [
    `Novo lead no ${development.name}`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `Abrir no painel: ${panelUrl}`,
    '',
    `Você recebe este e-mail porque está na lista de notificações da ${job.organization.name} no Vidomo.`,
  ].join('\n');

  const cell = (value: string, href: string | null) => {
    const v = escapeHtml(value).replace(/\n/g, '<br>');
    return href
      ? `<a href="${escapeHtml(href)}" style="color:#23382F;text-decoration:underline">${v}</a>`
      : v;
  };
  const htmlRows = rows
    .map(
      ([k, v, href]) =>
        `<tr><td style="padding:8px 12px 8px 0;vertical-align:top;color:#6B6A63;font-size:13px;white-space:nowrap">${escapeHtml(k)}</td>` +
        `<td style="padding:8px 0;vertical-align:top;color:#1A2420;font-size:15px">${cell(v, href)}</td></tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F3EFE7;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EFE7"><tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #D6CFC1">
<tr><td style="background:#23382F;padding:16px 24px;color:#F3EFE7;font-family:Fraunces,Georgia,serif;font-size:20px">Vidomo</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 16px;font-family:Fraunces,Georgia,serif;font-weight:600;font-size:22px;color:#23382F">Novo lead no ${escapeHtml(development.name)}</h1>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${htmlRows}</table>
<p style="margin:24px 0 0"><a href="${escapeHtml(panelUrl)}" style="display:inline-block;background:#23382F;color:#F3EFE7;padding:12px 20px;text-decoration:none;font-size:15px">Abrir no painel</a></p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #E6DFD2;color:#6B6A63;font-size:12px">Você recebe este e-mail porque está na lista de notificações da ${escapeHtml(job.organization.name)} no Vidomo.</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, html, text, replyTo: lead.email };
}

export function resendRequest(job: Job, apiKey: string) {
  if (!job.to?.length) throw new Error('e-mail sem destinatários');
  const email = leadEmail(job);
  return {
    url: RESEND_URL,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      // O Resend descarta repetições com a mesma chave por 24 h: um reenvio depois de um
      // timeout (e-mail aceito, resposta perdida) não duplica a mensagem.
      'idempotency-key': `vidomo-delivery-${job.delivery_id}`,
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: job.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(email.replyTo ? { reply_to: email.replyTo } : {}),
    }),
  };
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

function describeError(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      return `timeout: sem resposta em ${REQUEST_TIMEOUT_MS / 1000} s`;
    }
    return `rede: ${e.name}`;
  }
  return 'rede: erro desconhecido';
}

export const RESPONSE_BODY_MAX = 500;
const RESPONSE_READ_BYTES = 16 * 1024;

/**
 * Mascara o que pode ser dado pessoal no corpo devolvido pelo destino (o n8n pode ecoar o
 * lead): e-mails e sequências de 8+ dígitos (telefones, documentos). UUIDs e datas ficam.
 */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const DATE_RE = /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/;
const EMAIL_RE = /[^\s"'<>@,;:()]+@[^\s"'<>@,;:()]+\.[^\s"'<>@,;:()]+/;
const DIGITS_RE = /\+?\d[\d ().-]{6,}\d/;
const REDACT_RE = new RegExp(
  [UUID_RE, DATE_RE, EMAIL_RE, DIGITS_RE].map((r) => r.source).join('|'),
  'gi',
);

export function redactResponseBody(text: string): string {
  return text.replace(REDACT_RE, (m) => {
    if (m.includes('@')) return '[e-mail]';
    if (new RegExp(`^(?:${UUID_RE.source}|${DATE_RE.source})$`, 'i').test(m)) return m;
    return (m.match(/\d/g) ?? []).length >= 8 ? '[número]' : m;
  });
}

/** Primeiros 500 caracteres do corpo (lê no máximo 16 KB), sem tags HTML e mascarado. */
export async function responseSnippet(res: Response): Promise<string | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (bytes < RESPONSE_READ_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    // Corpo interrompido: fica com o que chegou.
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if ((res.headers.get('content-type') ?? '').includes('html')) {
    text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
  }
  const clean = redactResponseBody(text.replace(/\s+/g, ' ').trim());
  return clean ? clean.slice(0, RESPONSE_BODY_MAX) : null;
}

async function post(
  fetchFn: FetchFn,
  req: { url: string; headers: Record<string, string>; body: string },
  readError: (res: Response) => Promise<{ error: string; responseBody?: string | null }>,
): Promise<Outcome> {
  const started = Date.now();
  try {
    const res = await fetchFn(req.url, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const durationMs = Date.now() - started;
    if (res.status >= 200 && res.status < 300) {
      await res.body?.cancel();
      return { ok: true, statusCode: res.status, error: null, durationMs };
    }
    const { error, responseBody = null } = await readError(res);
    return { ok: false, statusCode: res.status, error, durationMs, responseBody };
  } catch (e) {
    return {
      ok: false,
      statusCode: null,
      error: describeError(e),
      durationMs: Date.now() - started,
    };
  }
}

export async function sendWebhook(job: Job, fetchFn: FetchFn, now = new Date()): Promise<Outcome> {
  const req = await webhookRequest(job, now);
  return post(fetchFn, req, async (res) => {
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      return { error: `HTTP ${res.status}: redirecionamento não é seguido` };
    }
    return { error: `HTTP ${res.status}`, responseBody: await responseSnippet(res) };
  });
}

export async function sendEmail(job: Job, apiKey: string, fetchFn: FetchFn): Promise<Outcome> {
  const req = resendRequest(job, apiKey);
  return post(fetchFn, req, async (res) => {
    // Só o "name" do erro do Resend (ex.: validation_error): a mensagem pode citar endereços.
    let name = '';
    try {
      const data = (await res.json()) as { name?: unknown };
      if (typeof data.name === 'string') name = data.name.slice(0, 80);
    } catch {
      name = '';
    }
    return { error: `Resend HTTP ${res.status}${name ? `: ${name}` : ''}` };
  });
}

export interface DispatchOptions {
  store: Store;
  fetch: FetchFn;
  /** Sem chave, os e-mails esperam na fila (não gastam tentativas). */
  resendApiKey: string | null;
  batchSize?: number;
  /** Para de pegar lotes novos depois disso (o resto fica para o próximo acionamento). */
  budgetMs?: number;
  log?: (line: string) => void;
}

export interface DispatchResult {
  delivered: number;
  failed: number;
}

export async function dispatch(opts: DispatchOptions): Promise<DispatchResult> {
  const { store, resendApiKey } = opts;
  const batchSize = opts.batchSize ?? 10;
  const budgetMs = opts.budgetMs ?? 40_000;
  const log = opts.log ?? (() => {});
  const channels: Channel[] = resendApiKey ? ['email', 'webhook'] : ['webhook'];
  const started = Date.now();
  const result: DispatchResult = { delivered: 0, failed: 0 };

  while (Date.now() - started < budgetMs) {
    const jobs = await store.claim(channels, batchSize);
    if (jobs.length === 0) break;
    await Promise.all(
      jobs.map(async (job) => {
        let outcome: Outcome;
        try {
          outcome =
            job.channel === 'email'
              ? await sendEmail(job, resendApiKey!, opts.fetch)
              : await sendWebhook(job, opts.fetch);
        } catch (e) {
          outcome = {
            ok: false,
            statusCode: null,
            error: `montagem: ${e instanceof Error ? e.message : 'erro desconhecido'}`,
            durationMs: 0,
          };
        }
        if (outcome.ok) result.delivered++;
        else result.failed++;
        log(
          `entrega ${job.delivery_id} ${job.channel} ${job.event} tentativa ${job.attempt}: ` +
            (outcome.ok ? `ok ${outcome.statusCode}` : `falha (${outcome.error})`),
        );
        await store.complete(job, outcome);
      }),
    );
    if (jobs.length < batchSize) break;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Banco (PostgREST com a service_role; sem supabase-js para não ter dependência)
// ---------------------------------------------------------------------------

export function postgrestStore(supabaseUrl: string, serviceKey: string, fetchFn: FetchFn) {
  const headers: Record<string, string> = {
    apikey: serviceKey,
    'content-type': 'application/json',
  };
  // Chave antiga (JWT) também vai no Authorization; a nova (sb_secret_…) só no apikey.
  if (serviceKey.startsWith('eyJ')) headers.authorization = `Bearer ${serviceKey}`;

  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const res = await fetchFn(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`rpc ${name}: HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  return {
    checkKey: (key: string) => rpc<boolean>('check_notifications_dispatch_key', { p_key: key }),
    claim: (channels: Channel[], limit: number) =>
      rpc<Job[]>('claim_notification_deliveries', { p_channels: channels, p_limit: limit }),
    complete: async (job: Job, o: Outcome) => {
      await rpc<string>('complete_notification_delivery', {
        p_delivery_id: job.delivery_id,
        p_attempt: job.attempt,
        p_ok: o.ok,
        p_status_code: o.statusCode,
        p_error: o.error,
        p_duration_ms: o.durationMs,
        p_response_body: o.responseBody ?? null,
      });
    },
  } satisfies Store & { checkKey(key: string): Promise<boolean> };
}
