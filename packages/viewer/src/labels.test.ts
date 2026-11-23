import { describe, expect, it } from 'vitest';
import { layoutLabels, type LabelInput } from './labels';

const vp = { width: 400, height: 300 };
const label = (id: string, x: number, y: number, priority = 1): LabelInput => ({
  id,
  x,
  y,
  w: 100,
  h: 30,
  priority,
});

function rects(map: ReturnType<typeof layoutLabels>, items: LabelInput[]) {
  return items
    .filter((i) => map.get(i.id)!.visible)
    .map((i) => {
      const p = map.get(i.id)!;
      return { l: p.left, t: p.top, r: p.left + i.w, b: p.top + i.h };
    });
}

describe('layoutLabels', () => {
  it('sem conflito: centrada no ponto do cômodo', () => {
    const m = layoutLabels([label('a', 200, 150)], vp);
    expect(m.get('a')).toEqual({ left: 150, top: 135, visible: true });
  });

  it('nenhuma etiqueta se sobrepõe, mesmo com pontos coincidentes', () => {
    const items = [label('a', 200, 150, 3), label('b', 200, 150, 2), label('c', 205, 152, 1)];
    const m = layoutLabels(items, vp);
    const rs = rects(m, items);
    expect(rs).toHaveLength(3);
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i]!;
        const b = rs[j]!;
        expect(a.l >= b.r || b.l >= a.r || a.t >= b.b || b.t >= a.b).toBe(true);
      }
    // A de maior prioridade fica no lugar.
    expect(m.get('a')).toEqual({ left: 150, top: 135, visible: true });
  });

  it('não sai da tela: perto da borda é empurrada para dentro', () => {
    const items = [label('borda', 395, 5), label('fora', -50, 400)];
    const m = layoutLabels(items, vp, 8);
    for (const r of rects(m, items)) {
      expect(r.l).toBeGreaterThanOrEqual(8);
      expect(r.t).toBeGreaterThanOrEqual(8);
      expect(r.r).toBeLessThanOrEqual(392);
      expect(r.b).toBeLessThanOrEqual(292);
    }
  });

  it('sem lugar: a de menor prioridade fica oculta; atrás da câmera também', () => {
    const tiny = { width: 120, height: 50 };
    const m = layoutLabels(
      [
        label('grande', 60, 25, 2),
        label('pequeno', 60, 25, 1),
        { ...label('atras', 60, 25, 3), hidden: true },
      ],
      tiny,
      4,
    );
    expect(m.get('grande')!.visible).toBe(true);
    expect(m.get('pequeno')!.visible).toBe(false);
    expect(m.get('atras')!.visible).toBe(false);
  });
});
