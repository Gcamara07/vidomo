import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { preload } from 'react-dom';
import { DevelopmentExplorer } from '@/components/public/DevelopmentExplorer';
import { getAssetUrl } from '@/lib/assets';
import { parseDeepLink } from '@/lib/deep-link';
import {
  fetchPublicContact,
  fetchPublicDevelopment,
  fetchPublicUnitTypes,
  fetchPublicUnits,
  interiorRefs,
} from '@/lib/public-development';
import { publicServerClient } from '@/lib/supabase/public-server';

// Status muda a todo momento: sempre renderiza com dados frescos.
export const dynamic = 'force-dynamic';

// Android: com o teclado aberto, a página encolhe em vez de ficar por baixo dele, então a
// ficha (e o formulário de interesse) sobe junto e o campo em foco continua visível.
export const viewport: Viewport = {
  themeColor: '#23382F',
  interactiveWidget: 'resizes-content',
};

interface PageProps {
  params: Promise<{ slug: string }>;
  /**
   * ?debug=1 mostra o contador de fps (medição no aparelho).
   * ?u=802 (ou ?u=B09-201) abre o andar da unidade com a ficha; ?andar=8 abre o andar;
   * ?bloco=09 abre o bloco; ?bloco=09&andar=2, o andar dele (link inválido → vista geral).
   * ?u=802&ver=1 abre também o "Ver apartamento" (tipo com interior).
   */
  searchParams: Promise<{
    debug?: string;
    u?: string | string[];
    andar?: string | string[];
    bloco?: string | string[];
    ver?: string | string[];
  }>;
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
  const { debug, u, andar, bloco, ver } = await searchParams;
  const [development, units, contact, unitTypes] = await Promise.all([
    getDevelopment(slug),
    fetchPublicUnits(publicServerClient(), slug),
    fetchPublicContact(publicServerClient(), slug),
    fetchPublicUnitTypes(publicServerClient(), slug),
  ]);
  if (!development) notFound();
  const initialNav = parseDeepLink({ u, andar, bloco, ver }, units);

  const modelUrl = development.model_path ? getAssetUrl(development.model_path, 'models') : null;
  const detailModelUrl = development.detail_model_path
    ? getAssetUrl(development.detail_model_path, 'models')
    : null;
  // Só o GLB leve (camada 1) começa junto com o HTML. O de detalhes não é pré-carregado:
  // o viewer o pede depois que o prédio já está interativo, para não disputar banda.
  if (modelUrl) preload(modelUrl, { as: 'fetch', crossOrigin: 'anonymous' });
  // Interiores (maquetes): só as URLs; o viewer baixa ao entrar num andar, sob demanda.
  const interiors = interiorRefs(unitTypes, (path) => getAssetUrl(path, 'models'));

  return (
    <DevelopmentExplorer
      slug={development.slug}
      name={development.name}
      modelUrl={modelUrl}
      detailModelUrl={detailModelUrl}
      viewerCameras={development.viewer_cameras}
      interiors={interiors}
      unitTypes={unitTypes}
      initialUnits={units}
      initialNav={initialNav}
      contact={contact}
      // Origem do lead: aberta pelo link de uma unidade (?u=) ou navegando pelo portal.
      leadSource={initialNav.selected ? 'unit_link' : 'portal'}
      debug={debug === '1'}
    />
  );
}
