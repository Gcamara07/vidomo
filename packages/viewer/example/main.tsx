/**
 * Exemplo isolado do <Viewer> com status falsos (sem Supabase).
 *   pnpm --filter @vidomo/viewer example
 * Query string:
 *   ?model=<url>   GLB leve (padrão: /residencial-vista-leve.glb de scripts/out)
 *   ?detail=<url>  GLB de detalhes (padrão: /residencial-vista-detalhes.glb; ?detail=none desliga)
 * Controles: modo edifício/andar, seletor de andar, filtros de status e dormitórios
 * (esmaecem unidades), estado serializável (onViewChange).
 */
import { StrictMode, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  BRAND,
  STATUS_LABELS,
  UNIT_STATUSES,
  Viewer,
  parseUnitKey,
  swatchBackground,
  unitObjectKey,
  floorObjectKey,
  type UnitStatus,
  type UnitStatusMap,
  type ViewerManifest,
  type ViewerMode,
  type ViewerViewState,
} from '../src';

/** Como no seed: finais 1 e 3 = 2 dorms (Tipo A); 2 e 4 = 3 dorms (Tipo B). */
const bedroomsOf = (key: string) => (Number(parseUnitKey(key)?.code.slice(-1)) % 2 === 1 ? 2 : 3);
const FLOORS = Array.from({ length: 10 }, (_, i) => 10 - i);

const params = new URLSearchParams(location.search);
const manifest: ViewerManifest = {
  modelUrl: params.get('model') ?? '/residencial-vista-leve.glb',
  detailModelUrl:
    params.get('detail') === 'none'
      ? undefined
      : (params.get('detail') ?? '/residencial-vista-detalhes.glb'),
};

/** 40 unidades falsas: torre TA, 10 andares × 4. */
const UNIT_KEYS = Array.from({ length: 10 }, (_, f) =>
  [1, 2, 3, 4].map((p) => unitObjectKey('TA', f + 1, (f + 1) * 100 + p)),
).flat();

function initialStatus(): UnitStatusMap {
  const cycle: UnitStatus[] = [
    'available',
    'reserved',
    'available',
    'sold',
    'negotiating',
    'unavailable',
  ];
  return Object.fromEntries(UNIT_KEYS.map((k, i) => [k, cycle[i % cycle.length]!]));
}

function swatchStyle(status: UnitStatus): CSSProperties {
  return {
    width: 16,
    height: 16,
    flex: 'none',
    border: `1px solid ${BRAND.musgo}`,
    background: swatchBackground(status),
  };
}

const mono: CSSProperties = { fontFamily: '"IBM Plex Mono", ui-monospace, monospace' };

