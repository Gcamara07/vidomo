import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyVidomoSignature } from './webhook-signature';

const SECRET = 'whsec_' + 'cd'.repeat(32);
const body = '{"event":"test","delivery_id":"d1","lead":{"name":"Ção"}}';
const sign = (b: string, s = SECRET) => `sha256=${createHmac('sha256', s).update(b).digest('hex')}`;

describe('verifyVidomoSignature', () => {
  it('aceita a assinatura do corpo bruto', () => {
    expect(verifyVidomoSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyVidomoSignature(Buffer.from(body), sign(body), SECRET)).toBe(true);
  });

  it.each([
    ['segredo errado', sign(body, 'whsec_outro')],
    ['corpo alterado', sign(body.replace('test', 'lead.created'))],
    ['sem prefixo', sign(body).slice('sha256='.length)],
    ['vazio', ''],
    ['hex curto', 'sha256=abcd'],
  ])('recusa: %s', (_label, header) => {
    expect(verifyVidomoSignature(body, header, SECRET)).toBe(false);
  });

  it('JSON re-serializado não confere (por isso o n8n precisa do corpo bruto)', () => {
    const reserialized = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyVidomoSignature(reserialized, sign(body), SECRET)).toBe(false);
  });
});
