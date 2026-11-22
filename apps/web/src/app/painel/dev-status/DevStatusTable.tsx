'use client';
import { STATUS_LABELS } from '@vidomo/viewer/styles';
import { UNIT_STATUSES, type UnitStatus } from '@vidomo/viewer/types';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { StatusSwatch } from '@/components/public/StatusLegend';
import {
  defaultFilters,
  developmentOptions,
  filterUnits,
  floorColumn,
  floorOptions,
  groupByTower,
  groupTitle,
  manyTowers,
  towerColumn,
  towerOptions,
  type DevStatusFilters,
  type DevStatusUnit,
} from '@/lib/panel/dev-status';
import { isUnitStatus } from '@/lib/public-development';
import { browserClient } from '@/lib/supabase/browser';
import styles from '../painel.module.css';

type RowState = { pending?: boolean; error?: string; flash?: boolean };

const time = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' });

export function DevStatusTable({ initialUnits }: { initialUnits: DevStatusUnit[] }) {
  const [units, setUnits] = useState(initialUnits);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [reason, setReason] = useState('');
  // Abre filtrada pelo primeiro empreendimento (não todos juntos).
  const [filters, setFilters] = useState<DevStatusFilters>(() => defaultFilters(initialUnits));
  /** Blocos recolhidos (código). */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const patchRow = (id: string, patch: RowState) =>
    setRowState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  // Mudanças feitas em outras abas/usuários (postgres_changes filtrado pela RLS de units).
  useEffect(() => {
    const client = browserClient();
    let channel: ReturnType<typeof client.channel> | null = null;
    let disposed = false;

    void (async () => {
      // O Realtime aplica a RLS com o JWT do canal: autentica com a sessão ANTES de
      // assinar, senão o canal entra como anônimo e não recebe nada.
      const { data } = await client.auth.getSession();
      if (disposed) return;
      if (data.session) await client.realtime.setAuth(data.session.access_token);
      channel = client
        .channel('painel-units')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'units' }, (msg) => {
          const row = msg.new as { id?: string; status?: unknown; updated_at?: string };
          if (!row.id || !isUnitStatus(row.status)) return;
          const status = row.status;
          setUnits((list) =>
            list.map((u) =>
              u.id === row.id ? { ...u, status, updatedAt: row.updated_at ?? u.updatedAt } : u,
            ),
          );
        })
        .subscribe();
    })();

    return () => {
      disposed = true;
      if (channel) void client.removeChannel(channel);
    };
  }, []);

  async function changeStatus(unit: DevStatusUnit, next: UnitStatus) {
    const previous = unit.status;
    patchRow(unit.id, { pending: true, error: undefined });
    setUnits((list) => list.map((u) => (u.id === unit.id ? { ...u, status: next } : u)));

    // Regra 2: status só pela RPC (trava a linha e grava histórico). Nunca UPDATE direto.
    const { data, error } = await browserClient().rpc('set_unit_status', {
      p_unit_id: unit.id,
      p_new_status: next,
      p_reason: reason.trim() || 'painel dev-status',
    });

    if (error) {
      setUnits((list) => list.map((u) => (u.id === unit.id ? { ...u, status: previous } : u)));
      patchRow(unit.id, { pending: false, error: error.message });
      return;
    }
    const result = (data as { status: UnitStatus; updated_at: string }[])[0];
    setUnits((list) =>
      list.map((u) =>
        u.id === unit.id && result
          ? { ...u, status: result.status, updatedAt: result.updated_at }
          : u,
      ),
    );
    patchRow(unit.id, { pending: false, flash: true });
    setTimeout(() => patchRow(unit.id, { flash: false }), 1200);
  }

  const developments = useMemo(() => developmentOptions(units), [units]);
  const towers = useMemo(
    () => towerOptions(units, filters.development),
    [units, filters.development],
  );
  const floors = useMemo(
    () => floorOptions(units, filters.development, filters.tower),
    [units, filters.development, filters.tower],
  );
  const many = useMemo(() => manyTowers(units, filters.development), [units, filters.development]);
  const visible = useMemo(() => filterUnits(units, filters), [units, filters]);
  const groups = useMemo(() => groupByTower(visible), [visible]);
  const current = developments.find((d) => d.slug === filters.development);
  const set = (patch: Partial<DevStatusFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const toggle = (code: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  const columns = many ? 6 : 5;

  const row = (u: DevStatusUnit) => {
    const st = rowState[u.id] ?? {};
    return (
      <tr key={u.id} data-flash={st.flash || undefined}>
        <td>
          <span className={styles.mono}>{u.code}</span>
        </td>
        {many && <td>{towerColumn(u)}</td>}
        <td className={styles.mono}>{floorColumn(u)}</td>
        <td>{u.typeName ?? '—'}</td>
        <td>
          <span className={styles.statusCell}>
            <StatusSwatch status={u.status} />
            <select
              aria-label={`Status da unidade ${u.code}${many ? ` do ${u.towerName}` : ''}`}
              value={u.status}
              disabled={st.pending}
              onChange={(e) => changeStatus(u, e.target.value as UnitStatus)}
            >
              {UNIT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            {st.pending && <span className={styles.muted}>salvando…</span>}
          </span>
          {st.error && (
            <span className={styles.error} role="alert">
              {st.error}
            </span>
          )}
        </td>
        <td className={`${styles.mono} ${styles.muted}`}>{time.format(new Date(u.updatedAt))}</td>
      </tr>
    );
  };

  return (
    <>
      <div className={styles.toolbar} role="search" aria-label="Filtrar unidades">
        <label className={styles.field}>
          <span>Empreendimento</span>
          <select
            value={filters.development}
            onChange={(e) => set({ development: e.target.value, tower: '', floor: null })}
          >
            {developments.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        {many && (
          <label className={styles.field}>
            <span>Bloco</span>
            <select
              value={filters.tower}
              onChange={(e) => set({ tower: e.target.value, floor: null })}
            >
              <option value="">Todos</option>
              {towers.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={styles.field}>
          <span>Andar</span>
          <select
            value={filters.floor ?? ''}
            onChange={(e) => set({ floor: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">Todos</option>
            {floors.map((f) => (
              <option key={f.number} value={f.number}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Status</span>
          <select
            value={filters.status}
            onChange={(e) => set({ status: e.target.value as UnitStatus | '' })}
          >
            <option value="">Todos</option>
            {UNIT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <span className={styles.muted} aria-live="polite">
          {visible.length} {visible.length === 1 ? 'unidade' : 'unidades'}
        </span>
      </div>

      <div className={styles.toolbar}>
        <label className={styles.field}>
          <span>Motivo (vai para o histórico)</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="painel dev-status"
            maxLength={200}
          />
        </label>
        {current &&
          (current.published ? (
            <a
              href={`/e/${current.slug}`}
              target="_blank"
              rel="noreferrer"
              className={styles.secondary}
            >
              Abrir demo: {current.name} ↗
            </a>
          ) : (
            <span className={styles.muted}>{current.name} (rascunho, sem página pública)</span>
          ))}
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Unidade</th>
            {many && <th>Bloco</th>}
            <th>Andar</th>
            <th>Planta</th>
            <th>Status</th>
            <th>Atualizado</th>
          </tr>
        </thead>
        {many ? (
          groups.map((g) => {
            const open = !collapsed.has(g.code);
            const bodyId = `bloco-${g.code}`;
            return (
              <Fragment key={g.code}>
                <tbody>
                  <tr className={styles.groupRow}>
                    <th colSpan={columns} scope="rowgroup">
                      <button
                        type="button"
                        className={styles.groupToggle}
                        aria-expanded={open}
                        aria-controls={bodyId}
                        onClick={() => toggle(g.code)}
                      >
                        <span aria-hidden>{open ? '▾' : '▸'}</span> {groupTitle(g)}
                      </button>
                    </th>
                  </tr>
                </tbody>
                <tbody id={bodyId} hidden={!open}>
                  {g.units.map(row)}
                </tbody>
              </Fragment>
            );
          })
        ) : (
          <tbody>{visible.map(row)}</tbody>
        )}
      </table>
      {visible.length === 0 && <p className={styles.muted}>Nenhuma unidade com esses filtros.</p>}
    </>
  );
}
