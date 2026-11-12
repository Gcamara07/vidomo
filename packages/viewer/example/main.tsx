/**
 * Exemplo isolado do <Viewer> com status falsos (sem Supabase).
 *   pnpm --filter @vidomo/viewer example
 * Query string:
 *   ?model=<url>   outro GLB (padrão: /residencial-vista-test.glb de scripts/out)
 */
import { StrictMode, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  BRAND,
  STATUS_APPEARANCE,
  STATUS_LABELS,
  UNIT_STATUSES,
  Viewer,
  parseUnitKey,
  unitObjectKey,
  type UnitStatus,
  type UnitStatusMap,
  type ViewerManifest,
} from '../src';

const params = new URLSearchParams(location.search);
const manifest: ViewerManifest = {
  modelUrl: params.get('model') ?? '/residencial-vista-test.glb',
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
  const fill = STATUS_APPEARANCE[status].fill;
  const background =
    fill.kind === 'solid'
      ? fill.color
      : `repeating-linear-gradient(${fill.angle === 45 ? -45 : 45}deg, ${fill.color} 0 2px, ${fill.background} 2px 6px)`;
  return {
    width: 16,
    height: 16,
    flex: 'none',
    border: `1px solid ${BRAND.musgo}`,
    background,
  };
}

const mono: CSSProperties = { fontFamily: '"IBM Plex Mono", ui-monospace, monospace' };

function App() {
  const [status, setStatus] = useState<UnitStatusMap>(initialStatus);
  const [selected, setSelected] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [readyMs, setReadyMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        selectedUnit={selected}
        onSelectUnit={setSelected}
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
            <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={swatchStyle(s)} />
              {STATUS_LABELS[s]} <span style={{ ...mono, color: '#6B6A63' }}>{counts[s]}</span>
            </span>
          ))}
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
