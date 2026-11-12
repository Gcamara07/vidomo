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
    .select('id, name, model_path')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!dev) throw new Error(`Empreendimento "${slug}" não encontrado.`);

  const [units, floors] = await Promise.all([
    client.from('units').select('object_key').eq('development_id', dev.id),
    client.from('floors').select('object_key').eq('development_id', dev.id),
  ]);
  if (units.error) throw units.error;
  if (floors.error) throw floors.error;

  return {
    development: dev as { id: string; name: string; model_path: string | null },
    unitKeys: units.data.map((u) => u.object_key as string),
    floorKeys: floors.data.map((f) => f.object_key as string),
  };
}
