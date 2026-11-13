/**
 * Comprime um GLB exportado (Blender etc.) com o mesmo pipeline do prédio de teste:
 * dedup + prune + reorder + quantize + EXT_meshopt_compression.
 *
 *   pnpm model:compress modelos/residencial-vista-leve.glb [--out scripts/out/<nome>.glb]
 *
 * Por padrão grava em scripts/out/ (fora do git): o arquivo comprimido é reproduzível a
 * partir do exportado, que é o que vai para o git. Depois: model:validate e model:upload.
 */
import { mkdir, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { compressDocument, createIO } from './lib/building';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' } },
});

async function main() {
  const input = positionals[0];
  if (!input) throw new Error('Uso: pnpm model:compress <arquivo.glb> [--out saida.glb]');
  const src = resolve(input);
  const out = resolve(values.out ?? `scripts/out/${basename(src)}`);
  if (out === src) throw new Error('--out não pode sobrescrever o arquivo exportado.');

  const io = await createIO();
  const doc = await io.read(src);
  const before = (await stat(src)).size;

  await compressDocument(doc);
  await mkdir(dirname(out), { recursive: true });
  await io.write(out, doc);
  const after = (await stat(out)).size;

  const root = doc.getRoot();
  const triangles = root
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((t, p) => t + (p.getIndices()?.getCount() ?? 0) / 3, 0);
  console.log(`Comprimido: ${out}`);
  console.log(
    `  ${root.listNodes().length} objetos · ${root.listMeshes().length} malhas · ${Math.round(triangles)} triângulos`,
  );
  console.log(
    `  ${(before / 1024).toFixed(1)} KiB → ${(after / 1024).toFixed(1)} KiB ` +
      `(${((1 - after / before) * 100).toFixed(0)}% menor)`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
