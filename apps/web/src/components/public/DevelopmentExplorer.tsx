'use client';
import type { ViewerManifest } from '@vidomo/viewer/types';
import dynamic from 'next/dynamic';
import { useCallback, useMemo, useState } from 'react';
import { countByStatus, type PublicUnit } from '@/lib/public-development';
import { useLiveUnitStatus, type LiveConnection } from '@/lib/use-live-unit-status';
import { StatusLegend } from './StatusLegend';
import { UnitDetails } from './UnitDetails';
import { ViewerPlaceholder } from './ViewerPlaceholder';
import styles from './explorer.module.css';

// three.js + R3F só baixam no navegador, depois que o resto da página já apareceu.
const Viewer = dynamic(() => import('@vidomo/viewer').then((m) => m.Viewer), {
  ssr: false,
  loading: () => null,
});

const CONNECTION_LABEL: Record<LiveConnection, string> = {
  connecting: 'conectando',
  live: 'ao vivo',
  offline: 'sem conexão',
};

export interface DevelopmentExplorerProps {
  slug: string;
  name: string;
  /** URL resolvida no servidor por getAssetUrl(); null se não houver modelo. */
  modelUrl: string | null;
  initialUnits: PublicUnit[];
}

export function DevelopmentExplorer({
  slug,
  name,
  modelUrl,
  initialUnits,
}: DevelopmentExplorerProps) {
  const { units, statusMap, connection } = useLiveUnitStatus(slug, initialUnits);
  const [selected, setSelected] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const manifest = useMemo<ViewerManifest | null>(
    () => (modelUrl ? { modelUrl } : null),
    [modelUrl],
  );
  const counts = useMemo(() => countByStatus(statusMap), [statusMap]);
  const unitsByKey = useMemo(() => new Map(units.map((u) => [u.object_key, u])), [units]);
  const selectedUnit = selected ? unitsByKey.get(selected) : undefined;
  const selectedStatus = selected ? statusMap[selected] : undefined;

  const onReady = useCallback(() => {
    setReady(true);
    performance.mark('vidomo:viewer-ready');
  }, []);
  const onError = useCallback((e: Error) => setError(e.message), []);
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
