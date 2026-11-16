// Edge Function `notifications`: acionada pelo banco (pg_net, logo depois de uma entrega
// nova e a cada minuto pelo pg_cron) com o cabeçalho X-Vidomo-Dispatch-Key.
// A lógica fica em dispatch.ts (testada no Vitest). verify_jwt = false em config.toml:
// quem chama é o banco, autorizado pela chave que só existe no Vault.
import { dispatch, postgrestStore } from './dispatch.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
const resendApiKey = Deno.env.get('RESEND_API_KEY') || null;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  if (!supabaseUrl || !serviceKey) {
    console.error('notifications: SUPABASE_URL ou chave de serviço ausente');
    return new Response(null, { status: 500 });
  }

  const store = postgrestStore(supabaseUrl, serviceKey, fetch);
  const key = req.headers.get('x-vidomo-dispatch-key');
  if (!key || !(await store.checkKey(key))) return new Response(null, { status: 401 });

  try {
    const result = await dispatch({
      store,
      fetch,
      resendApiKey,
      log: (line) => console.log(line),
    });
    return Response.json({ ...result, email: resendApiKey ? 'on' : 'off' });
  } catch (e) {
    // Erro no banco: o que ficou em 'sending' volta pela regra do prazo estourado.
    console.error(`notifications: ${e instanceof Error ? e.message : 'erro desconhecido'}`);
    return new Response(null, { status: 500 });
  }
});
