import { describe, expect, it } from 'vitest';
import { normalizeWhatsapp, parseEmailList, validateConfig, webhookUrlProblem } from './config';

describe('configuração comercial', () => {
  it.each([
    ['16997694880', '5516997694880'],
    ['(16) 99769-4880', '5516997694880'],
    ['+55 16 99769-4880', '5516997694880'],
    ['', ''],
    ['123', null],
  ])('WhatsApp %j → %j', (input, expected) => {
    expect(normalizeWhatsapp(input)).toBe(expected);
  });

  it('lista de e-mails: separadores variados, minúsculas, sem repetidos e com os inválidos à parte', () => {
    expect(
      parseEmailList('Gabriel@Vidomo.com.br, vendas@vidomo.com.br;\ngabriel@vidomo.com.br x@'),
    ).toEqual({
      emails: ['gabriel@vidomo.com.br', 'vendas@vidomo.com.br'],
      invalid: ['x@'],
    });
  });

  it.each([
    ['', null],
    ['https://exemplo.app.n8n.cloud/webhook/vidomo', null],
    ['http://localhost:8787/hook', null],
    ['http://host.docker.internal:8787/hook', null],
    [
      'http://exemplo.app.n8n.cloud/webhook/vidomo',
      'Use https:// (o webhook leva dados pessoais).',
    ],
    ['exemplo.com/hook', 'Informe uma URL completa, começando com https://.'],
    ['ftp://exemplo.com', 'Use https:// (o webhook leva dados pessoais).'],
  ])('webhook %j → %j', (input, problem) => {
    expect(webhookUrlProblem(input)).toBe(problem);
  });

  it('valida os três campos juntos', () => {
    expect(
      validateConfig({
        whatsapp: '(16) 99769-4880',
        emails: 'gabriel@vidomo.com.br',
        webhookUrl: ' https://exemplo.app.n8n.cloud/webhook/vidomo ',
      }),
    ).toEqual({
      ok: true,
      values: {
        whatsapp_number: '5516997694880',
        notification_emails: ['gabriel@vidomo.com.br'],
        webhook_url: 'https://exemplo.app.n8n.cloud/webhook/vidomo',
      },
    });
    expect(validateConfig({ whatsapp: '', emails: '', webhookUrl: '' })).toEqual({
      ok: true,
      values: { whatsapp_number: null, notification_emails: [], webhook_url: null },
    });
    const bad = validateConfig({ whatsapp: '12', emails: 'a@', webhookUrl: 'http://x.com' });
    expect(bad.ok).toBe(false);
    expect(Object.keys((bad as { errors: object }).errors).sort()).toEqual([
      'emails',
      'webhookUrl',
      'whatsapp',
    ]);
  });

  it('no máximo 10 e-mails', () => {
    const many = Array.from({ length: 11 }, (_, i) => `v${i}@exemplo.com`).join(',');
    const r = validateConfig({ whatsapp: '', emails: many, webhookUrl: '' });
    expect(r.ok).toBe(false);
  });
});
