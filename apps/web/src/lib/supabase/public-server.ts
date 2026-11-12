import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { supabasePublicEnv } from './env';

/**
 * Cliente anônimo para leituras públicas no servidor (sem sessão, sem cookies).
 * Só alcança o que o papel anon alcança: as funções públicas.
 */
export function publicServerClient() {
  const { url, anonKey } = supabasePublicEnv();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
