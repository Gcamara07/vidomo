'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabasePublicEnv } from './env';

let client: SupabaseClient | undefined;

/** Cliente do navegador (singleton). Usa a sessão dos cookies quando houver login. */
export function browserClient(): SupabaseClient {
  if (!client) {
    const { url, anonKey } = supabasePublicEnv();
    client = createBrowserClient(url, anonKey);
  }
  return client;
}
