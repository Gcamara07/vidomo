/**
 * Único ponto que monta URLs de arquivos 3D (regra 7 do CLAUDE.md).
 * Os arquivos ficam no bucket público `models` do Supabase Storage.
 * TODO(CDN / URLs assinadas): trocar a implementação aqui, sem mexer nos chamadores.
 */
export const MODELS_BUCKET = 'models';

export function getAssetUrl(
  path: string,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string {
  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL não definida');
  }
  const cleanPath = path.replace(/^\/+/, '');
  if (!cleanPath || cleanPath.split('/').some((seg) => seg === '..' || seg === '')) {
    throw new Error(`Caminho de asset inválido: "${path}"`);
  }
  const base = supabaseUrl.replace(/\/+$/, '');
  const encoded = cleanPath.split('/').map(encodeURIComponent).join('/');
  return `${base}/storage/v1/object/public/${MODELS_BUCKET}/${encoded}`;
}
