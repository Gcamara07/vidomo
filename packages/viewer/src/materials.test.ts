import { DoubleSide, MeshBasicMaterial, MeshStandardMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createClipPlanes, setClipRange, toFlatMaterial } from './materials';

describe('planos de corte por altura', () => {
  // three recorta o que fica com distância negativa ao plano.
  const kept = (plane: { distanceToPoint(p: Vector3): number }, y: number) =>
    plane.distanceToPoint(new Vector3(0, y, 0)) >= 0;

  it('modo andar: passada normal só na faixa do andar; passada esmaecida só abaixo', () => {
    const p = createClipPlanes();
    setClipRange(p, { bottom: 25, top: 28 });
    const normal = (y: number) => kept(p.top, y) && kept(p.bottom, y);
    expect([normal(24), normal(26), normal(29)]).toEqual([false, true, false]);
    expect([kept(p.below, 24), kept(p.below, 26)]).toEqual([true, false]);
  });

  it('modo edifício: nada é recortado', () => {
    const p = createClipPlanes();
    setClipRange(p, { bottom: 25, top: 28 });
    setClipRange(p, null);
    expect([0, 30, 500].every((y) => kept(p.top, y) && kept(p.bottom, y))).toBe(true);
  });
});

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
