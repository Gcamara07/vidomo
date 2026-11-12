import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { preload } from 'react-dom';
import { DevelopmentExplorer } from '@/components/public/DevelopmentExplorer';
import { getAssetUrl } from '@/lib/assets';
import { fetchPublicDevelopment, fetchPublicUnits } from '@/lib/public-development';
import { publicServerClient } from '@/lib/supabase/public-server';

// Status muda a todo momento: sempre renderiza com dados frescos.
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
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

export default async function DevelopmentPage({ params }: PageProps) {
  const { slug } = await params;
  const [development, units] = await Promise.all([
    getDevelopment(slug),
    fetchPublicUnits(publicServerClient(), slug),
  ]);
  if (!development) notFound();

  const modelUrl = development.model_path ? getAssetUrl(development.model_path) : null;
  // Começa a baixar o GLB junto com o HTML, em paralelo ao JS do three.js.
  if (modelUrl) preload(modelUrl, { as: 'fetch', crossOrigin: 'anonymous' });

  return (
    <DevelopmentExplorer
      slug={development.slug}
      name={development.name}
      modelUrl={modelUrl}
      initialUnits={units}
    />
  );
}
