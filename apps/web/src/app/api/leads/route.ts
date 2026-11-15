import type { LeadInput, LeadResult } from '@/lib/lead-form';
import { clientIp, isSameOrigin } from '@/lib/leads/request';
import { submitLead } from '@/lib/leads/submit';
import { publicServerClient } from '@/lib/supabase/public-server';

/** Limite do corpo: o formulário inteiro cabe com folga. */
const MAX_BODY = 16 * 1024;

const STATUS: Record<string, number> = {
  rate_limited: 429,
  unavailable: 404,
  unknown: 500,
};

const json = (result: LeadResult, status: number) => Response.json(result, { status });

/**
 * "Tenho interesse nesta unidade". Rota do servidor (e não Server Action) para não pôr o
 * código de Server Actions no JS inicial da página pública. A chave de ingestão só existe
 * aqui, em variável de servidor; o lead é gravado e a resposta volta na hora (e-mail e
 * webhook saem depois pela fila).
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request.headers)) {
    return json({ ok: false, error: 'unknown' }, 403);
  }

  const ingestKey = process.env.LEADS_INGEST_KEY;
  if (!ingestKey) {
    console.error('LEADS_INGEST_KEY não configurada: o formulário de interesse não grava leads.');
    return json({ ok: false, error: 'unknown' }, 500);
  }

  let input: LeadInput;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ ok: false, error: 'unknown' }, 413);
    input = JSON.parse(text) as LeadInput;
    if (!input || typeof input !== 'object') throw new Error('corpo inválido');
  } catch {
    return json({ ok: false, error: 'unknown' }, 400);
  }

  try {
    const result = await submitLead(input, {
      client: publicServerClient(),
      ingestKey,
      ip: clientIp(request.headers),
      log: (m) => console.error(m),
    });
    return json(result, result.ok ? 201 : (STATUS[result.error] ?? 422));
  } catch {
    console.error('create_lead: falha de rede ou de configuração');
    return json({ ok: false, error: 'unknown' }, 500);
  }
}
