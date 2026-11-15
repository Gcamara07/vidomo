import { describe, expect, it } from 'vitest';
import { clientIp, isSameOrigin } from './request';

const h = (init: Record<string, string>) => new Headers(init);

describe('rota de leads: origem', () => {
  it('aceita só Sec-Fetch-Site same-origin quando o navegador manda o cabeçalho', () => {
    expect(isSameOrigin(h({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(
      isSameOrigin(
        h({
          'sec-fetch-site': 'cross-site',
          origin: 'https://www.vidomo.com.br',
          host: 'www.vidomo.com.br',
        }),
      ),
    ).toBe(false);
    expect(isSameOrigin(h({ 'sec-fetch-site': 'same-site' }))).toBe(false);
  });

  it('sem Sec-Fetch-Site, compara Origin com o Host', () => {
    expect(
      isSameOrigin(h({ origin: 'https://www.vidomo.com.br', host: 'www.vidomo.com.br' })),
    ).toBe(true);
    expect(isSameOrigin(h({ origin: 'https://intruso.example', host: 'www.vidomo.com.br' }))).toBe(
      false,
    );
    expect(isSameOrigin(h({ host: 'www.vidomo.com.br' }))).toBe(false);
    expect(isSameOrigin(h({ origin: 'lixo', host: 'www.vidomo.com.br' }))).toBe(false);
  });

  it('IP: x-real-ip, senão o primeiro de x-forwarded-for', () => {
    expect(clientIp(h({ 'x-real-ip': '200.1.2.3', 'x-forwarded-for': '9.9.9.9' }))).toBe(
      '200.1.2.3',
    );
    expect(clientIp(h({ 'x-forwarded-for': '200.1.2.3, 10.0.0.1' }))).toBe('200.1.2.3');
    expect(clientIp(h({}))).toBe('desconhecido');
  });
});
