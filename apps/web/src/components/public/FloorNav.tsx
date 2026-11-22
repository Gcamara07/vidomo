'use client';
import { Fragment, useEffect, useRef } from 'react';
import type { ViewerMode } from '@vidomo/viewer/types';
import { floorLabel, type FloorEntry, type TowerEntry } from '@/lib/explore';
import { floorShort } from '@/lib/unit-ref';
import styles from './explorer.module.css';

const free = (n: number) => (n === 1 ? '1 livre' : `${n} livres`);

/** Primeiro ancestral que rola no eixo dado (a faixa ou a coluna do seletor). */
function scrollParent(el: HTMLElement, axis: 'x' | 'y'): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p)[axis === 'x' ? 'overflowX' : 'overflowY'];
    if (o === 'auto' || o === 'scroll') return p;
  }
  return null;
}

/**
 * Centraliza o botão na faixa (celular) ou na coluna (desktop). Não usa scrollIntoView:
 * ele também rolaria a página (o contêiner com overflow hidden), deslocando o 3D e a ficha.
 */
function reveal(el: HTMLElement) {
  const behavior: ScrollBehavior = 'smooth';
  const r = el.getBoundingClientRect();
  const x = scrollParent(el, 'x');
  if (x && x.scrollWidth > x.clientWidth) {
    const c = x.getBoundingClientRect();
    x.scrollBy({ left: r.left - c.left - (c.width - r.width) / 2, behavior });
  }
  const y = scrollParent(el, 'y');
  if (y && y.scrollHeight > y.clientHeight) {
    const c = y.getBoundingClientRect();
    if (r.top < c.top || r.bottom > c.bottom) {
      y.scrollBy({ top: r.top - c.top - (c.height - r.height) / 2, behavior });
    }
  }
}

/**
 * Seletor de blocos e andares. Cada botão mostra quantas unidades estão livres (sem filtros).
 *
 * Um bloco só (ex.: Residencial Vista): só os andares, como sempre — celular: faixa
 * horizontal rolável acima da folha inferior; desktop: coluna ao lado do prédio.
 * Vários blocos, em dois níveis:
 *  - celular: uma faixa de blocos ("Bloco 09 · 6 livres") e, com um bloco ativo, uma faixa
 *    com os andares dele ("2º · 1 livre");
 *  - desktop: uma coluna de blocos; os andares do bloco ativo aparecem logo abaixo dele.
 */
export function FloorNav({
  towers,
  floors,
  mode,
  activeTower,
  activeFloor,
  columns,
  compact = false,
  onFloor,
  onTower,
  onOverview,
}: {
  /** Blocos do empreendimento (um só: sem o nível de bloco). */
  towers: TowerEntry[];
  /** Andares do bloco ativo (um bloco só: todos), do mais alto para o mais baixo. */
  floors: FloorEntry[];
  mode: ViewerMode;
  activeTower: string | null;
  activeFloor: string | null;
  /** Desktop: coluna única (andares dentro do bloco ativo). */
  columns: boolean;
  /**
   * Celular com a ficha aberta: só a faixa de andares do bloco (sobra área para o 3D);
   * para trocar de bloco, fecha-se a ficha.
   */
  compact?: boolean;
  onFloor: (key: string) => void;
  onTower: (key: string) => void;
  /** Vista geral (o prédio, ou o condomínio inteiro). */
  onOverview: () => void;
}) {
  const navRef = useRef<HTMLDivElement>(null);
  const many = towers.length > 1;

  // Mantém o bloco e o andar ativos visíveis na faixa (celular) ou na coluna (desktop).
  useEffect(() => {
    const root = navRef.current;
    if (!root) return;
    const targets = [
      mode !== 'building' && activeTower ? `[data-tower="${activeTower}"]` : null,
      mode === 'floor' && activeFloor ? `[data-floor="${activeFloor}"]` : null,
    ];
    for (const sel of targets) {
      const el = sel ? root.querySelector<HTMLElement>(sel) : null;
      if (el) reveal(el);
    }
  }, [mode, activeTower, activeFloor]);

  const floorButtons = floors.map((f) => {
    const on = mode === 'floor' && activeFloor === f.key;
    const name = floorShort({ floor_number: f.number, floor_label: f.label });
    return (
      <button
        key={f.key}
        type="button"
        data-floor={f.key}
        className={styles.floorBtn}
        data-sub={many && columns ? '' : undefined}
        aria-pressed={on}
        aria-label={f.label ? floorLabel(f) : `${f.number}º andar, ${free(f.available)}`}
        onClick={() => onFloor(f.key)}
      >
        <span className={styles.floorNum}>{name}</span>
        <span className={styles.floorFree} data-none={f.available === 0 || undefined}>
          {' · '}
          {free(f.available)}
        </span>
      </button>
    );
  });

  if (!many) {
    return (
      <div ref={navRef} className={styles.navWrap}>
        <nav className={styles.floorNav} aria-label="Andares">
          <button
            type="button"
            className={styles.floorBtn}
            aria-pressed={mode === 'building'}
            onClick={onOverview}
          >
            {mode === 'floor' ? 'Ver prédio' : 'Prédio'}
          </button>
          {floorButtons}
        </nav>
      </div>
    );
  }

  const active = towers.find((t) => t.key === activeTower);
  const showFloors = mode !== 'building' && !!active;
  const overview = (
    <button
      type="button"
      className={styles.floorBtn}
      aria-pressed={mode === 'building'}
      onClick={onOverview}
    >
      {mode === 'building' ? 'Condomínio' : 'Ver condomínio'}
    </button>
  );
  const towerButton = (t: TowerEntry) => (
    <button
      key={t.key}
      type="button"
      data-tower={t.key}
      className={styles.floorBtn}
      // Bloco ativo: pressionado no modo bloco; no modo andar, marcado como "aberto".
      aria-pressed={mode === 'tower' && activeTower === t.key}
      data-open={(mode === 'floor' && activeTower === t.key) || undefined}
      aria-label={`${t.name}, ${free(t.available)}`}
      onClick={() => onTower(t.key)}
    >
      <span className={styles.floorNum}>{t.name}</span>
      <span className={styles.floorFree} data-none={t.available === 0 || undefined}>
        {' · '}
        {free(t.available)}
      </span>
    </button>
  );

  if (columns) {
    return (
      <div ref={navRef} className={styles.navWrap}>
        <nav className={styles.floorNav} aria-label="Blocos e andares">
          {overview}
          {towers.map((t) => (
            <Fragment key={t.key}>
              {towerButton(t)}
              {showFloors && active.key === t.key && floorButtons}
            </Fragment>
          ))}
        </nav>
      </div>
    );
  }

  return (
    <div ref={navRef} className={styles.navLevels}>
      {!(compact && showFloors) && (
        <nav className={styles.floorNav} aria-label="Blocos">
          {overview}
          {towers.map(towerButton)}
        </nav>
      )}
      {showFloors && (
        <nav className={styles.floorNav} aria-label={`Andares do ${active.name}`}>
          {floorButtons}
        </nav>
      )}
    </div>
  );
}
