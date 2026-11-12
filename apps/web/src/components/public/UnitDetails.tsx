import { STATUS_LABELS } from '@vidomo/viewer/styles';
import type { UnitStatus } from '@vidomo/viewer/types';
import type { PublicUnit } from '@/lib/public-development';
import { StatusSwatch } from './StatusLegend';
import styles from './explorer.module.css';

const area = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Ficha da unidade tocada. Painel no desktop, folha inferior no celular. Sem preço. */
export function UnitDetails({
  unit,
  status,
  onClose,
}: {
  unit: PublicUnit;
  status: UnitStatus;
  onClose: () => void;
}) {
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
        <button type="button" className={styles.close} onClick={onClose} aria-label="Fechar ficha">
          ×
        </button>
      </header>

      <dl className={styles.facts}>
        <div>
          <dt>Status</dt>
          <dd className={styles.statusValue}>
            <StatusSwatch status={status} />
            {STATUS_LABELS[status]}
          </dd>
        </div>
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
          <dt>Código</dt>
          <dd className={styles.mono}>{unit.object_key}</dd>
        </div>
      </dl>
      {/* TODO(leads): botão "Tenho interesse" — fora desta fatia. */}
    </section>
  );
}
