'use client';
// Só tipos: o viewer (three.js) chega pelo dynamic() abaixo.
import type { ViewerMode, ViewerStats } from '@vidomo/viewer';
import { floorKeyOfUnit } from '@vidomo/viewer/naming';
import type { UnitStatus, ViewerManifest, ViewInsets } from '@vidomo/viewer/types';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  bedroomOptions as getBedroomOptions,
  defaultFilters,
  dimmedUnitKeys,
  floorsFromUnits,
  isDefaultFilters,
  legendCounts,
  toggleIn,
  type Filters,
} from '@/lib/explore';
import { BUILDING, searchFor, type NavState } from '@/lib/deep-link';
import { EMPTY_FPS, addFpsSample, type FpsSummary } from '@/lib/fps-summary';
import type { PublicUnit } from '@/lib/public-development';
import { useElementSize, useMediaQuery } from '@/lib/use-layout';
import { useLiveUnitStatus, type LiveConnection } from '@/lib/use-live-unit-status';
import { FilterBar } from './FilterBar';
import { FloorNav } from './FloorNav';
import { FpsOverlay } from './FpsOverlay';
import { UnitDetails } from './UnitDetails';
import { ViewerPlaceholder } from './ViewerPlaceholder';
import styles from './explorer.module.css';

// three.js + R3F ficam num chunk separado. O HTML não espera por ele (o invólucro renderiza
// null no servidor), mas o Next emite preload do chunk, que baixa em paralelo ao JS inicial.
const Viewer = dynamic(() => import('./ClientOnlyViewer'), {
  loading: () => null,
});

/** Limite para ligar o tempo real mesmo se o 3D ainda não estiver pronto. */
const LIVE_FALLBACK_MS = 6000;
/** Folga em volta da área livre do 3D (px). */
const INSET_GAP = 8;

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
  /** Estado inicial vindo do link (?u= / ?andar=), já validado no servidor. */
  initialNav?: NavState;
  /** ?debug=1: mostra o contador de fps. */
  debug?: boolean;
}

export function DevelopmentExplorer({
  slug,
  name,
  modelUrl,
  detailModelUrl = null,
  initialUnits,
  initialNav = BUILDING,
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

  // Navegação: modo, andar ativo, unidade selecionada e filtros.
  const [mode, setMode] = useState<ViewerMode>(initialNav.mode);
  const [activeFloor, setActiveFloor] = useState<string | null>(initialNav.activeFloor);
  const [selected, setSelected] = useState<string | null>(initialNav.selected);
  const [filters, setFilters] = useState<Filters>(() => defaultFilters(initialUnits));

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

  // Derivados do mapa de status em tempo real.
  const floors = useMemo(() => floorsFromUnits(units, statusMap), [units, statusMap]);
  const bedroomOptions = useMemo(() => getBedroomOptions(units), [units]);
  const dimmed = useMemo(
    () => dimmedUnitKeys(units, statusMap, filters),
    [units, statusMap, filters],
  );
  const legend = useMemo(
    () => legendCounts(units, statusMap, filters),
    [units, statusMap, filters],
  );
  const filtersDefault = useMemo(() => isDefaultFilters(filters, units), [filters, units]);

  const unitsByKey = useMemo(() => new Map(units.map((u) => [u.object_key, u])), [units]);
  const selectedUnit = selected ? unitsByKey.get(selected) : undefined;
  const selectedStatus = selected ? statusMap[selected] : undefined;

  // Toque no 3D. No modo edifício, o viewer também sugere o andar da unidade
  // (onSelectFloor): entra no andar e a ficha abre.
  const onSelectUnit = useCallback((key: string | null) => setSelected(key), []);
  const onSelectFloor = useCallback((key: string) => {
    setActiveFloor(key);
    setMode('floor');
  }, []);
  const goFloor = useCallback((key: string) => {
    setActiveFloor(key);
    setMode('floor');
    setSelected((s) => (s && floorKeyOfUnit(s) !== key ? null : s));
  }, []);
  const goBuilding = useCallback(() => setMode('building'), []);

  // A URL acompanha a navegação (sem recarregar): "Copiar link" copia a vista atual, e um
  // link inválido some da barra de endereço ao cair no modo edifício.
  useEffect(() => {
    const search = searchFor(window.location.search, { mode, activeFloor, selected }, units);
    if (search !== window.location.search) {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${search}${window.location.hash}`,
      );
    }
  }, [mode, activeFloor, selected, units]);

  const onToggleStatus = useCallback(
    (s: UnitStatus) => setFilters((f) => ({ ...f, statuses: toggleIn(f.statuses, s) })),
    [],
  );
  const onToggleBedrooms = useCallback(
    (b: number) => setFilters((f) => ({ ...f, bedrooms: toggleIn(f.bedrooms, b) })),
    [],
  );
  const onClearFilters = useCallback(() => setFilters(defaultFilters(units)), [units]);

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

  // Área do 3D coberta pela interface: o viewer enquadra o andar na área livre, então a
  // folha inferior não cobre a unidade selecionada.
  const isDesktop = useMediaQuery('(min-width: 900px)');
  const panelRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const panelSize = useElementSize(panelRef);
  const dockSize = useElementSize(dockRef);
  const insets = useMemo<ViewInsets>(
    () =>
      isDesktop
        ? { left: dockSize.width + 2 * INSET_GAP }
        : { top: panelSize.height + INSET_GAP, bottom: dockSize.height + INSET_GAP },
    [isDesktop, panelSize.height, dockSize.width, dockSize.height],
  );

  const details =
    selectedUnit && selectedStatus ? (
      <UnitDetails
        unit={selectedUnit}
        status={selectedStatus}
        developmentName={name}
        onClose={() => setSelected(null)}
      />
    ) : null;

  return (
    <div className={styles.root} data-viewer-ready={ready || undefined} data-mode={mode}>
      <section className={styles.stage} aria-label={`Modelo 3D do ${name}`}>
        {manifest && !error && (
          <Viewer
            key={attempt}
            manifest={manifest}
            unitStatus={statusMap}
            mode={mode}
            activeFloor={activeFloor}
            dimmedUnits={dimmed}
            selectedUnit={selected}
            onSelectUnit={onSelectUnit}
            onSelectFloor={onSelectFloor}
            insets={insets}
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
        <p className={`${styles.disclaimer} ${styles.disclaimerDesktop}`}>Imagens ilustrativas</p>
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

      <aside ref={panelRef} className={styles.panel}>
        <header className={styles.head}>
          <h1 className={styles.title}>{name}</h1>
          <p className={styles.live} data-state={connection}>
            <span className={styles.dot} aria-hidden />
            {CONNECTION_LABEL[connection]}
          </p>
        </header>

        <FilterBar
          filters={filters}
          counts={legend.byStatus}
          matching={legend.matching}
          total={legend.total}
          bedroomOptions={bedroomOptions}
          isDefault={filtersDefault}
          onToggleStatus={onToggleStatus}
          onToggleBedrooms={onToggleBedrooms}
          onClear={onClearFilters}
        />

        {isDesktop && (details ?? <p className={styles.hint}>Toque num andar ou numa unidade.</p>)}
      </aside>

      {/* Celular: faixa de andares + folha inferior. Desktop: coluna de andares. */}
      <div ref={dockRef} className={styles.dock}>
        <p className={`${styles.disclaimer} ${styles.disclaimerMobile}`}>Imagens ilustrativas</p>
        <FloorNav
          floors={floors}
          mode={mode}
          activeFloor={activeFloor}
          onFloor={goFloor}
          onBuilding={goBuilding}
        />
        {!isDesktop && details}
      </div>
    </div>
  );
}
