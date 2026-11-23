'use client';
import { ApartmentViewer, type ApartmentViewerProps } from '@vidomo/viewer';
import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/** <ApartmentViewer> só no navegador (mesmo motivo do ClientOnlyViewer). */
export default function ClientOnlyApartment(props: ApartmentViewerProps) {
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  return isClient ? <ApartmentViewer {...props} /> : null;
}
