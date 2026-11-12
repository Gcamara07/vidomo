'use client';
import { Viewer, type ViewerProps } from '@vidomo/viewer';
import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/**
 * Renderiza o <Viewer> só no navegador (no servidor e na hidratação devolve null).
 *
 * Por que não `dynamic(..., { ssr: false })`: com ssr:false o Next não sabe que o chunk será
 * usado e só começa a baixá-lo depois da hidratação. Com este invólucro carregado por
 * `dynamic()` com SSR, o Next emite <link rel="preload"> do chunk do three.js no HTML, e ele
 * baixa em paralelo com o JS inicial — sem renderizar nada de 3D no servidor.
 */
export default function ClientOnlyViewer(props: ViewerProps) {
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  return isClient ? <Viewer {...props} /> : null;
}
