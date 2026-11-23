/**
 * Compara os objetos de um GLB com as unidades/andares do banco.
 *
 *   pnpm model:validate [arquivo.glb] [--slug residencial-vista] [--layer base|detail] [--json]
 *
 * Lista unidades sem objeto, objetos sem unidade, nomes fora do padrão, duplicados e o
 * peso do arquivo (limite 10 MB; aviso acima de 2 MB no modelo leve). Sai com código 1 se
 * houver problema bloqueante. --layer detail valida o GLB de detalhes (sem exigir unidades).
 * Semente da validação do RF-A08.
 */
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createIO } from './lib/building';
import {
  BASE_MODEL_BUDGET_BYTES,
  MAX_MODEL_BYTES,
  compareModel,
  type ModelLayer,
} from './lib/model-validation';
import { developmentKeys, serviceClient } from './lib/supabase-env';
import { interiorFitReport, modelGeometry } from './lib/interior-fit';
import { classifyObjects, towerPairsOf, zoneContextOf } from './lib/zones';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    slug: { type: 'string', default: 'residencial-vista' },
    // Camada de detalhes: modelo leve de referência para a projeção da torre.
    base: { type: 'string', default: 'scripts/out/residencial-vista-leve.glb' },
    layer: { type: 'string', default: 'base' },
    json: { type: 'boolean', default: false },
  },
});

const layer = values.layer as ModelLayer;
if (layer !== 'base' && layer !== 'detail') {
  console.error('--layer deve ser base ou detail');
  process.exit(1);
}

const file = resolve(positionals[0] ?? 'scripts/out/residencial-vista-leve.glb');

