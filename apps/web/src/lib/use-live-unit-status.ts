'use client';
import type { UnitStatusMap } from '@vidomo/viewer/types';
import { useEffect, useState } from 'react';
import {
  applyStatusMessage,
  fetchPublicUnits,
  toStatusMap,
  type PublicUnit,
} from './public-development';
import { browserClient } from './supabase/browser';

export type LiveConnection = 'connecting' | 'live' | 'offline';

/**
 * Status das unidades em tempo real para a página pública.
 *
 * - Assina o Broadcast privado `development:<slug>` (só o trigger do banco publica).
 * - O Broadcast não reenvia mensagens perdidas, então relê tudo pela função pública:
 *   a cada SUBSCRIBED (inclui reconexões do socket), ao voltar do segundo plano e
 *   quando a rede volta.
 * - Mensagens que chegam durante uma releitura são reaplicadas sobre o resultado,
 *   para a foto do banco não sobrescrever uma mudança mais nova.
 */
export function useLiveUnitStatus(slug: string, initialUnits: PublicUnit[]) {
  const [units, setUnits] = useState(initialUnits);
  const [statusMap, setStatusMap] = useState<UnitStatusMap>(() => toStatusMap(initialUnits));
  const [connection, setConnection] = useState<LiveConnection>('connecting');

  useEffect(() => {
    const client = browserClient();
    let disposed = false;
    let inFlight = false;
    let queued = false;
    let duringFetch: unknown[] = [];

    const resync = async () => {
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      duringFetch = [];
      try {
        const fresh = await fetchPublicUnits(client, slug);
        if (disposed) return;
        const pending = duringFetch;
        setUnits(fresh);
        setStatusMap(pending.reduce<UnitStatusMap>(applyStatusMessage, toStatusMap(fresh)));
      } catch {
        // Mantém o último estado conhecido; a próxima reconexão tenta de novo.
      } finally {
        inFlight = false;
        if (queued && !disposed) {
          queued = false;
          void resync();
        }
      }
    };

    const channel = client
      .channel(`development:${slug}`, { config: { private: true } })
      .on('broadcast', { event: 'unit_status' }, ({ payload }) => {
        if (inFlight) duringFetch.push(payload);
        setStatusMap((m) => applyStatusMessage(m, payload));
      })
      .subscribe((status) => {
        if (disposed) return;
        if (status === 'SUBSCRIBED') {
          setConnection('live');
          void resync();
        } else {
          setConnection(status === 'CLOSED' ? 'offline' : 'connecting');
        }
      });

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void resync();
    };
    const onOnline = () => void resync();
    const onOffline = () => setConnection('offline');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      void client.removeChannel(channel);
    };
  }, [slug]);

  return { units, statusMap, connection };
}
