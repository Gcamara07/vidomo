/**
 * Gera o prédio de teste do Residencial Vista em GLB, sem Blender.
 *
 *   pnpm model:generate [--out arquivo.glb] [--layer base|detail] [--pad-mb N]
 *
 * --layer base (padrão) — camada 1, GLB leve obrigatório (metros, Y para cima,
 * fachadas norte = +Z e sul = −Z):
 *   TOWER__TA            térreo/pilotis, 0–3 m
 *   FLOOR__TA__F01..F10  lajes de 0,20 m a cada 3 m (pé-direito ~2,8 m)
 *   UNIT__TA__Fxx__Uyyy  4 volumes por andar: U.01 NO, U.02 NE (norte), U.03 SE, U.04 SO (sul)
 *   VIS__NUCLEO          núcleo de circulação no corredor central
 *   VIS__COBERTURA       laje de cobertura
 *
 * --layer detail — camada 2, GLB de detalhes opcional: varandas e guarda-corpos (VIS__).
 *
 * --pad-mb N — acrescenta uma malha plana "pesada" (VIS__TERRENO na base, VIS__ENTORNO nos
 * detalhes) até o arquivo ficar com ~N MB. Serve para simular o peso de um modelo real e
 * medir se a meta de 5 s se sustenta.
 *
 * Os nós ficam todos na raiz da cena (sem hierarquia), com translação absoluta; o viewer
 * deduz torre/andar pelo nome. Malhas iguais são compartilhadas entre nós.
 * Compressão: reorder + quantize + EXT_meshopt_compression.
 */
import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Document } from '@gltf-transform/core';
import { buildDocument, compressDocument, createIO } from './lib/building';
import { addPaddingGrid, buildDetailDocument } from './lib/layers';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    layer: { type: 'string', default: 'base' },
    'pad-mb': { type: 'string' },
  },
});

const layer = values.layer;
if (layer !== 'base' && layer !== 'detail') {
  console.error('--layer deve ser base ou detail');
  process.exit(1);
}
const padMb = values['pad-mb'] ? Number(values['pad-mb']) : 0;
const defaultOut =
  layer === 'base'
    ? 'scripts/out/residencial-vista-test.glb'
    : 'scripts/out/residencial-vista-test-detalhes.glb';
const out = resolve(values.out ?? defaultOut);

async function encode(cells: number): Promise<{ doc: Document; bytes: Uint8Array }> {
  const io = await createIO();
  const doc = layer === 'base' ? buildDocument() : buildDetailDocument();
  if (cells > 0) {
    addPaddingGrid(
      doc,
      layer === 'base'
        ? { name: 'VIS__TERRENO', cells, outer: 80, y: -0.05, seed: 1 }
        : { name: 'VIS__ENTORNO', cells, outer: 180, inner: 84, y: -0.06, seed: 2 },
    );
  }
  await compressDocument(doc);
  return { doc, bytes: await io.writeBinary(doc) };
}

async function main() {
  await mkdir(dirname(out), { recursive: true });

  let result = await encode(0);
  if (padMb > 0) {
    // Ajusta a grade até chegar perto do peso pedido (o peso cresce ~ com cells²).
    const target = padMb * 1024 * 1024;
    const baseBytes = result.bytes.byteLength;
    let cells = 200;
    for (let i = 0; i < 5; i++) {
      result = await encode(cells);
      const padBytes = result.bytes.byteLength - baseBytes;
      const err = (result.bytes.byteLength - target) / target;
      if (Math.abs(err) < 0.04 || padBytes <= 0) break;
      cells = Math.round(cells * Math.sqrt((target - baseBytes) / padBytes));
    }
  }

  const io = await createIO();
  await io.write(out, result.doc);
  const { size } = await stat(out);

  const nodes = result.doc
    .getRoot()
    .listNodes()
    .map((n) => n.getName());
  const count = (prefix: string) => nodes.filter((n) => n.startsWith(prefix)).length;
  const triangles = result.doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((t, p) => t + (p.getIndices()?.getCount() ?? 0) / 3, 0);
  console.log(`GLB gerado (camada ${layer === 'base' ? 'leve' : 'de detalhes'}): ${out}`);
  console.log(
    `  objetos: ${count('TOWER__')} torre, ${count('FLOOR__')} lajes, ${count('UNIT__')} unidades, ${count('VIS__')} visuais`,
  );
  console.log(`  triângulos (malhas únicas): ${Math.round(triangles).toLocaleString('pt-BR')}`);
  console.log(`  peso: ${(size / 1024).toFixed(1)} KiB (${(size / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
