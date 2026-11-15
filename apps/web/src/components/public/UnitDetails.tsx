'use client';
import { STATUS_LABELS } from '@vidomo/viewer/styles';
import type { UnitStatus } from '@vidomo/viewer/types';
import dynamic from 'next/dynamic';
import { useRef, useState, useSyncExternalStore } from 'react';
import { getAssetUrl } from '@/lib/assets';
import {
  interestKind,
  similarInterestMessage,
  unitLink,
  whatsappHref,
  whatsappUnitMessage,
  type InterestKind,
  type LeadSource,
} from '@/lib/lead-form';
import type { PublicContact, PublicUnit } from '@/lib/public-development';
import { positionText, priceText } from '@/lib/unit-format';
import { StatusSwatch } from './StatusLegend';
import styles from './explorer.module.css';

// O formulário só baixa quando o comprador toca em "Tenho interesse".
const LeadForm = dynamic(() => import('./LeadForm'), {
  loading: () => <p className={styles.formLoading}>Abrindo formulário…</p>,
});

type View = 'details' | 'form' | 'sent';

const noopSubscribe = () => () => {};
/** Origem da página no navegador; '' no servidor (o link é montado depois da hidratação). */
function useOrigin() {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => '',
  );
}

const area = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Ficha completa da unidade. Painel no desktop, folha inferior no celular.
 * Preço: já resolvido no banco pela regra do empreendimento (aqui só formata).
 */
export function UnitDetails({
  unit,
  status,
  slug,
  developmentName,
  contact,
  leadSource,
  onClose,
}: {
  unit: PublicUnit;
  /** Status ao vivo (pode ter mudado depois que a página carregou). */
  status: UnitStatus;
  slug: string;
  developmentName: string;
  contact: PublicContact | null;
  leadSource: LeadSource;
  onClose: () => void;
}) {
  // O preço vem da última leitura; se o status mudou para vendida, some na hora.
  const price = priceText({ ...unit, status });
  const position = positionText(unit);
  const [view, setView] = useState<View>('details');
  // Fixado ao abrir: se o status mudar com o formulário aberto, o pedido não muda de tipo.
  const [kind, setKind] = useState<InterestKind>('unit');
  const [initialMessage, setInitialMessage] = useState('');
  const openForm = () => {
    const k = interestKind(status);
    setKind(k);
    setInitialMessage(k === 'similar' ? similarInterestMessage(unit.code, status) : '');
    setView('form');
  };
  const interestRef = useRef<HTMLButtonElement>(null);
  const backToDetails = () => {
    setView('details');
    // Devolve o foco ao botão que abriu o formulário (teclado e leitor de tela).
    requestAnimationFrame(() => interestRef.current?.focus());
  };

  return (
    <section className={styles.details} aria-labelledby="unit-title">
      <header className={styles.detailsHead}>
        <div>
          <p className={styles.eyebrow}>
            Torre {unit.tower_code} · {unit.floor_number}º andar
          </p>
          <h2 id="unit-title" className={styles.unitTitle}>
            Unidade <span className={styles.mono}>{unit.code}</span>
          </h2>
        </div>
        <div className={styles.detailsActions}>
          <ShareButton title={`${developmentName} · Unidade ${unit.code}`} />
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Fechar ficha"
          >
            ×
          </button>
        </div>
      </header>

      {view === 'form' && contact && (
        <LeadForm
          slug={slug}
          objectKey={unit.object_key}
          unitCode={unit.code}
          source={leadSource}
          contact={contact}
          kind={kind}
          initialMessage={initialMessage}
          onCancel={backToDetails}
          onSent={() => setView('sent')}
        />
      )}

      {view === 'sent' && (
        <div className={styles.sent} role="status">
          <p className={styles.sentTitle}>
            {kind === 'similar' ? (
              <>
                Recebemos seu pedido de opções parecidas com a unidade{' '}
                <span className={styles.mono}>{unit.code}</span>.
              </>
            ) : (
              <>
                Recebemos seu interesse na unidade <span className={styles.mono}>{unit.code}</span>.
              </>
            )}
          </p>
          <p>A equipe vai falar com você.</p>
          <button type="button" className={styles.secondaryAction} onClick={backToDetails}>
            Voltar à ficha
          </button>
        </div>
      )}

      {view === 'details' && (
        <UnitInfo
          unit={unit}
          status={status}
          price={price}
          position={position}
          slug={slug}
          developmentName={developmentName}
          contact={contact}
          interestRef={interestRef}
          onInterest={openForm}
        />
      )}
    </section>
  );
}

