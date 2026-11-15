'use client';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import {
  FIELD_OF_ERROR,
  LEAD_ERROR_MESSAGES,
  MESSAGE_MAX,
  NAME_MAX,
  maskBrPhone,
  splitConsentText,
  validateLead,
  type InterestKind,
  type LeadErrorCode,
  type LeadField,
  type LeadInput,
  type LeadResult,
  type LeadSource,
} from '@/lib/lead-form';
import type { PublicContact } from '@/lib/public-development';
import styles from './explorer.module.css';

/** Envia para a rota do servidor (que tem a chave de ingestão). */
async function postLead(input: LeadInput): Promise<LeadResult> {
  try {
    const res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = (await res.json()) as LeadResult;
    return typeof body?.ok === 'boolean' ? body : { ok: false, error: 'unknown' };
  } catch {
    return { ok: false, error: 'unknown' };
  }
}

/** Política padrão quando a incorporadora não configurou a própria. */
const DEFAULT_PRIVACY_URL = '/privacidade';

/**
 * Formulário "Tenho interesse nesta unidade". Carregado sob demanda (dynamic import) e
 * mostrado dentro da ficha: no celular é a mesma folha inferior, então o viewer continua
 * enquadrando a unidade na área livre acima dela.
 */
export default function LeadForm({
  slug,
  objectKey,
  unitCode,
  source,
  contact,
  kind = 'unit',
  initialMessage = '',
  onCancel,
  onSent,
}: {
  slug: string;
  objectKey: string;
  unitCode: string;
  source: LeadSource;
  contact: PublicContact;
  /** 'similar': vendida/indisponível, pede opções parecidas com a unidade como referência. */
  kind?: InterestKind;
  /** Mensagem pré-preenchida (editável). */
  initialMessage?: string;
  onCancel: () => void;
  onSent: () => void;
}) {
  const id = useId();
  const fieldId = (f: string) => `${id}-${f}`;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState(initialMessage);
  const [consent, setConsent] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: LeadField; error: LeadErrorCode } | null>(
    null,
  );
  const [formError, setFormError] = useState<LeadErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  // Ao abrir, o foco vai para o título do formulário (sem abrir o teclado de surpresa).
  useEffect(() => titleRef.current?.focus(), []);

  const focusField = (field: LeadField) =>
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus(),
    );

  const errorFor = (field: LeadField) =>
    fieldError?.field === field ? LEAD_ERROR_MESSAGES[fieldError.error] : null;

  const clearErrorOf = (field: LeadField) => {
    if (fieldError?.field === field) setFieldError(null);
    setFormError(null);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const invalid = validateLead({ name, phone, email, message, consent });
    if (invalid) {
      setFieldError(invalid);
      focusField(invalid.field);
      return;
    }
    const website = String(new FormData(event.currentTarget).get('website') ?? '');
    setFormError(null);
    startTransition(async () => {
      const result = await postLead({
        slug,
        objectKey,
        name,
        phone,
        email,
        message,
        consent,
        consentVersion: contact.consent_version,
        source,
        website,
      });
      if (result.ok) {
        onSent();
        return;
      }
      const field = result.field ?? FIELD_OF_ERROR[result.error];
      if (field) {
        setFieldError({ field, error: result.error });
        focusField(field);
      } else {
        setFormError(result.error);
      }
    });
  };

  // Com o teclado aberto, garante que o campo em foco fique à vista dentro da folha.
  const keepInView = (event: React.FocusEvent<HTMLFormElement>) => {
    const target = event.target as HTMLElement;
    setTimeout(() => target.scrollIntoView({ block: 'nearest' }), 300);
  };

  const consentText = splitConsentText(contact.consent_text);
  const privacyUrl = contact.privacy_policy_url ?? DEFAULT_PRIVACY_URL;

  const describedBy = (field: LeadField, hint?: string) =>
    [hint, errorFor(field) ? fieldId(`${field}-error`) : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <form
      ref={formRef}
      className={styles.leadForm}
      onSubmit={submit}
      onFocus={keepInView}
      noValidate
      aria-labelledby={fieldId('title')}
      aria-busy={pending || undefined}
    >
      <h3 id={fieldId('title')} ref={titleRef} tabIndex={-1} className={styles.formTitle}>
        {kind === 'similar' ? 'Opções parecidas com a unidade' : 'Tenho interesse na unidade'}{' '}
        <span className={styles.mono}>{unitCode}</span>
      </h3>

      <div className={styles.field}>
        <label htmlFor={fieldId('name')}>Nome</label>
        <input
          id={fieldId('name')}
          data-field="name"
          name="name"
          autoComplete="name"
          enterKeyHint="next"
          maxLength={NAME_MAX}
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            clearErrorOf('name');
          }}
          aria-invalid={!!errorFor('name') || undefined}
          aria-describedby={describedBy('name')}
        />
        <FieldError id={fieldId('name-error')} text={errorFor('name')} />
      </div>

      <div className={styles.field}>
        <label htmlFor={fieldId('phone')}>Telefone (WhatsApp)</label>
        <input
          id={fieldId('phone')}
          data-field="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          enterKeyHint="next"
          placeholder="(16) 99769-4880"
          maxLength={16}
          required
          value={phone}
          onChange={(e) => {
            setPhone(maskBrPhone(e.target.value));
            clearErrorOf('phone');
          }}
          aria-invalid={!!errorFor('phone') || undefined}
          aria-describedby={describedBy('phone')}
        />
        <FieldError id={fieldId('phone-error')} text={errorFor('phone')} />
      </div>

      <div className={styles.field}>
        <label htmlFor={fieldId('email')}>
          E-mail <span className={styles.optional}>(opcional)</span>
        </label>
        <input
          id={fieldId('email')}
          data-field="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          enterKeyHint="next"
          maxLength={254}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearErrorOf('email');
          }}
          aria-invalid={!!errorFor('email') || undefined}
          aria-describedby={describedBy('email')}
        />
        <FieldError id={fieldId('email-error')} text={errorFor('email')} />
      </div>

      <div className={styles.field}>
        <label htmlFor={fieldId('message')}>
          Mensagem <span className={styles.optional}>(opcional)</span>
        </label>
        <textarea
          id={fieldId('message')}
          data-field="message"
          name="message"
          rows={3}
          maxLength={MESSAGE_MAX}
          enterKeyHint="enter"
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            clearErrorOf('message');
          }}
          aria-invalid={!!errorFor('message') || undefined}
          aria-describedby={describedBy('message')}
        />
        <FieldError id={fieldId('message-error')} text={errorFor('message')} />
      </div>

      {/* Armadilha para robôs: fora da tela, fora do Tab e escondida de leitores de tela. */}
      <div className={styles.honeypot} aria-hidden="true">
        <label htmlFor={fieldId('website')}>Não preencha este campo</label>
        <input
          id={fieldId('website')}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <div className={styles.consent}>
        <input
          id={fieldId('consent')}
          data-field="consent"
          type="checkbox"
          checked={consent}
          onChange={(e) => {
            setConsent(e.target.checked);
            clearErrorOf('consent');
          }}
          aria-invalid={!!errorFor('consent') || undefined}
          aria-describedby={describedBy('consent')}
        />
        <label htmlFor={fieldId('consent')}>
          {consentText.before}
          <a href={privacyUrl} target="_blank" rel="noopener noreferrer">
            {consentText.term}
          </a>
          {consentText.after}
        </label>
      </div>
      <FieldError id={fieldId('consent-error')} text={errorFor('consent')} />

      <p className={styles.formStatus} role="alert">
        {formError ? LEAD_ERROR_MESSAGES[formError] : null}
      </p>

      <div className={styles.formActions}>
        <button type="submit" className={styles.primaryAction} disabled={pending}>
          {pending ? 'Enviando…' : kind === 'similar' ? 'Enviar pedido' : 'Enviar interesse'}
        </button>
        <button type="button" className={styles.secondaryAction} onClick={onCancel}>
          Voltar à ficha
        </button>
      </div>
    </form>
  );
}

function FieldError({ id, text }: { id: string; text: string | null }) {
  if (!text) return null;
  return (
    <p id={id} className={styles.fieldError}>
      {text}
    </p>
  );
}
