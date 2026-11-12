import { getBounds } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { BUILDING, buildDocument, compressDocument, createIO } from './building';

describe('prédio de teste', async () => {
  const io = await createIO();
  const doc = buildDocument();
  await compressDocument(doc);
  const bytes = await io.writeBinary(doc);
  // Relê o GLB comprimido (decoder Meshopt) para testar o que o viewer vai receber.
  const read = await io.readBinary(bytes);
  const nodes = read.getRoot().listNodes();
  const byName = new Map(nodes.map((n) => [n.getName(), n]));

  it('usa EXT_meshopt_compression como extensão obrigatória', () => {
    const used = read
      .getRoot()
      .listExtensionsUsed()
      .map((e) => e.extensionName);
    const required = read
      .getRoot()
      .listExtensionsRequired()
      .map((e) => e.extensionName);
    expect(used).toContain('EXT_meshopt_compression');
    expect(required).toContain('EXT_meshopt_compression');
  });

  it('tem torre, 10 lajes e 40 unidades com os nomes da convenção', () => {
    const names = nodes.map((n) => n.getName());
    expect(names.filter((n) => n.startsWith('TOWER__'))).toEqual(['TOWER__TA']);
    expect(names.filter((n) => n.startsWith('FLOOR__'))).toHaveLength(10);
    const units = names.filter((n) => n.startsWith('UNIT__'));
    expect(units).toHaveLength(40);
    expect(units).toContain('UNIT__TA__F01__U101');
    expect(units).toContain('UNIT__TA__F10__U1004');
  });

  it('mantém posições e tamanhos depois da quantização', () => {
    const b = getBounds(byName.get('UNIT__TA__F08__U802')!);
    const size = b.max.map((v, i) => v - b.min[i]!);
    const center = b.max.map((v, i) => (v + b.min[i]!) / 2);
    const { unit, floorToFloor, slabThickness } = BUILDING;
    const tol = 0.02;
    expect(size[0]).toBeCloseTo(unit.width, 1);
    expect(size[1]).toBeCloseTo(unit.height, 1);
    expect(size[2]).toBeCloseTo(unit.depth, 1);
    // Unidade 802 = posição 2 (nordeste), 8º andar.
    expect(Math.abs(center[0]! - 6)).toBeLessThan(tol);
    expect(
      Math.abs(center[1]! - (8 * floorToFloor + slabThickness + unit.height / 2)),
    ).toBeLessThan(tol);
    expect(Math.abs(center[2]! - 4)).toBeLessThan(tol);
  });

  it('unidades não se sobrepõem e ficam sobre a laje do próprio andar', () => {
    const slab = getBounds(byName.get('FLOOR__TA__F03')!);
    for (const p of [1, 2, 3, 4]) {
      const u = getBounds(byName.get(`UNIT__TA__F03__U${300 + p}`)!);
      expect(u.min[1]).toBeGreaterThanOrEqual(slab.max[1] - 0.02);
    }
    const a = getBounds(byName.get('UNIT__TA__F03__U301')!);
    const b = getBounds(byName.get('UNIT__TA__F03__U302')!);
    expect(a.max[0]).toBeLessThan(b.min[0]);
  });
});
