'use client';
import { useActionState, useState } from 'react';
import { maskBrPhone } from '@/lib/lead-form';
import { MAX_NOTIFICATION_EMAILS, validateConfig, type ConfigField } from '@/lib/panel/config';
import styles from '../painel.module.css';
import { saveConfig, type ConfigState } from './actions';

export function ConfigForm({
  organizationId,
  initial,
}: {
  organizationId: string;
  initial: { whatsapp: string; emails: string; webhookUrl: string };
}) {
  const [values, setValues] = useState(initial);
  const [localErrors, setLocalErrors] = useState<Partial<Record<ConfigField, string>>>({});
  const [state, action, pending] = useActionState<ConfigState, FormData>(saveConfig, {
    status: 'idle',
  });
  const [dirty, setDirty] = useState(false);

  const errors = { ...state.errors, ...localErrors };
  const set = (k: ConfigField, v: string) => {
    setValues((s) => ({ ...s, [k]: v }));
    setLocalErrors((e) => ({ ...e, [k]: undefined }));
    setDirty(true);
  };

  return (
    <form
      className={styles.section}
      action={(fd) => {
        // Mesma validação do servidor, para a resposta ser imediata.
        const check = validateConfig(values);
        if (!check.ok) {
          setLocalErrors(check.errors);
          return;
        }
        setDirty(false);
        action(fd);
      }}
      noValidate
      aria-labelledby="config-title"
    >
      <h2 id="config-title" className={styles.sectionTitle}>
        Contato e notificações
      </h2>
      <input type="hidden" name="organizationId" value={organizationId} />

      <Field id="whatsapp" label="WhatsApp comercial" error={errors.whatsapp}>
        <input
          id="whatsapp"
          name="whatsapp"
          type="tel"
          inputMode="tel"
          placeholder="(16) 99769-4880"
          value={values.whatsapp}
          onChange={(e) => set('whatsapp', maskBrPhone(e.target.value))}
          aria-invalid={!!errors.whatsapp || undefined}
          aria-describedby="whatsapp-hint"
        />
        <small id="whatsapp-hint" className={styles.muted}>
          Botão &quot;Conversar no WhatsApp&quot; da ficha. Vazio: sem botão.
        </small>
      </Field>

      <Field id="emails" label="E-mails de notificação" error={errors.emails}>
        <textarea
          id="emails"
          name="emails"
          rows={2}
          value={values.emails}
          onChange={(e) => set('emails', e.target.value)}
          aria-invalid={!!errors.emails || undefined}
          aria-describedby="emails-hint"
        />
        <small id="emails-hint" className={styles.muted}>
          Separados por vírgula, até {MAX_NOTIFICATION_EMAILS}. Recebem um e-mail a cada lead novo.
        </small>
      </Field>

      <Field id="webhookUrl" label="URL do webhook" error={errors.webhookUrl}>
        <input
          id="webhookUrl"
          name="webhookUrl"
          type="url"
          inputMode="url"
          placeholder="https://…/webhook/vidomo"
          value={values.webhookUrl}
          onChange={(e) => set('webhookUrl', e.target.value)}
          aria-invalid={!!errors.webhookUrl || undefined}
        />
      </Field>

      <div className={styles.formFooter}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? 'Salvando…' : 'Salvar'}
        </button>
        <span role="status" className={state.status === 'error' ? styles.error : styles.muted}>
          {pending
            ? ''
            : dirty
              ? 'Alterações não salvas.'
              : state.status === 'saved'
                ? 'Configuração salva.'
                : (state.message ?? '')}
        </span>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${styles.field} ${styles.wide}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
