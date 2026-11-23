'use client';
// Só tipos: o viewer (three.js) chega pelo dynamic() abaixo.
import type { ViewerMode, ViewerStats } from '@vidomo/viewer';
import { floorKeyOfUnit, parseFloorKey } from '@vidomo/viewer/naming';
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
  towersFromUnits,
  type Filters,
} from '@/lib/explore';
import { BUILDING, searchFor, type NavState } from '@/lib/deep-link';
import { EMPTY_FPS, addFpsSample, type FpsSummary } from '@/lib/fps-summary';
import type { LeadSource } from '@/lib/lead-form';
import {
  unitTypeMap,
  type PublicContact,
  type PublicDevelopment,
  type PublicUnit,
} from '@/lib/public-development';
import { useElementSize, useMediaQuery } from '@/lib/use-layout';
import { useLiveUnitStatus, type LiveConnection } from '@/lib/use-live-unit-status';
import { FilterBar } from './FilterBar';
import { FloorNav } from './FloorNav';
import { FpsOverlay } from './FpsOverlay';
// TODO(desempenho): carregar a ficha (UnitDetails, com interesse e WhatsApp) só quando uma
// unidade for selecionada, via dynamic(). Hoje ela entra no JS inicial e acrescenta pedidos
// antes do three.js; em HTTP/1.1 isso custa uma ida e volta (+0,13 s no build local; ver
// README, "Medir a demo publicada"). Com ?u= a ficha passaria a abrir logo após o prédio.
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
  /** Câmeras do viewer cadastradas no empreendimento (ex.: vista inicial do condomínio). */
  viewerCameras?: PublicDevelopment['viewer_cameras'];
  /** Interiores (maquetes) por nome do tipo de planta, URLs já resolvidas no servidor. */
  interiors?: ViewerManifest['interiors'];
  initialUnits: PublicUnit[];
  /** Estado inicial vindo do link (?u= / ?andar=), já validado no servidor. */
  initialNav?: NavState;
  /** Contato comercial e consentimento (null: sem formulário nem WhatsApp). */
  contact?: PublicContact | null;
  /** 'unit_link' quando a página foi aberta por ?u=; senão 'portal'. */
  leadSource?: LeadSource;
  /** ?debug=1: mostra o contador de fps. */
  debug?: boolean;
}

