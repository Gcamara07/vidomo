'use client';
import { useEffect, useRef, useState } from 'react';
import { panelErrorMessage, type PanelLead } from '@/lib/panel/leads';
import { browserClient } from '@/lib/supabase/browser';
import styles from '../painel.module.css';

/**
 * Exclusão a pedido do titular (LGPD), só admin. Apaga os dados de vez; fica um registro
 * sem dado pessoal (quem, quando, motivo) e, com webhook ativo, o aviso lead.deleted.
 */
export function DeleteLeadDialog({
  lead,
  onCancel,
  onDeleted,
}: {
  lead: PanelLead;
  onCancel: () => void;
  onDeleted: (id: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  async function confirm() {
    setPending(true);
    setError(null);
    const { error: e } = await browserClient().rpc('delete_lead', {
      p_lead_id: lead.id,
      p_reason: reason.trim() || null,
    });
    setPending(false);
    if (e) {
      setError(panelErrorMessage(e));
      return;
    }
    onDeleted(lead.id);
  }

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="delete-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <h2 id="delete-title" className={styles.dialogTitle}>
        Excluir o lead de {lead.name}?
      </h2>
      <p>
        Use quando o titular pedir a exclusão (LGPD). Nome, telefone, e-mail e mensagem são apagados
        de vez e não dá para desfazer. Fica só um registro sem dados pessoais: quem excluiu, quando
        e o motivo.
      </p>
      <label className={styles.field}>
        <span>Motivo (opcional, sem nome nem contato)</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          placeholder="pedido do titular por e-mail"
        />
      </label>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.dialogActions}>
        <button type="button" className={styles.secondary} onClick={onCancel} disabled={pending}>
          Cancelar
        </button>
        <button type="button" className={styles.danger} onClick={confirm} disabled={pending}>
          {pending ? 'Excluindo…' : 'Excluir definitivamente'}
        </button>
      </div>
    </dialog>
  );
}
