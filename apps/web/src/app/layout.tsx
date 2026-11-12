import type { Metadata, Viewport } from 'next';
import { Fraunces, IBM_Plex_Mono, Inter } from 'next/font/google';
import './globals.css';

// Pré-carregadas: só as fontes que aparecem na primeira tela (título, texto, rótulos).
const fraunces = Fraunces({
  subsets: ['latin'],
  style: 'normal',
  variable: '--font-fraunces',
  display: 'swap',
});

// Itálico (ênfase nos títulos) não aparece na primeira tela da demo: sem preload. O
// navegador só baixa quando algum <em> num título for exibido.
const frauncesItalic = Fraunces({
  subsets: ['latin'],
  style: 'italic',
  variable: '--font-fraunces-italic',
  display: 'swap',
  preload: false,
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Vidomo',
  description: 'Explore o empreendimento em 3D e veja a disponibilidade em tempo real.',
};

export const viewport: Viewport = {
  themeColor: '#23382F',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${fraunces.variable} ${frauncesItalic.variable} ${inter.variable} ${plexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
