import { swatchBackground } from '@vidomo/viewer/styles';
import type { UnitStatus } from '@vidomo/viewer/types';
import styles from './explorer.module.css';

/** Amostra de cor/hachura do status (mesma aparência do 3D). Usada na legenda e na ficha. */
export function StatusSwatch({ status }: { status: UnitStatus }) {
  return (
    <span aria-hidden className={styles.swatch} style={{ background: swatchBackground(status) }} />
  );
}
