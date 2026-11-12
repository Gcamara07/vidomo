import { STATUS_LABELS, swatchBackground } from '@vidomo/viewer/styles';
import { UNIT_STATUSES, type UnitStatus } from '@vidomo/viewer/types';
import styles from './explorer.module.css';

export function StatusSwatch({ status }: { status: UnitStatus }) {
  return (
    <span aria-hidden className={styles.swatch} style={{ background: swatchBackground(status) }} />
  );
}

export function StatusLegend({ counts }: { counts: Record<UnitStatus, number> }) {
  return (
    <ul className={styles.legend} aria-label="Legenda de status">
      {UNIT_STATUSES.map((s) => (
        <li key={s}>
          <StatusSwatch status={s} />
          <span>{STATUS_LABELS[s]}</span>
          <span className={styles.count}>{counts[s]}</span>
        </li>
      ))}
    </ul>
  );
}
