/**
 * Gera o SQL de seed de um empreendimento a partir do GLB leve: blocos, andares e unidades
 * pelos nomes (convenção do CLAUDE.md), fachada de cada unidade pela posição no modelo.
 * O que o modelo não sabe (nome, tipos de planta, preços, rótulos) vem de um JSON.
 *
 *   pnpm model:seed <leve.glb> --config <config.json> --out <seed.sql>
 *
 * Exemplo (teste de vários blocos, SÓ local — config e SQL ficam em supabase/seeds/local/,
 * ignorada pelo git e carregada pelo `supabase db reset`):
 *
 *   pnpm model:seed modelos/teste-blocos-leve.glb \
 *     --config supabase/seeds/local/condominio-de-teste.json \
 *     --out supabase/seeds/local/condominio-de-teste.sql
 *
 * Formato do JSON: SeedConfig em scripts/lib/model-seed.ts.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { getBounds } from '@gltf-transform/core';
import { parseFloorKey, parseObjectName, parseUnitKey } from '@vidomo/viewer/naming';
import { computeTowers } from '@vidomo/viewer/towers';
import { createIO } from './lib/building';
import { buildSeedSql, type ModelTower, type PlanPoint, type SeedConfig } from './lib/model-seed';

type Vec3 = [number, number, number];

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: 'string' },
    out: { type: 'string' },
  },
});

async function main() {
  const file = positionals[0];
  if (!file || !values.config || !values.out) {
    throw new Error('Uso: pnpm model:seed <leve.glb> --config <config.json> --out <seed.sql>');
  }
  const config = JSON.parse(await readFile(resolve(values.config), 'utf8')) as SeedConfig;
  const doc = await (await createIO()).read(resolve(file));

  const parts = doc
    .getRoot()
    .listNodes()
    .filter((n) => n.getMesh())
    .map((n) => {
      const parsed = parseObjectName(n.getName());
      const b = getBounds(n);
      return {
        kind: parsed?.kind ?? null,
        objectKey: parsed?.valid ? parsed.objectKey : null,
        box: { min: b.min as Vec3, max: b.max as Vec3 },
      };
    });

  // Centro de cada bloco: caixa do núcleo, das lajes e das unidades dele.
  const towers = new Map<string, ModelTower>();
  for (const t of computeTowers(parts).values()) {
    const center: PlanPoint = [
      (t.bounds.min[0] + t.bounds.max[0]) / 2,
      (t.bounds.min[2] + t.bounds.max[2]) / 2,
    ];
    towers.set(t.key, { code: t.key, center, floors: [], units: [] });
  }
  for (const p of parts) {
    if (!p.objectKey) continue;
    if (p.kind === 'floor') {
      const f = parseFloorKey(p.objectKey)!;
      towers.get(f.tower)!.floors.push(f.floor);
    } else if (p.kind === 'unit') {
      const u = parseUnitKey(p.objectKey)!;
      towers.get(u.tower)!.units.push({
        objectKey: p.objectKey,
        code: u.code,
        floor: u.floor,
        center: [(p.box.min[0] + p.box.max[0]) / 2, (p.box.min[2] + p.box.max[2]) / 2],
      });
    }
  }
  for (const t of towers.values()) {
    const missing = [...new Set(t.units.map((u) => u.floor))].filter((f) => !t.floors.includes(f));
    if (missing.length) {
      throw new Error(`Bloco ${t.code}: unidades em andares sem laje FLOOR__ (${missing}).`);
    }
  }

  const list = [...towers.values()];
  const source = relative(process.cwd(), resolve(file)).replaceAll(sep, '/');
  const sql = buildSeedSql(list, config, source);
  const out = resolve(values.out);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, sql, 'utf8');
  const units = list.reduce((s, t) => s + t.units.length, 0);
  const floors = list.reduce((s, t) => s + t.floors.length, 0);
  console.log(`Seed: ${relative(process.cwd(), out).replaceAll(sep, '/')}`);
  console.log(`  ${config.slug}: ${list.length} blocos · ${floors} andares · ${units} unidades`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
