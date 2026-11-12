'use client';
// Só tipo: não puxa o supabase-js para o bundle inicial.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UnitStatusMap } from '@vidomo/viewer/types';
import { useEffect, useState } from 'react';
import {
  applyStatusMessage,
  fetchPublicUnits,
  toStatusMap,
  type PublicUnit,
} from './public-development';

type Client = SupabaseClient;
type Channel = ReturnType<Client['channel']>;

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
 * - O supabase-js é importado sob demanda e só quando `enabled`: não entra no JS inicial
 *   e não disputa banda com o three.js. O HTML já traz os status do servidor, e a releitura
 *   ao conectar cobre o que mudou nesse intervalo.
 */
export function useLiveUnitStatus(
  slug: string,
  initialUnits: PublicUnit[],
  /** Só conecta quando true (a página adia até o prédio ficar interativo). */
  enabled = true,
) {
  const [units, setUnits] = useState(initialUnits);
  const [statusMap, setStatusMap] = useState<UnitStatusMap>(() => toStatusMap(initialUnits));
  const [connection, setConnection] = useState<LiveConnection>('connecting');

  useEffect(() => {
    if (!enabled) return;
    let client: Client | null = null;
    let channel: Channel | null = null;
    let disposed = false;
    let inFlight = false;
    let queued = false;
    let duringFetch: unknown[] = [];

    const resync = async () => {
      if (!client) return; // ainda carregando o supabase-js; a assinatura relê ao conectar
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

    void (async () => {
      const { browserClient } = await import('./supabase/browser');
      if (disposed) return;
      client = browserClient();
      channel = client
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
    })();

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
      if (client && channel) void client.removeChannel(channel);
    };
  }, [slug, enabled]);

  return { units, statusMap, connection };
}
