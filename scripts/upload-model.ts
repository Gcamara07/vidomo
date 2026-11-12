/**
 * Envia um GLB ao bucket `models` no caminho cadastrado em developments.model_path.
 * Valida o modelo contra o banco antes de enviar (use --force para pular).
 *
 *   pnpm model:upload [arquivo.glb] [--slug residencial-vista] [--force]
 *
 * TODO(RF-A08): no produto, o upload será feito pelo admin no painel, com esta mesma
 * validação no servidor.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createIO } from './lib/building';
import { compareModel } from './lib/model-validation';
import { developmentKeys, serviceClient } from './lib/supabase-env';

const BUCKET = 'models';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    slug: { type: 'string', default: 'residencial-vista' },
    force: { type: 'boolean', default: false },
  },
});

const file = resolve(positionals[0] ?? 'scripts/out/residencial-vista-test.glb');

async function main() {
  const client = serviceClient();
  const db = await developmentKeys(client, values.slug!);
  const path = db.development.model_path;
  if (!path) throw new Error(`"${values.slug}" não tem model_path cadastrado.`);

  const bytes = await readFile(file);

  if (!values.force) {
    const io = await createIO();
    const doc = await io.readBinary(new Uint8Array(bytes));
    const names = doc
      .getRoot()
      .listNodes()
      .map((n) => n.getName());
    const report = compareModel(names, db, bytes.byteLength);
    if (!report.ok) {
      throw new Error('Modelo incompatível com o banco. Rode `pnpm model:validate` para detalhes.');
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
