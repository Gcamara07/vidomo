'use client';
import { STATUS_LABELS } from '@vidomo/viewer/styles';
import type { UnitStatus } from '@vidomo/viewer/types';
import { useState } from 'react';
import { getAssetUrl } from '@/lib/assets';
import type { PublicUnit } from '@/lib/public-development';
import { positionText, priceText } from '@/lib/unit-format';
import { StatusSwatch } from './StatusLegend';
import styles from './explorer.module.css';

const area = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Ficha completa da unidade. Painel no desktop, folha inferior no celular.
 * Preço: já resolvido no banco pela regra do empreendimento (aqui só formata).
 */
export function UnitDetails({
  unit,
  status,
  developmentName,
  onClose,
}: {
  unit: PublicUnit;
  /** Status ao vivo (pode ter mudado depois que a página carregou). */
  status: UnitStatus;
  developmentName: string;
  onClose: () => void;
}) {
  // O preço vem da última leitura; se o status mudou para vendida, some na hora.
  const price = priceText({ ...unit, status });
  const position = positionText(unit);

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
      {/* TODO(Bloco 2 — leads): botão "Tenho interesse". */}
    </section>
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