function App() {
  const [status, setStatus] = useState<UnitStatusMap>(initialStatus);
  const [selected, setSelected] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [readyMs, setReadyMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewerMode>('building');
  const [activeFloor, setActiveFloor] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<UnitStatus>>(() => new Set(UNIT_STATUSES));
  const [bedroomFilter, setBedroomFilter] = useState<Set<number>>(() => new Set([2, 3]));
  const [view, setView] = useState<ViewerViewState | null>(null);

  const dimmedUnits = useMemo(
    () =>
      new Set(
        UNIT_KEYS.filter((k) => !statusFilter.has(status[k]!) || !bedroomFilter.has(bedroomsOf(k))),
      ),
    [status, statusFilter, bedroomFilter],
  );
  const goFloor = (key: string) => {
    setActiveFloor(key);
    setMode('floor');
  };
  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  const randomChange = useCallback(() => {
    setStatus((prev) => {
      const key = UNIT_KEYS[Math.floor(Math.random() * UNIT_KEYS.length)]!;
      const options = UNIT_STATUSES.filter((s) => s !== prev[key]);
      return { ...prev, [key]: options[Math.floor(Math.random() * options.length)]! };
    });
  }, []);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(randomChange, 1500);
    return () => clearInterval(id);
  }, [auto, randomChange]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(UNIT_STATUSES.map((s) => [s, 0])) as Record<UnitStatus, number>;
    for (const s of Object.values(status)) c[s]++;
    return c;
  }, [status]);

  const parts = selected ? parseUnitKey(selected) : null;

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Viewer
        manifest={manifest}
        unitStatus={status}
        mode={mode}
        activeFloor={activeFloor}
        dimmedUnits={dimmedUnits}
        selectedUnit={selected}
        onSelectUnit={setSelected}
        onSelectFloor={goFloor}
        onViewChange={setView}
        onReady={() => setReadyMs(Math.round(performance.now()))}
        onError={(e) => setError(e.message)}
        style={{ position: 'absolute', inset: 0 }}
      />

      <header
        style={{
          position: 'absolute',
          top: 12,
          left: 16,
          right: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          pointerEvents: 'none',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: 'Fraunces, Georgia, serif',
            fontWeight: 500,
            fontSize: 22,
            color: BRAND.musgo,
          }}
        >
          Residencial Vista <em>· viewer</em>
        </h1>
        <span style={{ ...mono, fontSize: 11, color: '#6B6A63' }}>
          {error ? `erro: ${error}` : readyMs === null ? 'carregando…' : `pronto em ${readyMs} ms`}
        </span>
      </header>

      <section
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 'max(12px, env(safe-area-inset-bottom))',
          maxWidth: 520,
          background: 'rgba(243,239,231,0.94)',
          border: `1px solid ${BRAND.musgo}`,
          padding: '10px 12px',
          display: 'grid',
          gap: 10,
          fontSize: 13,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
          {UNIT_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={statusFilter.has(s)}
              onClick={() => setStatusFilter((f) => toggle(f, s))}
              style={{ ...chipStyle, opacity: statusFilter.has(s) ? 1 : 0.4 }}
            >
              <span style={swatchStyle(s)} />
              {STATUS_LABELS[s]} <span style={{ ...mono, color: '#6B6A63' }}>{counts[s]}</span>
            </button>
          ))}
          {[2, 3].map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={bedroomFilter.has(b)}
              onClick={() => setBedroomFilter((f) => toggle(f, b))}
              style={{ ...chipStyle, opacity: bedroomFilter.has(b) ? 1 : 0.4 }}
            >
              {b} dorms
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
          <button
            type="button"
            onClick={() => setMode('building')}
            style={{ ...floorBtn, ...(mode === 'building' ? floorBtnOn : {}) }}
          >
            Ver prédio
          </button>
          {FLOORS.map((n) => {
            const key = floorObjectKey('TA', n);
            const on = mode === 'floor' && activeFloor === key;
            return (
              <button
                key={n}
                type="button"
                onClick={() => goFloor(key)}
                style={{ ...floorBtn, ...(on ? floorBtnOn : {}) }}
              >
                {n}º
              </button>
            );
          })}
        </div>

        <div style={{ ...mono, fontSize: 12, minHeight: 18 }}>
          {selected && parts ? (
            <>
              {selected} · andar {parts.floor} · unidade {parts.code} ·{' '}
              {STATUS_LABELS[status[selected]!]}
            </>
          ) : (
            <span style={{ color: '#6B6A63' }}>toque numa unidade</span>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" onClick={randomChange} style={buttonStyle}>
            Mudar um status
          </button>
          <button type="button" onClick={() => setAuto((a) => !a)} style={buttonStyle}>
            {auto ? 'Parar automático' : 'Automático (1,5 s)'}
          </button>
          <details style={{ ...mono, fontSize: 11 }}>
            <summary>estado</summary>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(view)}</pre>
          </details>
          {selected && (
            <select
              value={status[selected]}
              onChange={(e) =>
                setStatus((prev) => ({ ...prev, [selected]: e.target.value as UnitStatus }))
              }
              style={{ ...buttonStyle, background: '#fff' }}
            >
              {UNIT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          )}
        </div>
      </section>
    </div>
  );
}

const chipStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 6px',
  border: `1px solid ${BRAND.areia}`,
  background: 'transparent',
  cursor: 'pointer',
};

const floorBtn: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  flex: 'none',
  minWidth: 40,
  minHeight: 34,
  border: `1px solid ${BRAND.musgo}`,
  background: 'transparent',
  color: BRAND.musgo,
  cursor: 'pointer',
};
const floorBtnOn: CSSProperties = { background: BRAND.musgo, color: BRAND.papel };

const buttonStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 13,
  padding: '8px 12px',
  minHeight: 36,
  border: `1px solid ${BRAND.musgo}`,
  background: BRAND.musgo,
  color: BRAND.papel,
  cursor: 'pointer',
};

// Reaproveita a raiz quando o Vite reexecuta este módulo (HMR).
const container = document.getElementById('root') as HTMLElement & { __root?: Root };
container.__root ??= createRoot(container);
container.__root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
