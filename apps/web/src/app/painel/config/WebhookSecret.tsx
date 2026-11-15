'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { panelErrorMessage } from '@/lib/panel/leads';
import { browserClient } from '@/lib/supabase/browser';
import styles from '../painel.module.css';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

/**
 * Segredo de assinatura do webhook: gerado no banco (Vault) e mostrado UMA vez, aqui, para
 * colar no n8n. Depois ninguém o lê pela API; perdeu, gera outro.
 */
export function WebhookSecret({
  organizationId,
  secretSetAt,
}: {
  organizationId: string;
  secretSetAt: string | null;
}) {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (
      secretSetAt &&
      !window.confirm(
        'Gerar um novo segredo invalida o atual: o n8n vai recusar os envios até você colar o novo segredo lá. Continuar?',
      )
    )
      return;
    setPending(true);
    setError(null);
    const { data, error: e } = await browserClient().rpc('rotate_webhook_secret', {
      p_organization_id: organizationId,
    });
    setPending(false);
    if (e) {
      setError(panelErrorMessage(e));
      return;
    }
    setSecret(data as string);
    setCopied(false);
    router.refresh(); // atualiza "gerado em" e libera o "Enviar teste"
  }

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={styles.subsection}>
      <h3 className={styles.subTitle}>Segredo de assinatura</h3>
      <p className={styles.muted}>
        {secretSetAt
          ? `Gerado em ${dateTime.format(new Date(secretSetAt))}.`
          : 'Nenhum segredo gerado: o webhook não é enviado sem ele.'}
      </p>
      {secret && (
        <div className={styles.secretBox} role="status">
          <p>
            <strong>Copie agora:</strong> este segredo não será mostrado de novo.
          </p>
          <code className={styles.secret}>{secret}</code>
          <button type="button" className={styles.secondary} onClick={copy}>
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      )}
      <button type="button" className={styles.secondary} onClick={generate} disabled={pending}>
        {pending ? 'Gerando…' : secretSetAt ? 'Gerar novo segredo' : 'Gerar segredo'}
      </button>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
