import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { preload } from 'react-dom';
import { DevelopmentExplorer } from '@/components/public/DevelopmentExplorer';
import { getAssetUrl } from '@/lib/assets';
import { parseDeepLink } from '@/lib/deep-link';
import { fetchPublicDevelopment, fetchPublicUnits } from '@/lib/public-development';
import { publicServerClient } from '@/lib/supabase/public-server';

// Status muda a todo momento: sempre renderiza com dados frescos.
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
  /**
   * ?debug=1 mostra o contador de fps (medição no aparelho).
   * ?u=802 abre o andar da unidade com a ficha; ?andar=8 abre o andar (link inválido → prédio).
   */
  searchParams: Promise<{ debug?: string; u?: string | string[]; andar?: string | string[] }>;
}

const getDevelopment = cache((slug: string) => fetchPublicDevelopment(publicServerClient(), slug));

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const dev = await getDevelopment(slug);
  return {
    title: dev ? `${dev.name} · Vidomo` : 'Vidomo',
    description: dev
      ? `Explore o ${dev.name} em 3D e veja a disponibilidade em tempo real.`
      : undefined,
  };
}

export default async function DevelopmentPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { debug, u, andar } = await searchParams;
  const [development, units] = await Promise.all([
    getDevelopment(slug),
    fetchPublicUnits(publicServerClient(), slug),
  ]);
  if (!development) notFound();

  const modelUrl = development.model_path ? getAssetUrl(development.model_path, 'models') : null;
  const detailModelUrl = development.detail_model_path
    ? getAssetUrl(development.detail_model_path, 'models')
    : null;
  // Só o GLB leve (camada 1) começa junto com o HTML. O de detalhes não é pré-carregado:
  // o viewer o pede depois que o prédio já está interativo, para não disputar banda.
  if (modelUrl) preload(modelUrl, { as: 'fetch', crossOrigin: 'anonymous' });

  return (
    <DevelopmentExplorer
      slug={development.slug}
      name={development.name}
      modelUrl={modelUrl}
      detailModelUrl={detailModelUrl}
      initialUnits={units}
      initialNav={parseDeepLink({ u, andar }, units)}
      debug={debug === '1'}
    />
  );
}
