import { describe, expect, it } from 'vitest';
import { getAssetUrl, type AssetBucket } from './assets';

describe('getAssetUrl', () => {
  const base = 'http://127.0.0.1:54321/';

  it('monta a URL pública do bucket models (padrão)', () => {
    expect(getAssetUrl('residencial-vista/residencial-vista-leve.glb', 'models', base)).toBe(
      'http://127.0.0.1:54321/storage/v1/object/public/models/residencial-vista/residencial-vista-leve.glb',
    );
  });

  it('monta a URL do bucket plans (plantas 2D)', () => {
    expect(getAssetUrl('residencial-vista/tipo-a.png', 'plans', base)).toBe(
      'http://127.0.0.1:54321/storage/v1/object/public/plans/residencial-vista/tipo-a.png',
    );
  });

  it('ignora barra inicial e codifica segmentos', () => {
    expect(getAssetUrl('/a b/c.glb', 'models', base)).toBe(
      'http://127.0.0.1:54321/storage/v1/object/public/models/a%20b/c.glb',
    );
  });

  it('rejeita caminhos com .. e buckets desconhecidos', () => {
    expect(() => getAssetUrl('../segredo.glb', 'models', base)).toThrow();
    expect(() => getAssetUrl('x.png', 'outro' as AssetBucket, base)).toThrow();
  });

  it('exige a URL do Supabase', () => {
    expect(() => getAssetUrl('x.glb', 'models', '')).toThrow();
  });
});
