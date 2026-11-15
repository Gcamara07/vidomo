import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Proxy (antigo middleware) do Next 16:
 * - renova a sessão do Supabase nos cookies a cada requisição do painel;
 * - manda para /login quem acessar /painel sem sessão.
 * As páginas do painel também verificam a sessão (defesa em profundidade); a RLS é
 * quem realmente protege os dados.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // getUser() valida o token no Auth (não confia só no cookie).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith('/painel')) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    // Mantém a query (ex.: /painel/leads?lead=<id>, o link do e-mail de lead novo).
    login.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(login);
  }

  return response;
}

export const config = {
  matcher: ['/painel/:path*', '/login'],
};
