import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabasePublicEnv } from './env';

/**
 * Cliente do servidor com a sessão do usuário (cookies). Tudo que ele lê passa pela RLS
 * do usuário logado — nunca usa service_role.
 */
export async function serverClient() {
  const { url, anonKey } = supabasePublicEnv();
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Chamado de um Server Component (cookies só leitura): o proxy renova a sessão.
        }
      },
    },
  });
}
