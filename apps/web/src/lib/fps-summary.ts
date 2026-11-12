// Só tipo: não puxa o viewer (three.js) para o JS inicial.
import type { ViewerStats } from '@vidomo/viewer';

export interface FpsSummary {
  last: ViewerStats | null;
  /** Segundos com renderização (fps > 0) desde o último "zerar". */
  activeSeconds: number;
  /** Média e mínimo de fps só nos segundos em que houve renderização. */
  avg: number | null;
  min: number | null;
}

export const EMPTY_FPS: FpsSummary = { last: null, activeSeconds: 0, avg: null, min: null };

/** Acumula uma amostra de 1 s. Segundos parados (frameloop sob demanda) não contam. */
export function addFpsSample(s: FpsSummary, stats: ViewerStats): FpsSummary {
  // < 2 fps = parado ou um quadro isolado (ex.: detalhes entrando), não uma interação.
  if (stats.fps < 2) return { ...s, last: stats };
  const n = s.activeSeconds + 1;
  return {
    last: stats,
    activeSeconds: n,
    avg: s.avg === null ? stats.fps : s.avg + (stats.fps - s.avg) / n,
    min: s.min === null ? stats.fps : Math.min(s.min, stats.fps),
  };
}
