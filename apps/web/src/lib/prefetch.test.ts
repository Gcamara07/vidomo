import { describe, expect, it } from 'vitest';
import { canPrefetch } from './prefetch';

describe('canPrefetch', () => {
  it('pré-carrega quando o navegador não informa a conexão ou ela é boa', () => {
    expect(canPrefetch(undefined)).toBe(true);
    expect(canPrefetch({ effectiveType: '4g' })).toBe(true);
    expect(canPrefetch({ effectiveType: '3g', saveData: false })).toBe(true);
  });

  it('não pré-carrega com economia de dados nem em 2g', () => {
    expect(canPrefetch({ saveData: true, effectiveType: '4g' })).toBe(false);
    expect(canPrefetch({ effectiveType: '2g' })).toBe(false);
    expect(canPrefetch({ effectiveType: 'slow-2g' })).toBe(false);
  });
});