export function DevelopmentExplorer({
  slug,
  name,
  modelUrl,
  detailModelUrl = null,
  viewerCameras = null,
  interiors,
  initialUnits,
  initialNav = BUILDING,
  contact = null,
  leadSource = 'portal',
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
  const [activeTower, setActiveTower] = useState<string | null>(initialNav.activeTower);
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
    () =>
      modelUrl
        ? {
            modelUrl,
            detailModelUrl: detailModelUrl ?? undefined,
            cameras: viewerCameras ?? undefined,
            // Tipo de planta não muda com o tempo real: vem das unidades iniciais.
            ...(interiors && Object.keys(interiors).length
              ? { interiors, unitTypes: unitTypeMap(initialUnits) }
              : {}),
          }
        : null,
    [modelUrl, detailModelUrl, viewerCameras, interiors, initialUnits],
  );

  // Derivados do mapa de status em tempo real.
  const towers = useMemo(() => towersFromUnits(units, statusMap), [units, statusMap]);
  const manyTowers = towers.length > 1;
  // Com vários blocos, o seletor mostra os andares do bloco ativo; com um só, todos.
  const floors = useMemo(
    () => floorsFromUnits(units, statusMap, manyTowers ? activeTower : null),
    [units, statusMap, manyTowers, activeTower],
  );
  // Rótulos curtos dos blocos no 3D ("09"), do cadastro.
  const towerLabels = useMemo(
    () =>
      manyTowers
        ? Object.fromEntries(towers.map((t) => [t.key, { label: t.short, title: t.name }]))
        : undefined,
    [manyTowers, towers],
  );
  // Legenda e contagens: o condomínio inteiro, ou o bloco ativo.
  const scopeUnits = useMemo(
    () =>
      manyTowers && mode !== 'building' && activeTower
        ? units.filter((u) => u.tower_code === activeTower)
        : units,
    [units, manyTowers, mode, activeTower],
  );
  const scopeName =
    manyTowers && mode !== 'building' ? towers.find((t) => t.key === activeTower)?.name : null;
  const bedroomOptions = useMemo(() => getBedroomOptions(units), [units]);
  const dimmed = useMemo(
    () => dimmedUnitKeys(units, statusMap, filters),
    [units, statusMap, filters],
  );
  const legend = useMemo(
    () => legendCounts(scopeUnits, statusMap, filters),
    [scopeUnits, statusMap, filters],
  );
  const filtersDefault = useMemo(() => isDefaultFilters(filters, units), [filters, units]);

  const unitsByKey = useMemo(() => new Map(units.map((u) => [u.object_key, u])), [units]);
  const selectedUnit = selected ? unitsByKey.get(selected) : undefined;
  const selectedStatus = selected ? statusMap[selected] : undefined;

  // Toque no 3D. No modo edifício (um bloco) ou no modo bloco, o viewer também sugere o
  // andar da unidade (onSelectFloor): entra no andar e a ficha abre. Com vários blocos, o
  // toque na vista geral sugere o bloco (onSelectTower).
  const onSelectUnit = useCallback((key: string | null) => setSelected(key), []);
  const onSelectFloor = useCallback((key: string) => {
    setActiveTower(parseFloorKey(key)?.tower ?? null);
    setActiveFloor(key);
    setMode('floor');
  }, []);
  const goFloor = useCallback((key: string) => {
    setActiveTower(parseFloorKey(key)?.tower ?? null);
    setActiveFloor(key);
    setMode('floor');
    setSelected((s) => (s && floorKeyOfUnit(s) !== key ? null : s));
  }, []);
  const goTower = useCallback((key: string) => {
    setActiveTower(key);
    setMode('tower');
    setSelected(null);
  }, []);
  const goBuilding = useCallback(() => setMode('building'), []);

  // A URL acompanha a navegação (sem recarregar): "Copiar link" copia a vista atual, e um
  // link inválido some da barra de endereço ao cair no modo edifício.
  useEffect(() => {
    const search = searchFor(
      window.location.search,
      { mode, activeTower, activeFloor, selected },
      units,
    );
    if (search !== window.location.search) {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${search}${window.location.hash}`,
      );
    }
  }, [mode, activeTower, activeFloor, selected, units]);

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
  // Marca de medição: a câmera terminou uma transição (troca de modo/andar).
  const onViewSettled = useCallback(() => {
    performance.mark('vidomo:view-settled');
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
        // Trocar de unidade volta para a ficha (fecha um formulário aberto).
        key={selectedUnit.object_key}
        unit={selectedUnit}
        manyTowers={manyTowers}
        status={selectedStatus}
        slug={slug}
        developmentName={name}
        contact={contact}
        leadSource={leadSource}
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
            activeTower={activeTower}
            activeFloor={activeFloor}
            dimmedUnits={dimmed}
            selectedUnit={selected}
            onSelectUnit={onSelectUnit}
            onSelectFloor={onSelectFloor}
            onSelectTower={goTower}
            towerLabels={towerLabels}
            onViewChange={onViewSettled}
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
          scope={scopeName ?? null}
          bedroomOptions={bedroomOptions}
          isDefault={filtersDefault}
          onToggleStatus={onToggleStatus}
          onToggleBedrooms={onToggleBedrooms}
          onClear={onClearFilters}
        />

        {isDesktop &&
          (details ?? (
            <p className={styles.hint}>
              {manyTowers && mode === 'building'
                ? 'Toque num bloco para ver os andares dele.'
                : 'Toque num andar ou numa unidade.'}
            </p>
          ))}
      </aside>

      {/* Celular: faixa de andares + folha inferior. Desktop: coluna de andares. */}
      <div ref={dockRef} className={styles.dock} data-many={manyTowers || undefined}>
        <p className={`${styles.disclaimer} ${styles.disclaimerMobile}`}>Imagens ilustrativas</p>
        <FloorNav
          towers={towers}
          floors={floors}
          mode={mode}
          activeTower={activeTower}
          activeFloor={activeFloor}
          columns={isDesktop}
          compact={!isDesktop && !!details}
          onFloor={goFloor}
          onTower={goTower}
          onOverview={goBuilding}
        />
        {!isDesktop && details}
      </div>
    </div>
  );
}
