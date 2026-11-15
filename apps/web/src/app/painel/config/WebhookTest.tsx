'use client';
import { useEffect, useState } from 'react';
import { panelErrorMessage } from '@/lib/panel/leads';
import { browserClient } from '@/lib/supabase/browser';
import styles from '../painel.module.css';

type Delivery = {
  status: 'pending' | 'sending' | 'delivered' | 'failed';
  attempts: number;
  last_status_code: number | null;
  last_error: string | null;
};

/** Acompanha a entrega por até 2 minutos (o envio sai pela fila, em segundo plano). */
const POLL_MS = 2000;
const POLL_FOR_MS = 120_000;

function describe(d: Delivery | null): string {
  if (!d) return 'Na fila…';
  switch (d.status) {
    case 'pending':
      return d.attempts > 0
        ? `Falhou na tentativa ${d.attempts}${d.last_status_code ? ` (HTTP ${d.last_status_code})` : ''}; vai tentar de novo.`
        : 'Na fila…';
    case 'sending':
      return 'Enviando…';
    case 'delivered':
      return `Entregue${d.last_status_code ? ` (HTTP ${d.last_status_code})` : ''}.`;
    case 'failed':
      return `Falhou${d.last_status_code ? ` (HTTP ${d.last_status_code})` : ''}${d.last_error ? `: ${d.last_error}` : ''}.`;
  }
}

/** "Enviar teste": enfileira um POST de teste (dados fictícios) para o webhook ativo. */
export function WebhookTest({ organizationId, ready }: { organizationId: string; ready: boolean }) {
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deliveryId) return;
    const started = Date.now();
    let stopped = false;
    const tick = async () => {
      const { data } = await browserClient()
        .from('notification_deliveries')
        .select('status, attempts, last_status_code, last_error')
        .eq('id', deliveryId)
        .maybeSingle();
      if (stopped) return;
      if (data) setDelivery(data as Delivery);
      const done = data && (data.status === 'delivered' || data.status === 'failed');
      if (!done && Date.now() - started < POLL_FOR_MS) setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, [deliveryId]);

  async function send() {
    setPending(true);
    setError(null);
    setDelivery(null);
    const { data, error: e } = await browserClient().rpc('enqueue_webhook_test', {
      p_organization_id: organizationId,
    });
    setPending(false);
    if (e) {
      setError(panelErrorMessage(e));
      return;
    }
    setDeliveryId(data as string);
  }

  return (
    <div className={styles.subsection}>
      <h3 className={styles.subTitle}>Teste</h3>
      <p className={styles.muted}>
        Envia um POST de teste (<code>&quot;event&quot;: &quot;test&quot;</code>, dados fictícios)
        para a URL salva.
      </p>
      <button
        type="button"
        className={styles.secondary}
        onClick={send}
        disabled={!ready || pending}
      >
        {pending ? 'Enfileirando…' : 'Enviar teste'}
      </button>
      {!ready && (
        <p className={styles.muted}>Salve a URL e gere o segredo para habilitar o teste.</p>
      )}
      {deliveryId && (
        <p role="status" className={delivery?.status === 'failed' ? styles.error : styles.muted}>
          {describe(delivery)} <span className={styles.mono}>({deliveryId.slice(0, 8)})</span>
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
