import { execSync } from 'node:child_process';
import type { TestProject } from 'vitest/node';

/**
 * Lê URL e chaves do Supabase local (`supabase status -o env`).
 * Variáveis já definidas no ambiente têm prioridade.
 */
export default async function setup(project: TestProject) {
  let status: Record<string, string> = {};
  try {
    const out = execSync('pnpm exec supabase status -o env', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of out.split(/\r?\n/)) {
      const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
      if (m) status[m[1]!] = m[2]!;
    }
  } catch {
    status = {};
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? status.API_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? status.ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? status.SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      'Supabase local não encontrado. Rode `pnpm db:start` (Docker aberto) antes de `pnpm test`.',
    );
  }

  project.provide('supabase', { url, anonKey, serviceKey });

  // Pausa o envio de notificações durante os testes: as entregas criadas aqui não podem
  // sair de verdade (e-mail pelo Resend, webhook) nem mudar de status no meio de um teste.
  const previous = await setNotificationsPaused(url, serviceKey, true);
  return async () => {
    await setNotificationsPaused(url, serviceKey, previous);
  };
}

async function setNotificationsPaused(url: string, serviceKey: string, paused: boolean) {
  const res = await fetch(`${url}/rest/v1/rpc/set_notifications_paused`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_paused: paused }),
  });
  if (!res.ok) {
    throw new Error(
      `set_notifications_paused: HTTP ${res.status} ${await res.text()}. Migrations em dia? (\`pnpm exec supabase migration up\`)`,
    );
  }
  return (await res.json()) as boolean;
}

declare module 'vitest' {
  export interface ProvidedContext {
    supabase: { url: string; anonKey: string; serviceKey: string };
  }
}
