import { publicServerClient } from '@/lib/supabase/public-server';

/**
 * Conta um clique no WhatsApp da ficha (sendBeacon). Só slug e unidade: nenhum dado
 * pessoal. Responde 204 sempre; a contagem é informativa e nunca atrapalha o comprador.
 */
export async function POST(request: Request) {
  try {
    const text = (await request.text()).slice(0, 500);
    const body = JSON.parse(text) as { slug?: unknown; objectKey?: unknown };
    if (typeof body.slug === 'string' && typeof body.objectKey === 'string') {
      await publicServerClient().rpc('register_whatsapp_click', {
        p_slug: body.slug.slice(0, 120),
        p_object_key: body.objectKey.slice(0, 120),
      });
    }
  } catch {
    // Corpo inválido ou banco fora do ar: ignora.
  }
  return new Response(null, { status: 204 });
}
