import 'server-only';
import { createHmac } from 'node:crypto';
import {
  cleanName,
  leadErrorFromDb,
  nationalDigits,
  validateLead,
  type LeadInput,
  type LeadResult,
} from '../lead-form';

/** O mínimo do cliente Supabase que a criação de lead usa (facilita o teste). */
export interface LeadRpcClient {
  rpc(
    fn: 'create_lead',
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

export interface SubmitLeadDeps {
  client: LeadRpcClient;
  /** LEADS_INGEST_KEY (só no servidor). */
  ingestKey: string;
  /** IP do comprador visto pelo servidor; nunca vai em claro para o banco. */
  ip: string;
  log?: (msg: string) => void;
}

/**
 * Chave do balde antispam por IP: HMAC do IP com a chave de ingestão. O banco guarda
 * só isso (e apaga em 1 dia); sem a chave não dá para voltar ao IP.
 */
export function clientKeyFor(ip: string, ingestKey: string): string {
  return createHmac('sha256', ingestKey).update(`ip:${ip}`).digest('hex');
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * Cria o lead pelo caminho do servidor. O lead é gravado e a resposta volta na hora;
 * e-mail e webhook saem depois pela fila (Etapa 4), sem atrasar o comprador.
 */
export async function submitLead(raw: LeadInput, deps: SubmitLeadDeps): Promise<LeadResult> {
  // Corta qualquer excesso antes de validar (o formulário já limita no navegador).
  const input: LeadInput = {
    slug: clip(raw.slug, 120),
    objectKey: raw.objectKey ? clip(raw.objectKey, 120) : null,
    name: clip(raw.name, 400),
    phone: clip(raw.phone, 40),
    email: clip(raw.email, 400),
    message: clip(raw.message, 4000),
    consent: raw.consent === true,
    consentVersion: clip(raw.consentVersion, 60),
    source: raw.source === 'unit_link' ? 'unit_link' : 'portal',
    website: clip(raw.website, 400),
  };

  // Campo-armadilha preenchido: responde como sucesso para não ensinar o robô, e não grava.
  if (input.website && input.website.trim() !== '') return { ok: true };

  const invalid = validateLead(input);
  if (invalid) return { ok: false, ...invalid };

  const { error } = await deps.client.rpc('create_lead', {
    p_ingest_key: deps.ingestKey,
    p_client_key: clientKeyFor(deps.ip, deps.ingestKey),
    p_slug: input.slug,
    p_object_key: input.objectKey,
    p_name: cleanName(input.name),
    p_phone: nationalDigits(input.phone),
    p_email: input.email.trim() || null,
    p_message: input.message.trim() || null,
    p_source: input.source,
    p_consent: input.consent,
    p_consent_version: input.consentVersion,
  });

  if (!error) return { ok: true };

  const code = leadErrorFromDb(error);
  if (code === 'unknown') {
    // Só o código: a mensagem do Postgres pode trazer a linha recusada (dados do comprador).
    deps.log?.(`create_lead falhou: ${error.code ?? 'sem código'}`);
  }
  return { ok: false, error: code };
}
