'use client';
/**
 * "Ver apartamento": camada por cima da página com o interior detalhado da unidade girando
 * devagar, etiquetas dos cômodos, lista de ambientes e o interesse na unidade.
 *
 * Acessibilidade: diálogo modal (o resto da página fica inerte), foco preso na camada, Esc
 * fecha, botões com rótulo. Ao fechar, o foco volta para quem abriu.
 * Pensado para reaproveitar no painel e no quiosque: recebe tudo por props.
 */
import type { ViewerManifest } from '@vidomo/viewer/types';
import type { UnitStatus } from '@vidomo/viewer/types';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  interestKind,
  similarInterestMessage,
  type InterestKind,
  type LeadSource,
} from '@/lib/lead-form';
import type { PublicContact, PublicRoom, PublicUnit } from '@/lib/public-development';
import { apartmentHeading, areaText } from '@/lib/unit-format';
import { floorText, unitPhrase } from '@/lib/unit-ref';
import styles from './apartment.module.css';
import ex from './explorer.module.css';

// O viewer do apartamento (three.js já está na página) e o formulário: só ao usar.
const Apartment = dynamic(() => import('./ClientOnlyApartment'), { loading: () => null });
const LeadForm = dynamic(() => import('./LeadForm'), {
  loading: () => <p className={ex.formLoading}>Abrindo formulário…</p>,
});

type Panel = 'rooms' | 'form' | 'sent';

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ApartmentOverlay({
  manifest,
  unit,
  status,
  rooms,
  manyTowers = false,
  slug,
  contact,
  leadSource,
  onClose,
}: {
  manifest: ViewerManifest;
  unit: PublicUnit;
  /** Status ao vivo (define "Tenho interesse" × "Quero opções parecidas"). */
  status: UnitStatus;
  rooms: PublicRoom[];
  manyTowers?: boolean;
  slug: string;
  contact: PublicContact | null;
  leadSource: LeadSource;
  onClose: () => void;
}) {
  const [spin, setSpin] = useState(() => !prefersReducedMotion());
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [panel, setPanel] = useState<Panel>('rooms');
  const [kind, setKind] = useState<InterestKind>('unit');
  const [initialMessage, setInitialMessage] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const interestRef = useRef<HTMLButtonElement>(null);
  const titleId = 'apartment-title';
  const phrase = unitPhrase(unit, manyTowers);

  // Foco: entra no "Fechar" ao abrir; volta para quem abriu ao fechar.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    // Foco preso na camada.
    const els = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
      (el) => el.offsetParent !== null,
    );
    if (els.length === 0) return;
    const firstEl = els[0]!;
    const lastEl = els[els.length - 1]!;
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  };

  const openForm = () => {
    const k = interestKind(status);
    setKind(k);
    setInitialMessage(k === 'similar' ? similarInterestMessage(phrase, status) : '');
    setPanel('form');
  };
  const backToRooms = () => {
    setPanel('rooms');
    requestAnimationFrame(() => interestRef.current?.focus());
  };

  return (
    <div
      ref={dialogRef}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
    >
      <header className={styles.head}>
        <div className={styles.titles}>
          <p className={ex.eyebrow}>
            {unit.tower_name} · {floorText(unit)}
          </p>
          <h2 id={titleId} className={styles.title}>
            {apartmentHeading(unit, manyTowers)}
          </h2>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.spin}
            aria-pressed={!spin}
            onClick={() => setSpin((s) => !s)}
          >
            {spin ? 'Parar giro' : 'Girar'}
          </button>
          <button
            ref={closeRef}
            type="button"
            className={ex.close}
            aria-label="Fechar apartamento"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>

      <div className={styles.stage}>
        {!failed && (
          <Apartment
            manifest={manifest}
            unitKey={unit.object_key}
            rooms={rooms}
            autoRotate={spin}
            onInteract={() => setSpin(false)}
            onReady={() => {
              performance.mark('vidomo:apartment-ready');
              setLoaded(true);
            }}
            onError={() => setFailed(true)}
            formatArea={areaText}
          />
        )}
        {(!loaded || failed) && (
          <p className={styles.status} role="status">
            {failed ? 'Não foi possível abrir o apartamento agora.' : 'Carregando apartamento…'}
          </p>
        )}
        <p className={styles.disclaimer}>Imagens ilustrativas</p>
      </div>

      <aside className={styles.side} aria-label="Ambientes e interesse">
        {panel === 'rooms' && (
          <>
            <h3 className={styles.sideTitle}>Ambientes</h3>
            <ul className={styles.rooms}>
              {rooms.map((r) => (
                <li key={r.name}>
                  <span>{r.name}</span>
                  <span className={ex.mono}>{areaText(r.area_m2)}</span>
                </li>
              ))}
            </ul>
            {unit.area_m2 !== null && (
              <p className={styles.total}>
                <span>Área privativa</span>
                <strong className={ex.mono}>{areaText(unit.area_m2)}</strong>
              </p>
            )}
            {contact && (
              <button
                ref={interestRef}
                type="button"
                className={ex.primaryAction}
                onClick={openForm}
              >
                {interestKind(status) === 'similar'
                  ? 'Quero opções parecidas'
                  : 'Tenho interesse nesta unidade'}
              </button>
            )}
          </>
        )}
        {panel === 'form' && contact && (
          <LeadForm
            slug={slug}
            objectKey={unit.object_key}
            unitCode={unit.code}
            towerName={manyTowers ? unit.tower_name : null}
            source={leadSource}
            contact={contact}
            kind={kind}
            initialMessage={initialMessage}
            onCancel={backToRooms}
            onSent={() => setPanel('sent')}
          />
        )}
        {panel === 'sent' && (
          <div className={ex.sent} role="status">
            <p className={ex.sentTitle}>
              {kind === 'similar'
                ? 'Recebemos seu pedido de opções parecidas com a unidade '
                : 'Recebemos seu interesse na unidade '}
              <span className={ex.mono}>{unit.code}</span>
              {manyTowers ? ` do ${unit.tower_name}` : ''}.
            </p>
            <p>A equipe vai falar com você.</p>
            <button type="button" className={ex.secondaryAction} onClick={backToRooms}>
              Voltar aos ambientes
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