async function main() {
  const io = await createIO();
  const doc = await io.read(file);
  const names = doc
    .getRoot()
    .listNodes()
    .map((n) => n.getName());
  const { size } = await stat(file);

  const db = await developmentKeys(serviceClient(), values.slug!);
  const report = compareModel(names, db, size, layer);
  // Torre × entorno (como o viewer classifica no modo andar).
  const baseDoc = layer === 'base' ? doc : await io.read(resolve(values.base!));
  const zones = classifyObjects(doc, zoneContextOf(baseDoc));
  // Blocos colados (recortados juntos no modo andar), pela geometria das lajes e núcleos.
  const pairs = towerPairsOf(baseDoc);
  // Interiores (camada leve): encaixe por unidade, pelas caixas UNIT__ e lajes do GLB.
  const interiors =
    layer === 'base' && db.types.some((t) => t.referenceUnit)
      ? interiorFitReport(modelGeometry(doc), db.unitTypes, db.types)
      : null;
  if (interiors && interiors.errors.length) report.ok = false;

  if (values.json) {
    console.log(
      JSON.stringify({ file, slug: values.slug, ...report, zones, pairs, interiors }, null, 2),
    );
  } else {
    const list = (title: string, xs: string[], blocking = true) => {
      const mark = xs.length === 0 ? 'ok' : blocking ? 'ERRO' : 'aviso';
      console.log(`  [${mark}] ${title}: ${xs.length}`);
      for (const x of xs.slice(0, 50)) console.log(`         - ${x}`);
      if (xs.length > 50) console.log(`         … e mais ${xs.length - 50}`);
    };
    const mb = (b: number) => (b / 1024 / 1024).toFixed(2);

    console.log(`Modelo:  ${file} (camada ${layer === 'base' ? 'leve' : 'de detalhes'})`);
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
    if (report.glassObjects > 0) {
      console.log(`  [info] Vidros da fachada (VIDRO__): ${report.glassObjects}`);
      list('Unidades sem VIDRO__ (caixa colorida)', report.unitsWithoutGlass, false);
      list('VIDRO__ sem unidade', report.glassWithoutUnit, false);
    } else if (layer === 'base') {
      console.log('  [info] Sem VIDRO__: o status aparece nas caixas das unidades.');
    }
    // Vários blocos: resumo por bloco, com as diferenças de cada um.
    if (report.towers.length > 1) {
      const bad = report.towers.filter((t) => !t.ok || t.missingIn);
      console.log(
        `  [${bad.length ? 'ERRO' : 'ok'}] Blocos: ${report.towers.length}` +
          (bad.length ? ` (${bad.length} com diferenças)` : ', todos iguais ao banco'),
      );
      for (const t of report.towers) {
        const where =
          t.missingIn === 'model'
            ? ' — só no banco'
            : t.missingIn === 'db'
              ? ' — só no modelo'
              : '';
        const mark = t.ok && !t.missingIn ? 'ok' : 'ERRO';
        console.log(
          `         ${t.tower.padEnd(6)} ${t.unitObjects}/${t.dbUnits} unidades · ` +
            `${t.floorObjects}/${t.dbFloors} andares (modelo/banco)  ${mark}${where}`,
        );
        const diffs: [string, string[]][] = [
          ['unidades sem objeto', t.unitsWithoutObject],
          ['objetos sem unidade', t.objectsWithoutUnit],
          ['andares sem objeto', t.floorsWithoutObject],
          ['objetos de andar sem cadastro', t.objectsWithoutFloor],
        ];
        for (const [title, xs] of diffs) {
          if (xs.length)
            console.log(
              `             ${title}: ${xs.slice(0, 8).join(', ')}${xs.length > 8 ? ` … +${xs.length - 8}` : ''}`,
            );
        }
      }
    }
    if (interiors) {
      const bad = interiors.rows.filter((r) => !r.fits);
      const amb = interiors.rows.filter((r) => r.ambiguous);
      const mark = interiors.errors.length ? 'ERRO' : bad.length || amb.length ? 'aviso' : 'ok';
      console.log(
        `  [${mark}] Interiores: ${interiors.rows.length} unidades com maquete` +
          (bad.length ? ` · ${bad.length} não cabem na caixa (5 cm)` : '') +
          (amb.length ? ` · ${amb.length} ambíguas (sem espelho, menor rotação)` : ''),
      );
      for (const e of interiors.errors) console.log(`         ERRO: ${e}`);
      for (const w of interiors.warnings) console.log(`         aviso: ${w}`);
      for (const r of interiors.rows) {
        const flags = [
          r.transform === null ? 'sem encaixe' : '',
          r.transform !== null && !r.fits ? `não cabe (${r.deviation!.toFixed(2)} m)` : '',
          r.ambiguous ? 'ambígua' : '',
        ].filter(Boolean);
        console.log(
          `         ${r.unit.padEnd(16)} ${r.type.padEnd(10)} ${(r.transform ?? '—').padEnd(16)}` +
            (flags.length ? ` ${flags.join(', ')}` : ''),
        );
      }
    }
    if (report.amenities.length)
      console.log(
        `  [info] Áreas comuns (só visuais por enquanto): ${report.amenities.join(', ')}`,
      );
    const sizeMark = report.overSizeLimit ? 'ERRO' : report.overBaseBudget ? 'aviso' : 'ok';
    const budget =
      layer === 'base'
        ? `meta do modelo leve ${mb(BASE_MODEL_BUDGET_BYTES)} MB, limite ${mb(MAX_MODEL_BYTES)} MB`
        : `limite ${mb(MAX_MODEL_BYTES)} MB`;
    console.log(
      `  [${sizeMark}] Peso: ${(size / 1024).toFixed(1)} KiB (${mb(size)} MB; ${budget})`,
    );
    for (const w of report.warnings) console.log(`  [aviso] ${w}`);
    console.log(`  [info] Torre (recortada por andar): ${zones.tower.join(', ') || '—'}`);
    console.log(`  [info] Entorno (sempre visível): ${zones.site.join(', ') || '—'}`);
    if (report.towers.length > 1) {
      console.log(
        `  [info] Blocos colados (recortados juntos no modo andar): ${pairs.join(', ') || 'nenhum'}`,
      );
    }
    console.log(
      report.ok
        ? `Resultado: modelo compatível${report.warnings.length ? ' (com avisos)' : ''}.`
        : 'Resultado: modelo com problemas.',
    );
  }

  process.exitCode = report.ok ? 0 : 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
