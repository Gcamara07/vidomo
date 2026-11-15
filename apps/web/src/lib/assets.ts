/**
 * Único ponto que monta URLs de arquivos servidos do Storage (regra 7 do CLAUDE.md).
 *   models → GLBs (camadas leve e de detalhes)
 *   plans  → plantas 2D das tipologias
 * Os dois buckets são públicos.
 * TODO(CDN / URLs assinadas): trocar a implementação aqui, sem mexer nos chamadores
 * (ex.: sigilo de empreendimentos em rascunho).
 */
export const ASSET_BUCKETS = ['models', 'plans'] as const;
export type AssetBucket = (typeof ASSET_BUCKETS)[number];

export function getAssetUrl(
  path: string,
  bucket: AssetBucket = 'models',
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string {
  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL não definida');
  }
  if (!(ASSET_BUCKETS as readonly string[]).includes(bucket)) {
    throw new Error(`Bucket desconhecido: "${bucket}"`);
  }
  const cleanPath = path.replace(/^\/+/, '');
  if (!cleanPath || cleanPath.split('/').some((seg) => seg === '..' || seg === '')) {
    throw new Error(`Caminho de asset inválido: "${path}"`);
  }
  const base = supabaseUrl.replace(/\/+$/, '');
  const encoded = cleanPath.split('/').map(encodeURIComponent).join('/');
  return `${base}/storage/v1/object/public/${bucket}/${encoded}`;
}
