/**
 * /painel/config: validação dos três campos da demo (WhatsApp, e-mails, webhook).
 * Usado no navegador (mensagens na hora) e na Server Action (quem decide).
 */
import { isValidBrPhone, isValidEmail, nationalDigits } from '../lead-form';

export const MAX_NOTIFICATION_EMAILS = 10;

/** WhatsApp comercial → só dígitos com DDI 55; '' = sem WhatsApp; null = inválido. */
export function normalizeWhatsapp(value: string): string | null | '' {
  if (!value.trim()) return '';
  return isValidBrPhone(value) ? `55${nationalDigits(value)}` : null;
}

/** E-mails separados por vírgula, ponto e vírgula, espaço ou linha. Sem repetidos. */
export function parseEmailList(text: string): { emails: string[]; invalid: string[] } {
  const parts = text
    .split(/[\s,;]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (!isValidEmail(p)) invalid.push(p);
    else if (!emails.includes(p)) emails.push(p);
  }
  return { emails, invalid };
}

/** Hosts locais: http aceito só para o receptor de teste na própria máquina. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);

/** https obrigatório (exceto receptor local de teste). */
export function webhookUrlProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length > 500) return 'A URL pode ter até 500 caracteres.';
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return 'Informe uma URL completa, começando com https://.';
  }
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return null;
  return 'Use https:// (o webhook leva dados pessoais).';
}

export interface ConfigInput {
  whatsapp: string;
  emails: string;
  webhookUrl: string;
}

export type ConfigField = keyof ConfigInput;

export interface ConfigValues {
  whatsapp_number: string | null;
  notification_emails: string[];
  webhook_url: string | null;
}

export function validateConfig(
  input: ConfigInput,
):
  { ok: true; values: ConfigValues } | { ok: false; errors: Partial<Record<ConfigField, string>> } {
  const errors: Partial<Record<ConfigField, string>> = {};

  const whatsapp = normalizeWhatsapp(input.whatsapp);
  if (whatsapp === null) errors.whatsapp = 'Informe o número com DDD, por exemplo (16) 99769-4880.';

  const { emails, invalid } = parseEmailList(input.emails);
  if (invalid.length) errors.emails = `E-mail inválido: ${invalid.join(', ')}`;
  else if (emails.length > MAX_NOTIFICATION_EMAILS)
    errors.emails = `No máximo ${MAX_NOTIFICATION_EMAILS} e-mails.`;

  const webhookProblem = webhookUrlProblem(input.webhookUrl);
  if (webhookProblem) errors.webhookUrl = webhookProblem;

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    values: {
      whatsapp_number: whatsapp || null,
      notification_emails: emails,
      webhook_url: input.webhookUrl.trim() || null,
    },
  };
}
