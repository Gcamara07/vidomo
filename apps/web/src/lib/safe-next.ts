/**
 * Destino pós-login vindo de ?next=. Só aceita caminhos internos do painel, para o
 * login não virar redirecionamento aberto para outro site.
 */
export function safeNextPath(next: unknown, fallback = '/painel/leads'): string {
  if (typeof next !== 'string') return fallback;
  if (!next.startsWith('/painel')) return fallback;
  if (next.startsWith('//') || next.includes('\\') || next.includes('://')) return fallback;
  return next;
}