/** Corpo da ficha: status e preço, ações de contato, dados e planta. */
function UnitInfo({
  unit,
  status,
  price,
  position,
  slug,
  developmentName,
  contact,
  interestRef,
  onInterest,
}: {
  unit: PublicUnit;
  status: UnitStatus;
  price: ReturnType<typeof priceText>;
  position: string | null;
  slug: string;
  developmentName: string;
  contact: PublicContact | null;
  interestRef: React.RefObject<HTMLButtonElement | null>;
  onInterest: () => void;
}) {
  return (
    <>
      <div className={styles.priceRow} data-sold={status === 'sold' || undefined}>
        <span className={styles.statusValue}>
          <StatusSwatch status={status} />
          {STATUS_LABELS[status]}
        </span>
        {price && (
          <span className={styles.price}>
            {price.prefix && <small>{price.prefix} </small>}
            {price.value}
          </span>
        )}
      </div>

      <ContactActions
        unit={unit}
        status={status}
        slug={slug}
        developmentName={developmentName}
        contact={contact}
        interestRef={interestRef}
        onInterest={onInterest}
      />

      <dl className={styles.facts}>
        <div>
          <dt>Planta</dt>
          <dd>{unit.unit_type_name ?? '—'}</dd>
        </div>
        <div>
          <dt>Área privativa</dt>
          <dd className={styles.mono}>
            {unit.area_m2 === null ? '—' : `${area.format(unit.area_m2)} m²`}
          </dd>
        </div>
        <div>
          <dt>Dormitórios</dt>
          <dd className={styles.mono}>{unit.bedrooms ?? '—'}</dd>
        </div>
        <div>
          <dt>Suítes</dt>
          <dd className={styles.mono}>{unit.suites ?? '—'}</dd>
        </div>
        <div>
          <dt>Posição</dt>
          <dd>{position ?? '—'}</dd>
        </div>
        <div>
          <dt>Código</dt>
          <dd className={styles.mono}>{unit.object_key}</dd>
        </div>
      </dl>

      <PlanImage unit={unit} />
    </>
  );
}

/**
 * "Tenho interesse nesta unidade" (ou "Quero opções parecidas", em vendida/indisponível) e
 * WhatsApp com mensagem pronta.
 */
function ContactActions({
  unit,
  status,
  slug,
  developmentName,
  contact,
  interestRef,
  onInterest,
}: {
  unit: PublicUnit;
  status: UnitStatus;
  slug: string;
  developmentName: string;
  contact: PublicContact | null;
  interestRef: React.RefObject<HTMLButtonElement | null>;
  onInterest: () => void;
}) {
  const origin = useOrigin();
  if (!contact) return null;
  const number = contact.whatsapp_number;
  const href =
    number && origin
      ? whatsappHref(
          number,
          whatsappUnitMessage(
            unit.code,
            developmentName,
            unitLink(origin, slug, unit.code),
            status,
          ),
        )
      : null;

  // Só a contagem (slug + unidade), sem dado pessoal; sendBeacon sobrevive à troca de app.
  const countClick = () => {
    const body = JSON.stringify({ slug, objectKey: unit.object_key });
    if (!navigator.sendBeacon?.('/api/whatsapp-click', body)) {
      void fetch('/api/whatsapp-click', { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  };

  return (
    <div className={styles.contactActions}>
      <button ref={interestRef} type="button" className={styles.primaryAction} onClick={onInterest}>
        {interestKind(status) === 'similar'
          ? 'Quero opções parecidas'
          : 'Tenho interesse nesta unidade'}
      </button>
      {number && (
        <a
          className={styles.whatsapp}
          href={href ?? undefined}
          aria-disabled={!href || undefined}
          target="_blank"
          rel="noopener noreferrer"
          onClick={countClick}
        >
          Conversar no WhatsApp
        </a>
      )}
    </div>
  );
}

/** Planta 2D do Storage (bucket plans) ou placeholder no estilo da marca. */
function PlanImage({ unit }: { unit: PublicUnit }) {
  if (unit.plan_image_path) {
    return (
      <figure className={styles.plan}>
        {/* eslint-disable-next-line @next/next/no-img-element -- imagem do Storage, sem otimizador */}
        <img
          src={getAssetUrl(unit.plan_image_path, 'plans')}
          alt={`Planta ${unit.unit_type_name ?? ''}`.trim()}
          loading="lazy"
        />
      </figure>
    );
  }
  return (
    <figure className={`${styles.plan} ${styles.planPlaceholder}`}>
      <svg viewBox="0 0 120 70" aria-hidden className={styles.planSketch}>
        <rect x="4" y="4" width="112" height="62" />
        <path d="M4 34h52M56 4v62M84 34v32M56 34h28" />
      </svg>
      <figcaption>Planta disponível em breve</figcaption>
    </figure>
  );
}

/** Web Share API no celular (quando houver); senão copia o link da vista atual. */
function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = window.location.href;
    const canShare =
      typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;
    try {
      if (canShare) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Compartilhamento cancelado pelo usuário: nada a fazer.
    }
  };
  return (
    <button type="button" className={styles.share} onClick={share}>
      <span aria-live="polite">{copied ? 'Link copiado' : 'Copiar link'}</span>
    </button>
  );
}
