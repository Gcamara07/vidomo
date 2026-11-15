import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-next';

describe('safeNextPath', () => {
  it('aceita caminhos do painel', () => {
    expect(safeNextPath('/painel/dev-status')).toBe('/painel/dev-status');
    expect(safeNextPath('/painel')).toBe('/painel');
    // Link do e-mail de lead novo (a query vem junto).
    expect(safeNextPath('/painel/leads?lead=abc')).toBe('/painel/leads?lead=abc');
  });

  it.each([
    undefined,
    null,
    '',
    '/',
    '/e/residencial-vista',
    '//evil.com/painel',
    'https://evil.com',
    '/painel\\..\\x',
    '/painel?u=https://evil.com',
  ])('recusa %j', (next) => {
    expect(safeNextPath(next)).toBe('/painel/leads');
  });
});
