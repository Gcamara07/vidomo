import { BoxGeometry, Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { groupBatches, mergeBatch, partArrays, slabClass, unitClass } from './batch';

const box = () => new BoxGeometry(2, 2, 2);
const at = (x: number, y = 0, z = 0) => new Matrix4().makeTranslation(x, y, z);

describe('partArrays', () => {
  it('expande a caixa em triângulos, em coordenadas de mundo, com UV e contorno', () => {
    const a = partArrays(box(), at(10, 5), 15);
    // 12 triângulos × 3 vértices.
    expect(a.position.length).toBe(36 * 3);
    expect(a.uv!.length).toBe(36 * 2);
    expect(a.color).toBeNull();
    const xs = a.position.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBe(9);
    expect(Math.max(...xs)).toBe(11);
    // Contorno da caixa: 12 arestas = 24 pontos, também transladados.
    expect(a.edges.length).toBe(24 * 3);
    expect(Math.min(...a.edges.filter((_, i) => i % 3 === 1))).toBe(4);
  });
});

describe('mergeBatch', () => {
  it('junta as peças e sabe a peça de cada triângulo (toque pelo faceIndex)', () => {
    const items = [
      { key: 'TA__F08__U801', arrays: partArrays(box(), at(0), 15) },
      { key: 'TA__F08__U802', arrays: partArrays(box(), at(5), 15) },
    ];
    const m = mergeBatch(items);
    expect(m.geometry.getAttribute('position').count).toBe(72);
    expect(m.geometry.getAttribute('uv').count).toBe(72);
    expect(m.keys).toHaveLength(24);
    expect(m.keys[0]).toBe('TA__F08__U801');
    expect(m.keys[23]).toBe('TA__F08__U802');
    expect(m.edges.length).toBe(48 * 3);
    // Caixa e esfera para o recorte de vista (frustum culling) e o raycast.
    expect(m.geometry.boundingBox!.max.x).toBe(6);
    expect(m.geometry.boundingSphere).not.toBeNull();
  });

  it('UV só entra se todas as peças tiverem', () => {
    const noUv = box();
    noUv.deleteAttribute('uv');
    const m = mergeBatch([
      { key: 'a', arrays: partArrays(box(), at(0), 15) },
      { key: 'b', arrays: partArrays(noUv, at(3), 15) },
    ]);
    expect(m.geometry.getAttribute('uv')).toBeUndefined();
  });

  it('lote vazio não quebra', () => {
    expect(mergeBatch([]).keys).toEqual([]);
  });
});

describe('classes visuais (definem o lote)', () => {
  it('unidade: status, filtro, seleção, esmaecida, oculta', () => {
    expect(unitClass('normal', 'available', false, false)).toBe('status:available');
    expect(unitClass('normal', 'sold', false, true)).toBe('filtered');
    expect(unitClass('normal', 'sold', true, true)).toBe('selected');
    expect(unitClass('normal', undefined, true, false)).toBe('nostatus');
    expect(unitClass('lower', 'available', true, false)).toBe('lower');
    expect(unitClass('context', 'reserved', false, false)).toBe('context');
    expect(unitClass('hidden', 'available', false, false)).toBeNull();
    expect(unitClass('ghost', 'available', true, false)).toBeNull();
  });

  it('laje', () => {
    expect(slabClass('normal')).toBe('slab');
    expect(slabClass('lower')).toBe('lower');
    expect(slabClass('context')).toBe('context');
    expect(slabClass('hidden')).toBeNull();
    expect(slabClass('ghost')).toBeNull();
  });
});

describe('groupBatches', () => {
  const units = ['B09__F02__U201', 'B09__F02__U202', 'B10__F02__U201'].map((key) => ({ key }));
  const status: Record<string, string> = {
    B09__F02__U201: 'available',
    B09__F02__U202: 'sold',
    B10__F02__U201: 'available',
  };
  const groupOf = (u: { key: string }) => `${u.key.slice(0, 3)}|${status[u.key]}`;

  it('um lote por bloco e status, com assinatura dos membros', () => {
    const g = groupBatches(units, groupOf);
    expect([...g.keys()]).toEqual(['B09|available', 'B09|sold', 'B10|available']);
    expect(g.get('B09|available')!.signature).toBe('B09__F02__U201');
  });

  it('mudança de status só mexe nos dois lotes envolvidos', () => {
    const before = groupBatches(units, groupOf);
    status.B09__F02__U201 = 'sold';
    const after = groupBatches(units, groupOf);
    expect(after.has('B09|available')).toBe(false);
    expect(after.get('B09|sold')!.signature).toBe('B09__F02__U201|B09__F02__U202');
    // O lote do outro bloco não muda: não é refeito.
    expect(after.get('B10|available')!.signature).toBe(before.get('B10|available')!.signature);
  });

  it('null fica fora (oculta, silhueta ou selecionada)', () => {
    expect(groupBatches(units, () => null).size).toBe(0);
  });
});
