'use client';
import { useState } from 'react';
import { maskBrPhone, nationalDigits } from '@/lib/lead-form';
import { panelErrorMessage, validateManualLead, type ManualLeadInput } from '@/lib/panel/leads';
import { browserClient } from '@/lib/supabase/browser';
import styles from '../painel.module.css';
import { boardUnitLabel, type BoardDevelopment, type BoardUnit } from './LeadsBoard';

/** Lead manual (estande, telefone): origem manual, consentimento presencial obrigatório. */
export function ManualLeadForm({
  developments,
  units,
  consentText,
  onCancel,
  onCreated,
}: {
  developments: BoardDevelopment[];
  units: BoardUnit[];
  consentText: string | null;
  onCancel: () => void;
  onCreated: (row: Record<string, unknown>) => void;
}) {
  const [developmentId, setDevelopmentId] = useState(developments[0]?.id ?? '');
  const [unitId, setUnitId] = useState('');
  const [input, setInput] = useState<ManualLeadInput>({
    name: '',
    phone: '',
    email: '',
    message: '',
    consentInPerson: false,
  });
  const [problem, setProblem] = useState<{ field: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  const devUnits = units.filter((u) => u.developmentId === developmentId);
  // Já vêm na ordem bloco → andar → unidade; agrupa por bloco (consecutivos).
  const groupedUnits: [string | null, BoardUnit[]][] = [];
  for (const u of devUnits) {
    const last = groupedUnits.at(-1);
    if (last && last[0] === u.towerName) last[1].push(u);
    else groupedUnits.push([u.towerName, [u]]);
  }
  const set = <K extends keyof ManualLeadInput>(k: K, v: ManualLeadInput[K]) => {
    setInput((i) => ({ ...i, [k]: v }));
    if (problem?.field === k) setProblem(null);
  };
  const errorOf = (field: string) => (problem?.field === field ? problem.message : null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const invalid = validateManualLead(input);
    if (invalid) {
      setProblem(invalid);
      document.getElementById(`manual-${invalid.field}`)?.focus();
      return;
    }
    setPending(true);
    const { data, error } = await browserClient().rpc('create_manual_lead', {
      p_development_id: developmentId,
      p_unit_id: unitId || null,
      p_name: input.name,
      p_phone: input.phone.trim() ? nationalDigits(input.phone) : null,
      p_email: input.email.trim() || null,
      p_message: input.message.trim() || null,
      p_consent_in_person: input.consentInPerson,
    });
    setPending(false);
    if (error) {
      setProblem({ field: 'form', message: panelErrorMessage(error) });
      return;
    }
    onCreated(data as Record<string, unknown>);
  }

  return (
    <form className={styles.manualForm} onSubmit={submit} noValidate aria-labelledby="manual-title">
      <h2 id="manual-title" className={styles.sectionTitle}>
        Cadastrar lead manual
      </h2>
      <div className={styles.formGrid}>
        {developments.length > 1 && (
          <label className={styles.field}>
            <span>Empreendimento</span>
            <select
              value={developmentId}
              onChange={(e) => {
                setDevelopmentId(e.target.value);
                setUnitId('');
              }}
            >
              {developments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={styles.field}>
          <span>Unidade (opcional)</span>
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">Sem unidade</option>
            {groupedUnits.map(([tower, list]) =>
              tower ? (
                // Vários blocos: um grupo por bloco, na ordem do cadastro.
                <optgroup key={tower} label={tower}>
                  {list.map((u) => (
                    <option key={u.id} value={u.id} label={`${u.code} · ${u.floorText ?? ''}`}>
                      {boardUnitLabel(u)}
                    </option>
                  ))}
                </optgroup>
              ) : (
                list.map((u) => (
                  <option key={u.id} value={u.id}>
                    {boardUnitLabel(u)}
                  </option>
                ))
              ),
            )}
          </select>
        </label>
        <ManualField id="name" label="Nome" error={errorOf('name')}>
          <input
            id="manual-name"
            value={input.name}
            maxLength={120}
            autoComplete="off"
            onChange={(e) => set('name', e.target.value)}
            aria-invalid={!!errorOf('name') || undefined}
          />
        </ManualField>
        <ManualField id="phone" label="Telefone" error={errorOf('phone')}>
          <input
            id="manual-phone"
            type="tel"
            inputMode="tel"
            value={input.phone}
            placeholder="(16) 99769-4880"
            onChange={(e) => set('phone', maskBrPhone(e.target.value))}
            aria-invalid={!!errorOf('phone') || undefined}
          />
        </ManualField>
        <ManualField id="email" label="E-mail" error={errorOf('email')}>
          <input
            id="manual-email"
            type="email"
            value={input.email}
            maxLength={254}
            onChange={(e) => set('email', e.target.value)}
            aria-invalid={!!errorOf('email') || undefined}
          />
        </ManualField>
        <ManualField id="message" label="Observação (opcional)" error={errorOf('message')} wide>
          <textarea
            id="manual-message"
            rows={2}
            maxLength={1000}
            value={input.message}
            onChange={(e) => set('message', e.target.value)}
          />
        </ManualField>
      </div>
      <label className={styles.check}>
        <input
          id="manual-consentInPerson"
          type="checkbox"
          checked={input.consentInPerson}
          onChange={(e) => set('consentInPerson', e.target.checked)}
          aria-invalid={!!errorOf('consentInPerson') || undefined}
        />
        Consentimento obtido presencialmente
      </label>
      {consentText && <p className={styles.consentHelp}>{consentText}</p>}
      {(errorOf('consentInPerson') || errorOf('form')) && (
        <p className={styles.error} role="alert">
          {errorOf('consentInPerson') ?? errorOf('form')}
        </p>
      )}
      <div className={styles.dialogActions}>
        <button type="button" className={styles.secondary} onClick={onCancel} disabled={pending}>
          Cancelar
        </button>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? 'Salvando…' : 'Salvar lead'}
        </button>
      </div>
    </form>
  );
}

function ManualField({
  id,
  label,
  error,
  wide,
  children,
}: {
  id: string;
  label: string;
  error: string | null;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`${styles.field} ${wide ? styles.wide : ''}`}>
      <label htmlFor={`manual-${id}`}>{label}</label>
      {children}
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
