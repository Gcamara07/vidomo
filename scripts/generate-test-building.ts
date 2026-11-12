/**
 * Gera o prédio de teste do Residencial Vista em GLB, sem Blender.
 *
 *   pnpm model:generate [--out scripts/out/residencial-vista-test.glb]
 *
 * Geometria (metros, Y para cima, fachadas norte = +Z e sul = −Z):
 *   TOWER__TA            térreo/pilotis, 0–3 m
 *   FLOOR__TA__F01..F10  lajes de 0,20 m a cada 3 m (pé-direito ~2,8 m)
 *   UNIT__TA__Fxx__Uyyy  4 volumes por andar: U.01 NO, U.02 NE (norte), U.03 SE, U.04 SO (sul)
 *   VIS__NUCLEO          núcleo de circulação no corredor central
 *   VIS__COBERTURA       laje de cobertura
 *
 * Os nós ficam todos na raiz da cena (sem hierarquia), com translação absoluta; o viewer
 * deduz torre/andar pelo nome. Malhas iguais são compartilhadas entre nós.
 * Compressão: reorder + quantize + EXT_meshopt_compression.
 */
import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildDocument, compressDocument, createIO } from './lib/building';

async function main() {
  const { values } = parseArgs({
    options: { out: { type: 'string', default: 'scripts/out/residencial-vista-test.glb' } },
  });
  const out = resolve(values.out!);
  await mkdir(dirname(out), { recursive: true });

  const io = await createIO();
  const doc = buildDocument();

  const rawBytes = (await io.writeBinary(doc)).byteLength;

  await compressDocument(doc);

  await io.write(out, doc);
  const { size } = await stat(out);

  const nodes = doc
    .getRoot()
    .listNodes()
    .map((n) => n.getName());
  const count = (prefix: string) => nodes.filter((n) => n.startsWith(prefix)).length;
  console.log(`GLB gerado: ${out}`);
  console.log(
    `  objetos: ${count('TOWER__')} torre, ${count('FLOOR__')} lajes, ${count('UNIT__')} unidades, ${count('VIS__')} visuais`,
  );
  console.log(
    `  peso: ${(size / 1024).toFixed(1)} KiB (sem compressão: ${(rawBytes / 1024).toFixed(1)} KiB)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
