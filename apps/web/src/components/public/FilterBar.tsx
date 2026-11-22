'use client';
import { STATUS_LABELS } from '@vidomo/viewer/styles';
import { UNIT_STATUSES, type UnitStatus } from '@vidomo/viewer/types';
import type { Filters } from '@/lib/explore';
import { StatusSwatch } from './StatusLegend';
import styles from './explorer.module.css';

/**
 * Legenda que também é filtro: tocar num status liga/desliga; dormitórios ao lado.
 * As contagens respeitam o filtro de dormitórios; as unidades que não atendem aos filtros
 * ficam esmaecidas no 3D.
 */
export function FilterBar({
  filters,
  counts,
  matching,
  total,
  scope = null,
  bedroomOptions,
  isDefault,
  onToggleStatus,
  onToggleBedrooms,
  onClear,
}: {
  filters: Filters;
  counts: Record<UnitStatus, number>;
  matching: number;
  total: number;
  /** Contagens só de um bloco (ex.: "Bloco 09"); null = o empreendimento todo. */
  scope?: string | null;
  bedroomOptions: number[];
  isDefault: boolean;
  onToggleStatus: (s: UnitStatus) => void;
  onToggleBedrooms: (b: number) => void;
  onClear: () => void;
}) {
  return (
    <div className={styles.filters}>
      <ul className={styles.legend} aria-label="Status (toque para filtrar)">
        {UNIT_STATUSES.map((s) => (
          <li key={s}>
            <button
              type="button"
              className={styles.chip}
              aria-pressed={filters.statuses.has(s)}
              onClick={() => onToggleStatus(s)}
            >
              <StatusSwatch status={s} />
              <span>{STATUS_LABELS[s]}</span>
              <span className={styles.count}>{counts[s]}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.filterRow}>
        {bedroomOptions.map((b) => (
          <button
            key={b}
            type="button"
            className={styles.chip}
            aria-pressed={filters.bedrooms.has(b)}
            onClick={() => onToggleBedrooms(b)}
          >
            {b} dorms
          </button>
        ))}
        <span className={styles.matching} aria-live="polite">
          {matching} de {total}
          {scope ? ` · ${scope}` : ''}
        </span>
        {!isDefault && (
          <button type="button" className={styles.clear} onClick={onClear}>
            Limpar
          </button>
        )}
      </div>
    </div>
  );
}
