/**
 * Envia um GLB ao bucket `models` no caminho cadastrado no empreendimento:
 *   --layer base    (padrão) developments.model_path        — GLB leve obrigatório
 *   --layer detail  developments.detail_model_path          — GLB de detalhes opcional
 *   --layer interior        --type "Tipo A"  unit_types.interior_model_path (maquete simples)
 *   --layer interior-detail --type "Tipo A"  unit_types.interior_detail_model_path
 * Valida o modelo antes de enviar (use --force para pular).
 *
 * --path <caminho no bucket>: envia para esse caminho em vez do cadastrado. Serve para a
 * publicação: os arquivos novos sobem ANTES do seed que passa a apontar para eles (o site
 * publicado nunca aponta para um arquivo que ainda não existe).
 *
 *   pnpm model:upload [arquivo.glb] [--slug residencial-vista]
 *     [--layer base|detail|interior|interior-detail] [--type "Tipo A"] [--force]
 *
 * TODO(RF-A08): no produto, o upload será feito pelo admin no painel, com esta mesma
 * validação no servidor.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createIO } from './lib/building';
import { checkInteriorModel, compareModel, type ModelLayer } from './lib/model-validation';
import { developmentKeys, serviceClient } from './lib/supabase-env';

const BUCKET = 'models';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    slug: { type: 'string', default: 'residencial-vista' },
    layer: { type: 'string', default: 'base' },
    type: { type: 'string' },
    path: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
});

const file = resolve(positionals[0] ?? 'scripts/out/residencial-vista-leve-v2.glb');
const LAYERS = ['base', 'detail', 'interior', 'interior-detail'] as const;
type UploadLayer = (typeof LAYERS)[number];

async function main() {
  const client = serviceClient();
  const db = await developmentKeys(client, values.slug!);
  const layer = values.layer as UploadLayer;
  if (!LAYERS.includes(layer)) throw new Error(`--layer deve ser ${LAYERS.join(', ')}`);
  const interior = layer === 'interior' || layer === 'interior-detail';
  let path: string | null;
  if (values.path) {
    path = values.path.replace(/^\/+/, '');
    if (!/^[a-z0-9][a-z0-9-]*\/[A-Za-z0-9._-]+\.glb$/.test(path)) {
      throw new Error('--path deve ser "<pasta>/<arquivo>.glb" (ex.: residencial-vista/x.glb).');
    }
  } else if (interior) {
    if (!values.type) throw new Error('--type "<tipo de planta>" é obrigatório nos interiores.');
    const t = db.types.find((x) => x.name === values.type);
    if (!t) throw new Error(`Tipo "${values.type}" não existe em "${values.slug}".`);
    path = layer === 'interior' ? t.interiorModelPath : t.interiorDetailModelPath;
    const column = layer === 'interior' ? 'interior_model_path' : 'interior_detail_model_path';
    if (!path) throw new Error(`O tipo "${values.type}" não tem ${column} cadastrado.`);
  } else {
    const column = layer === 'base' ? 'model_path' : 'detail_model_path';
    path = db.development[column];
    if (!path) throw new Error(`"${values.slug}" não tem ${column} cadastrado.`);
  }

  const bytes = await readFile(file);

  if (!values.force && interior) {
    const io = await createIO();
    const doc = await io.readBinary(new Uint8Array(bytes));
    const r = checkInteriorModel(
      doc
        .getRoot()
        .listNodes()
        .filter((n) => n.getMesh())
        .map((n) => n.getName()),
      bytes.byteLength,
    );
    for (const w of r.warnings) console.warn(`aviso: ${w}`);
    if (r.errors.length) throw new Error(`Interior com problemas:\n- ${r.errors.join('\n- ')}`);
  } else if (!values.force) {
    const io = await createIO();
    const doc = await io.readBinary(new Uint8Array(bytes));
    const names = doc
      .getRoot()
      .listNodes()
      .map((n) => n.getName());
    const report = compareModel(names, db, bytes.byteLength, layer as ModelLayer);
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
