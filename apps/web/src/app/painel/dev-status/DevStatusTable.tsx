'use client';
import { STATUS_LABELS } from '@vidomo/viewer/styles';
import { UNIT_STATUSES, type UnitStatus } from '@vidomo/viewer/types';
import { useEffect, useMemo, useState } from 'react';
import { StatusSwatch } from '@/components/public/StatusLegend';
import { isUnitStatus } from '@/lib/public-development';
import { browserClient } from '@/lib/supabase/browser';
import styles from '../painel.module.css';

export interface DevStatusUnit {
  id: string;
  code: string;
  objectKey: string;
  status: UnitStatus;
  updatedAt: string;
  floor: number | null;
  typeName: string | null;
  development: string;
  developmentSlug: string;
  published: boolean;
}

type RowState = { pending?: boolean; error?: string; flash?: boolean };

const time = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' });

export function DevStatusTable({ initialUnits }: { initialUnits: DevStatusUnit[] }) {
  const [units, setUnits] = useState(initialUnits);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [reason, setReason] = useState('');

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

  const developments = useMemo(() => {
    const map = new Map<string, { name: string; slug: string; published: boolean }>();
    for (const u of units)
      map.set(u.developmentSlug, {
        name: u.development,
        slug: u.developmentSlug,
        published: u.published,
      });
    return [...map.values()];
  }, [units]);

  return (
    <>
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
        {developments.map((d) =>
          d.published ? (
            <a
              key={d.slug}
              href={`/e/${d.slug}`}
              target="_blank"
              rel="noreferrer"
              className={styles.secondary}
            >
              Abrir demo: {d.name} ↗
            </a>
          ) : (
            <span key={d.slug} className={styles.muted}>
              {d.name} (rascunho, sem página pública)
            </span>
          ),
        )}
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Unidade</th>
            <th>Andar</th>
            <th>Planta</th>
            <th>Status</th>
            <th>Atualizado</th>
          </tr>
        </thead>
        <tbody>
          {units.map((u) => {
            const st = rowState[u.id] ?? {};
            return (
              <tr key={u.id} data-flash={st.flash || undefined}>
                <td>
                  <span className={styles.mono}>{u.code}</span>
                  {developments.length > 1 && (
                    <span className={styles.muted}> · {u.development}</span>
                  )}
                </td>
                <td className={styles.mono}>{u.floor ?? '—'}</td>
                <td>{u.typeName ?? '—'}</td>
                <td>
                  <span className={styles.statusCell}>
                    <StatusSwatch status={u.status} />
                    <select
                      aria-label={`Status da unidade ${u.code}`}
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
                <td className={`${styles.mono} ${styles.muted}`}>
                  {time.format(new Date(u.updatedAt))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
