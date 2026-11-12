'use client';
// Só tipos: o viewer (three.js) chega pelo dynamic() abaixo.
import type { ViewerStats } from '@vidomo/viewer';
import type { ViewerManifest } from '@vidomo/viewer/types';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { countByStatus, type PublicUnit } from '@/lib/public-development';
import { useLiveUnitStatus, type LiveConnection } from '@/lib/use-live-unit-status';
import { StatusLegend } from './StatusLegend';
import { UnitDetails } from './UnitDetails';
import { EMPTY_FPS, addFpsSample, type FpsSummary } from '@/lib/fps-summary';
import { FpsOverlay } from './FpsOverlay';
import { ViewerPlaceholder } from './ViewerPlaceholder';
import styles from './explorer.module.css';

// three.js + R3F ficam num chunk separado. O HTML não espera por ele (o invólucro renderiza
// null no servidor), mas o Next emite preload do chunk, que baixa em paralelo ao JS inicial.
const Viewer = dynamic(() => import('./ClientOnlyViewer'), {
  loading: () => null,
});

/** Limite para ligar o tempo real mesmo se o 3D ainda não estiver pronto. */
const LIVE_FALLBACK_MS = 6000;

const CONNECTION_LABEL: Record<LiveConnection, string> = {
  connecting: 'conectando',
  live: 'ao vivo',
  offline: 'sem conexão',
};

export interface DevelopmentExplorerProps {
  slug: string;
  name: string;
  /** GLB leve (camada 1), resolvido no servidor por getAssetUrl(); null se não houver modelo. */
  modelUrl: string | null;
  /** GLB de detalhes (camada 2, opcional). */
  detailModelUrl?: string | null;
  initialUnits: PublicUnit[];
  /** ?debug=1: mostra o contador de fps. */
  debug?: boolean;
}

export function DevelopmentExplorer({
  slug,
  name,
  modelUrl,
  detailModelUrl = null,
  initialUnits,
  debug = false,
}: DevelopmentExplorerProps) {
  // O tempo real (supabase-js) só conecta depois que o prédio fica interativo, para não
  // disputar banda com o three.js; com limite de LIVE_FALLBACK_MS se o 3D demorar ou falhar.
  const [liveEnabled, setLiveEnabled] = useState(!modelUrl);
  useEffect(() => {
    const id = setTimeout(() => setLiveEnabled(true), LIVE_FALLBACK_MS);
    return () => clearTimeout(id);
  }, []);
  const { units, statusMap, connection } = useLiveUnitStatus(slug, initialUnits, liveEnabled);
  const [selected, setSelected] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [fps, setFps] = useState<FpsSummary>(EMPTY_FPS);
  const [autoRotate, setAutoRotate] = useState(false);
  const [readyMs, setReadyMs] = useState<number | null>(null);
  const [detailMs, setDetailMs] = useState<number | null>(null);

  const manifest = useMemo<ViewerManifest | null>(
    () => (modelUrl ? { modelUrl, detailModelUrl: detailModelUrl ?? undefined } : null),
    [modelUrl, detailModelUrl],
  );
  const counts = useMemo(() => countByStatus(statusMap), [statusMap]);
  const unitsByKey = useMemo(() => new Map(units.map((u) => [u.object_key, u])), [units]);
  const selectedUnit = selected ? unitsByKey.get(selected) : undefined;
  const selectedStatus = selected ? statusMap[selected] : undefined;

  const onReady = useCallback(() => {
    setReady(true);
    setLiveEnabled(true);
    setReadyMs(performance.mark('vidomo:viewer-ready').startTime);
  }, []);
  const onDetailReady = useCallback(() => {
    setDetailMs(performance.mark('vidomo:detail-ready').startTime);
  }, []);
  const onStats = useCallback((stats: ViewerStats) => setFps((s) => addFpsSample(s, stats)), []);
  const onError = useCallback((e: Error) => {
    setError(e.message);
    setLiveEnabled(true);
  }, []);
  const retry = useCallback(() => {
    setError(null);
    setReady(false);
    setAttempt((a) => a + 1);
  }, []);

  return (
    <div className={styles.root} data-viewer-ready={ready || undefined}>
      <section className={styles.stage} aria-label={`Modelo 3D do ${name}`}>
        {manifest && !error && (
          <Viewer
            key={attempt}
            manifest={manifest}
            unitStatus={statusMap}
            selectedUnit={selected}
            onSelectUnit={setSelected}
            onReady={onReady}
            onError={onError}
            onDetailReady={onDetailReady}
            onStats={debug ? onStats : undefined}
            autoRotate={autoRotate}
            className={styles.viewer}
          />
        )}
        {(!ready || error || !manifest) && (
          <ViewerPlaceholder
            error={!manifest ? 'sem modelo' : error}
            onRetry={manifest ? retry : undefined}
          />
        )}
        <p className={styles.disclaimer}>Imagens ilustrativas</p>
        {debug && (
          <FpsOverlay
            summary={fps}
            readyMs={readyMs}
            detailMs={detailMs}
            autoRotate={autoRotate}
            onToggleRotate={() => setAutoRotate((a) => !a)}
            onReset={() => setFps(EMPTY_FPS)}
          />
        )}
      </section>

      <aside className={styles.panel}>
        <header className={styles.head}>
          <h1 className={styles.title}>{name}</h1>
          <p className={styles.live} data-state={connection}>
            <span className={styles.dot} aria-hidden />
            {CONNECTION_LABEL[connection]}
          </p>
        </header>

        <StatusLegend counts={counts} />

        {selectedUnit && selectedStatus ? (
          <UnitDetails
            unit={selectedUnit}
            status={selectedStatus}
            onClose={() => setSelected(null)}
          />
        ) : (
          <p className={styles.hint}>Toque numa unidade para ver a ficha.</p>
        )}
      </aside>
    </div>
  );
}
