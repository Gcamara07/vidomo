import 'server-only';

/**
 * A rota de leads só aceita chamadas da própria página (mesma origem). O navegador manda
 * Sec-Fetch-Site; sem ele, compara Origin com o Host da requisição.
 */
export function isSameOrigin(headers: Headers): boolean {
  const site = headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = headers.get('origin');
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** IP do comprador: na Vercel, x-real-ip e x-forwarded-for vêm da própria plataforma. */
export function clientIp(headers: Headers): string {
  return (
    headers.get('x-real-ip')?.trim() ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'desconhecido'
  );
}
