/**
 * URL e service_role do Supabase para scripts locais.
 * Usa as variáveis de ambiente se definidas; senão lê `supabase status` (ambiente local).
 * A service_role nunca vai para o front.
 */
import { execSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function readLocalStatus(): Record<string, string> {
  try {
    const out = execSync('pnpm exec supabase status -o env', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const vars: Record<string, string> = {};
    for (const line of out.split(/\r?\n/)) {
      const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
      if (m) vars[m[1]!] = m[2]!;
    }
    return vars;
  } catch {
    return {};
  }
}

export function serviceClient(): SupabaseClient {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const status = readLocalStatus();
    url ??= status.API_URL;
    key ??= status.SERVICE_ROLE_KEY;
  }
  if (!url || !key) {
    throw new Error(
      'Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY, ou suba o Supabase local (pnpm db:start).',
    );
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function developmentKeys(client: SupabaseClient, slug: string) {
  const { data: dev, error } = await client
    .from('developments')
    .select('id, name, model_path, detail_model_path')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!dev) throw new Error(`Empreendimento "${slug}" não encontrado.`);

  const [units, floors, types] = await Promise.all([
    client.from('units').select('object_key, unit_type_id').eq('development_id', dev.id),
    client.from('floors').select('object_key').eq('development_id', dev.id),
    client
      .from('unit_types')
      .select('id, name, interior_model_path, interior_detail_model_path, interior_reference_unit')
      .eq('development_id', dev.id),
  ]);
  if (units.error) throw units.error;
  if (floors.error) throw floors.error;
  if (types.error) throw types.error;
  const typeById = new Map(types.data.map((t) => [t.id as string, t]));

  return {
    development: dev as {
      id: string;
      name: string;
      model_path: string | null;
      detail_model_path: string | null;
    },
    unitKeys: units.data.map((u) => u.object_key as string),
    floorKeys: floors.data.map((f) => f.object_key as string),
    /** Tipo de planta de cada unidade (nome; null = sem tipo). */
    unitTypes: units.data.map((u) => ({
      objectKey: u.object_key as string,
      type: (typeById.get(u.unit_type_id as string)?.name as string | undefined) ?? null,
    })),
    /** Tipos de planta com os campos de interior. */
    types: types.data.map((t) => ({
      name: t.name as string,
      interiorModelPath: t.interior_model_path as string | null,
      interiorDetailModelPath: t.interior_detail_model_path as string | null,
      referenceUnit: t.interior_reference_unit as string | null,
    })),
  };
}
