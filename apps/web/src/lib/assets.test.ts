import { describe, expect, it } from 'vitest';
import { getAssetUrl } from './assets';

describe('getAssetUrl', () => {
  const base = 'http://127.0.0.1:54321/';

  it('monta a URL pública do bucket models', () => {
    expect(getAssetUrl('residencial-vista/residencial-vista-test.glb', base)).toBe(
      'http://127.0.0.1:54321/storage/v1/object/public/models/residencial-vista/residencial-vista-test.glb',
    );
  });

  it('ignora barra inicial e codifica segmentos', () => {
    expect(getAssetUrl('/a b/c.glb', base)).toBe(
      'http://127.0.0.1:54321/storage/v1/object/public/models/a%20b/c.glb',
    );
  });

  it('rejeita caminhos com ..', () => {
    expect(() => getAssetUrl('../segredo.glb', base)).toThrow();
  });

  it('exige a URL do Supabase', () => {
    expect(() => getAssetUrl('x.glb', '')).toThrow();
  });
});
