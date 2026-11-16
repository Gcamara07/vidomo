import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Confere o cabeçalho X-Vidomo-Signature: "sha256=" + HMAC-SHA256 em hex do corpo BRUTO
 * (os bytes recebidos, antes de qualquer JSON.parse), com o segredo do /painel/config.
 * Comparação em tempo constante. É a mesma conta que o n8n faz (ver README).
 */
export function verifyVidomoSignature(
  rawBody: Buffer | string,
  header: string | undefined | null,
  secret: string,
): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const received = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}
