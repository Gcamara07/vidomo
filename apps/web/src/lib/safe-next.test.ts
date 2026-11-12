import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-next';

describe('safeNextPath', () => {
  it('aceita caminhos do painel', () => {
    expect(safeNextPath('/painel/dev-status')).toBe('/painel/dev-status');
    expect(safeNextPath('/painel')).toBe('/painel');
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
    expect(safeNextPath(next)).toBe('/painel/dev-status');
  });
});
