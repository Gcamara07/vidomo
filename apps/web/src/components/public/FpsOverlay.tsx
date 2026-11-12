'use client';
import { useState } from 'react';
import type { FpsSummary } from '@/lib/fps-summary';
import styles from './explorer.module.css';

/**
 * Contador visível com ?debug=1, para medir no celular. O viewer só desenha quando algo
 * muda: gire o prédio (ou use "Girar") para medir fps. Compacto por padrão; "+" mostra
 * tempos, draw calls, triângulos, dpr e GPU.
 */
export function FpsOverlay({
  summary,
  readyMs,
  detailMs,
  autoRotate,
  onToggleRotate,
  onReset,
}: {
  summary: FpsSummary;
  readyMs: number | null;
  detailMs: number | null;
  autoRotate: boolean;
  onToggleRotate: () => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { last, avg, min, activeSeconds } = summary;
  const f = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(0));
  const s = (ms: number | null) => (ms == null ? '—' : `${(ms / 1000).toFixed(2)} s`);
  return (
    <div className={styles.debug} role="status" aria-live="off">
      <div className={styles.debugRow}>
        <span className={styles.debugFps}>
          <strong>{f(last?.fps)}</strong> fps
        </span>
        <span title="média / mínimo nos segundos com renderização">
          {f(avg)} / {f(min)} <small>({activeSeconds} s)</small>
        </span>
      </div>
      {open && (
        <dl>
          <dt>interativo</dt>
          <dd>{s(readyMs)}</dd>
          <dt>detalhes</dt>
          <dd>{s(detailMs)}</dd>
          <dt>draw calls</dt>
          <dd>{last?.drawCalls ?? '—'}</dd>
          <dt>triângulos</dt>
          <dd>{last ? last.triangles.toLocaleString('pt-BR') : '—'}</dd>
          <dt>dpr</dt>
          <dd>{last?.dpr ?? '—'}</dd>
          <dd className={styles.debugGpu}>{last?.renderer ?? '—'}</dd>
        </dl>
      )}
      <div className={styles.debugActions}>
        <button type="button" onClick={onToggleRotate}>
          {autoRotate ? 'Parar' : 'Girar'}
        </button>
        <button type="button" onClick={onReset}>
          Zerar
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Menos detalhes' : 'Mais detalhes'}
        >
          {open ? '−' : '+'}
        </button>
      </div>
    </div>
  );
}
