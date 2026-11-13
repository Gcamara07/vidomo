import { DoubleSide, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { toFlatMaterial } from './materials';

describe('toFlatMaterial', () => {
  it('mantém a cor exportada, sem luz, com transparência e lados do original', () => {
    const src = new MeshStandardMaterial({
      name: 'VID_agua',
      color: '#7FB7C9',
      roughness: 0.2,
      transparent: true,
      opacity: 0.8,
      side: DoubleSide,
    });
    const flat = toFlatMaterial(src);
    expect(flat).toBeInstanceOf(MeshBasicMaterial);
    expect(flat.name).toBe('VID_agua');
    expect(flat.color.getHexString()).toBe('7fb7c9');
    expect(flat.transparent).toBe(true);
    expect(flat.opacity).toBe(0.8);
    expect(flat.side).toBe(DoubleSide);
    expect(flat.polygonOffset).toBe(true);
    // Não compartilha a cor com o original (mudar um não muda o outro).
    flat.color.set('#000000');
    expect(src.color.getHexString()).toBe('7fb7c9');
  });
});
