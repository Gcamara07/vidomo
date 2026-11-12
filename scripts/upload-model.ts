/**
 * Envia um GLB ao bucket `models` no caminho cadastrado no empreendimento:
 *   --layer base    (padrão) developments.model_path        — GLB leve obrigatório
 *   --layer detail  developments.detail_model_path          — GLB de detalhes opcional
 * Valida o modelo contra o banco antes de enviar (use --force para pular).
 *
 *   pnpm model:upload [arquivo.glb] [--slug residencial-vista] [--layer base|detail] [--force]
 *
 * TODO(RF-A08): no produto, o upload será feito pelo admin no painel, com esta mesma
 * validação no servidor.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createIO } from './lib/building';
import { compareModel, type ModelLayer } from './lib/model-validation';
import { developmentKeys, serviceClient } from './lib/supabase-env';

const BUCKET = 'models';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    slug: { type: 'string', default: 'residencial-vista' },
    layer: { type: 'string', default: 'base' },
    force: { type: 'boolean', default: false },
  },
});

const file = resolve(positionals[0] ?? 'scripts/out/residencial-vista-test.glb');

async function main() {
  const client = serviceClient();
  const db = await developmentKeys(client, values.slug!);
  const layer = values.layer as ModelLayer;
  if (layer !== 'base' && layer !== 'detail') throw new Error('--layer deve ser base ou detail');
  const column = layer === 'base' ? 'model_path' : 'detail_model_path';
  const path = db.development[column];
  if (!path) throw new Error(`"${values.slug}" não tem ${column} cadastrado.`);

  const bytes = await readFile(file);

  if (!values.force) {
    const io = await createIO();
    const doc = await io.readBinary(new Uint8Array(bytes));
    const names = doc
      .getRoot()
      .listNodes()
      .map((n) => n.getName());
    const report = compareModel(names, db, bytes.byteLength, layer);
    for (const w of report.warnings) console.warn(`aviso: ${w}`);
    if (!report.ok) {
      throw new Error(
        'Modelo incompatível com o banco. Rode `pnpm model:validate --layer ${layer}` para detalhes.',
      );
    }
  }

  const { error } = await client.storage.from(BUCKET).upload(path, bytes, {
    contentType: 'model/gltf-binary',
    // Curto enquanto o nome do arquivo não é versionado.
    // TODO(cache): incluir hash no nome do arquivo e usar cache longo.
    cacheControl: '60',
    upsert: true,
  });
  if (error) throw error;

  console.log(`Enviado: ${file}`);
  console.log(`  bucket ${BUCKET} → ${path} (${(bytes.byteLength / 1024).toFixed(1)} KiB)`);
  console.log(`  URL pública: ${client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
