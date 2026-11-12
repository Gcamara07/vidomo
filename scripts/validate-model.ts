/**
 * Compara os objetos de um GLB com as unidades/andares do banco.
 *
 *   pnpm model:validate [arquivo.glb] [--slug residencial-vista] [--json]
 *
 * Lista unidades sem objeto, objetos sem unidade, nomes fora do padrão, duplicados e o
 * peso do arquivo (limite 10 MB). Sai com código 1 se houver problema bloqueante.
 * Semente da validação do RF-A08.
 */
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createIO } from './lib/building';
import { MAX_MODEL_BYTES, compareModel } from './lib/model-validation';
import { developmentKeys, serviceClient } from './lib/supabase-env';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    slug: { type: 'string', default: 'residencial-vista' },
    json: { type: 'boolean', default: false },
  },
});

const file = resolve(positionals[0] ?? 'scripts/out/residencial-vista-test.glb');

async function main() {
  const io = await createIO();
  const doc = await io.read(file);
  const names = doc
    .getRoot()
    .listNodes()
    .map((n) => n.getName());
  const { size } = await stat(file);

  const db = await developmentKeys(serviceClient(), values.slug!);
  const report = compareModel(names, db, size);

  if (values.json) {
    console.log(JSON.stringify({ file, slug: values.slug, ...report }, null, 2));
  } else {
    const list = (title: string, xs: string[], blocking = true) => {
      const mark = xs.length === 0 ? 'ok' : blocking ? 'ERRO' : 'aviso';
      console.log(`  [${mark}] ${title}: ${xs.length}`);
      for (const x of xs.slice(0, 50)) console.log(`         - ${x}`);
      if (xs.length > 50) console.log(`         … e mais ${xs.length - 50}`);
    };
    const mb = (b: number) => (b / 1024 / 1024).toFixed(2);

    console.log(`Modelo:  ${file}`);
    console.log(`Banco:   ${db.development.name} (${values.slug})`);
    console.log(
      `Objetos: ${report.counts.unitObjects} unidades / ${report.counts.floorObjects} andares no GLB · ` +
        `${report.counts.dbUnits} unidades / ${report.counts.dbFloors} andares no banco`,
    );
    list('Unidades sem objeto', report.unitsWithoutObject);
    list('Objetos sem unidade', report.objectsWithoutUnit);
    list('Nomes fora do padrão', report.invalidNames);
    list('object_key duplicado', report.duplicateKeys);
    list('Andares sem objeto', report.floorsWithoutObject, false);
    list('Objetos de andar sem cadastro', report.objectsWithoutFloor, false);
    list('Objetos sem prefixo', report.unprefixedNames, false);
    console.log(
      `  [${report.overSizeLimit ? 'ERRO' : 'ok'}] Peso: ${(size / 1024).toFixed(1)} KiB ` +
        `(${mb(size)} MB de ${mb(MAX_MODEL_BYTES)} MB)`,
    );
    console.log(report.ok ? 'Resultado: modelo compatível.' : 'Resultado: modelo com problemas.');
  }

  process.exitCode = report.ok ? 0 : 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
