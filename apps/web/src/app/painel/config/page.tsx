import type { Metadata } from 'next';
import { getPanelContext } from '@/lib/panel/context';
import { formatPhone } from '@/lib/panel/leads';
import { serverClient } from '@/lib/supabase/server';
import styles from '../painel.module.css';
import { ConfigForm } from './ConfigForm';
import { WebhookSecret } from './WebhookSecret';
import { WebhookTest } from './WebhookTest';

export const metadata: Metadata = { title: 'Configuração · Vidomo' };
export const dynamic = 'force-dynamic';

/**
 * Configuração comercial (só admin): WhatsApp, e-mails de notificação e webhook.
 * Tela mínima; o admin completo é o Bloco 5.
 * TODO(admin completo): seletor de organização quando o usuário for admin de mais de uma.
 */
export default async function ConfigPage() {
  const ctx = await getPanelContext();
  const org = ctx.memberships.find((m) => m.role === 'admin');

  if (!org) {
    return (
      <main className={styles.page}>
        <header className={styles.pageHead}>
          <h1 className={styles.pageTitle}>Configuração</h1>
        </header>
        <p className={styles.empty}>Só administradores acessam a configuração.</p>
      </main>
    );
  }

  const supabase = await serverClient();
  const { data: settings, error } = await supabase
    .from('organization_settings')
    .select('whatsapp_number, notification_emails, webhook_url, webhook_secret_set_at')
    .eq('organization_id', org.organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const webhookUrl = (settings?.webhook_url as string | null) ?? '';
  const secretSetAt = (settings?.webhook_secret_set_at as string | null) ?? null;

  return (
    <main className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>{org.organizationName}</p>
          <h1 className={styles.pageTitle}>Configuração</h1>
        </div>
      </header>

      <ConfigForm
        organizationId={org.organizationId}
        initial={{
          whatsapp: formatPhone((settings?.whatsapp_number as string | null) ?? null),
          emails: ((settings?.notification_emails as string[] | null) ?? []).join(', '),
          webhookUrl,
        }}
      />

      <section className={styles.section} aria-labelledby="webhook-title">
        <h2 id="webhook-title" className={styles.sectionTitle}>
          Webhook
        </h2>
        <p className={styles.muted}>
          A cada lead novo, a Vidomo envia um POST com os dados do lead e da unidade para a URL
          acima, assinado com HMAC-SHA256 no cabeçalho <code>X-Vidomo-Signature</code>. Sem segredo
          gerado, nada é enviado.
        </p>
        <WebhookSecret organizationId={org.organizationId} secretSetAt={secretSetAt} />
        <WebhookTest
          organizationId={org.organizationId}
          ready={Boolean(webhookUrl && secretSetAt)}
        />
      </section>
    </main>
  );
}
