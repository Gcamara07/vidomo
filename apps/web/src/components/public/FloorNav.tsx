'use client';
import { useEffect, useRef } from 'react';
import type { FloorEntry } from '@/lib/explore';
import styles from './explorer.module.css';

/**
 * Seletor de andares. Celular: faixa horizontal rolável acima da folha inferior.
 * Desktop: coluna vertical ao lado do prédio, do mais alto para o mais baixo.
 * Cada andar mostra quantas unidades estão livres (sem filtros).
 */
export function FloorNav({
  floors,
  mode,
  activeFloor,
  onFloor,
  onBuilding,
}: {
  floors: FloorEntry[];
  mode: 'building' | 'floor';
  activeFloor: string | null;
  onFloor: (key: string) => void;
  onBuilding: () => void;
}) {
  const navRef = useRef<HTMLElement>(null);

  // Mantém o andar ativo visível na faixa (celular) ou na coluna (desktop).
  useEffect(() => {
    if (mode !== 'floor' || !activeFloor) return;
    const btn = navRef.current?.querySelector<HTMLElement>(`[data-floor="${activeFloor}"]`);
    btn?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [mode, activeFloor]);

  return (
    <nav ref={navRef} className={styles.floorNav} aria-label="Andares">
      <button
        type="button"
        className={styles.floorBtn}
        aria-pressed={mode === 'building'}
        onClick={onBuilding}
      >
        {mode === 'floor' ? 'Ver prédio' : 'Prédio'}
      </button>
      {floors.map((f) => {
        const on = mode === 'floor' && activeFloor === f.key;
        return (
          <button
            key={f.key}
            type="button"
            data-floor={f.key}
            className={styles.floorBtn}
            aria-pressed={on}
            aria-label={`${f.number}º andar, ${f.available} ${f.available === 1 ? 'livre' : 'livres'}`}
            onClick={() => onFloor(f.key)}
          >
            <span className={styles.floorNum}>{f.number}º</span>
            <span className={styles.floorFree} data-none={f.available === 0 || undefined}>
              {' · '}
              {f.available === 1 ? '1 livre' : `${f.available} livres`}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
