/**
 * Pré-carregamento em segundo plano (ex.: o GLB detalhado do "Ver apartamento" quando a
 * ficha abre). Nunca com economia de dados (Save-Data) nem em conexão lenta (2g).
 */

/** Subconjunto da Network Information API (nem todo navegador tem). */
export interface ConnectionInfo {
  saveData?: boolean;
  effectiveType?: string;
}

export function canPrefetch(connection: ConnectionInfo | undefined | null): boolean {
  if (!connection) return true;
  if (connection.saveData) return false;
  return connection.effectiveType !== '2g' && connection.effectiveType !== 'slow-2g';
}

/** Conexão do navegador, quando ele informa. */
export function browserConnection(): ConnectionInfo | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { connection?: ConnectionInfo }).connection;
}
