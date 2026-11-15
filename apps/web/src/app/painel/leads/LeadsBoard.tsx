'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { whatsappHref } from '@/lib/lead-form';
import {
  DEFAULT_FILTERS,
  LEAD_COLUMNS,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  canChangeStatus,
  csvFileName,
  filterLeads,
  formatPhone,
  leadFromRow,
  leadsToCsv,
  panelErrorMessage,
  sellerWhatsappMessage,
  upsertLead,
  type LeadFilters,
  type LeadStatus,
  type PanelLead,
} from '@/lib/panel/leads';
import { browserClient } from '@/lib/supabase/browser';
import styles from '../painel.module.css';
import { DeleteLeadDialog } from './DeleteLeadDialog';
import { ManualLeadForm } from './ManualLeadForm';

export interface BoardDevelopment {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  published: boolean;
}
export interface BoardUnit {
  id: string;
  developmentId: string;
  code: string;
}
export interface BoardMember {
  organizationId: string;
  userId: string;
  role: 'admin' | 'sales';
  name: string;
}

/** Tempo do destaque de um lead que acabou de chegar. */
const FLASH_MS = 8000;

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

type RowState = { pending?: boolean; error?: string };

export function LeadsBoard({
  initialLeads,
  developments,
  units,
  members,
  me,
  adminOrgIds,
  orgNames,
  consentInPersonText,
  focusId,
  limit,
}: {
  initialLeads: PanelLead[];
  developments: BoardDevelopment[];
  units: BoardUnit[];
  members: BoardMember[];
  me: { userId: string; name: string | null };
  adminOrgIds: string[];
  orgNames: Record<string, string>;
  consentInPersonText: string | null;
  focusId: string | null;
  limit: number;
}) {
  const [leads, setLeads] = useState(initialLeads);
  const [filters, setFilters] = useState<LeadFilters>(DEFAULT_FILTERS);
  const [flash, setFlash] = useState<Set<string>>(() => new Set(focusId ? [focusId] : []));
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [announce, setAnnounce] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [deleting, setDeleting] = useState<PanelLead | null>(null);
  const [connected, setConnected] = useState(false);

  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const devById = useMemo(() => new Map(developments.map((d) => [d.id, d])), [developments]);
  const memberName = useCallback(
    (userId: string | null) =>
      userId ? (members.find((m) => m.userId === userId)?.name ?? 'Ex-membro') : '',
    [members],
  );
  const isAdminOf = useCallback((orgId: string) => adminOrgIds.includes(orgId), [adminOrgIds]);

  const flashLead = useCallback((id: string) => {
    setFlash((s) => new Set(s).add(id));
    setTimeout(
      () =>
        setFlash((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        }),
      FLASH_MS,
    );
  }, []);

  // ?lead=<id> (link do e-mail): rola até o lead e tira o destaque depois.
  useEffect(() => {
    if (!focusId) return;
    document.getElementById(`lead-${focusId}`)?.scrollIntoView({ block: 'center' });
    const t = setTimeout(
      () =>
        setFlash((s) => {
          const n = new Set(s);
          n.delete(focusId);
          return n;
        }),
      FLASH_MS,
    );
    return () => clearTimeout(t);
  }, [focusId]);

  // Tempo real: postgres_changes em leads, filtrado pela RLS do usuário. Ao (re)conectar,
  // relê a lista para cobrir o que chegou enquanto o canal estava fora.
  useEffect(() => {
    const client = browserClient();
    let channel: ReturnType<typeof client.channel> | null = null;
    let disposed = false;

    const resync = async () => {
      const { data } = await client
        .from('leads')
        .select(LEAD_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (!disposed && data) setLeads(data.map((r) => leadFromRow(r as Record<string, unknown>)));
    };

    void (async () => {
      // O Realtime aplica a RLS com o JWT do canal: autentica antes de assinar.
      const { data } = await client.auth.getSession();
      if (disposed) return;
      if (data.session) await client.realtime.setAuth(data.session.access_token);
      channel = client
        .channel('painel-leads')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, (msg) => {
          if (msg.eventType === 'DELETE') {
            const id = (msg.old as { id?: string }).id;
            if (id) setLeads((l) => l.filter((x) => x.id !== id));
            return;
          }
          const lead = leadFromRow(msg.new as Record<string, unknown>);
          setLeads((l) => upsertLead(l, lead));
          if (msg.eventType === 'INSERT') {
            flashLead(lead.id);
            const unit = lead.unitId ? unitById.get(lead.unitId)?.code : null;
            setAnnounce(`Novo lead: ${lead.name}${unit ? `, unidade ${unit}` : ''}.`);
          }
        })
        .subscribe((status) => {
          if (disposed) return;
          setConnected(status === 'SUBSCRIBED');
          if (status === 'SUBSCRIBED') void resync();
        });
    })();

    return () => {
      disposed = true;
      if (channel) void client.removeChannel(channel);
    };
  }, [flashLead, limit, unitById]);

  const visible = useMemo(
    () => filterLeads(leads, filters, me.userId),
    [leads, filters, me.userId],
  );

  const patchRow = (id: string, patch: RowState) =>
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  /** Chama uma RPC do lead e aplica a linha devolvida. */
  async function act(lead: PanelLead, fn: string, args: Record<string, unknown>) {
    patchRow(lead.id, { pending: true, error: undefined });
    const { data, error } = await browserClient().rpc(fn, { p_lead_id: lead.id, ...args });
    if (error) {
      patchRow(lead.id, { pending: false, error: panelErrorMessage(error) });
      return;
    }
    if (data && typeof data === 'object') {
      setLeads((l) => upsertLead(l, leadFromRow(data as Record<string, unknown>)));
    }
    patchRow(lead.id, { pending: false });
  }

  function exportCsv() {
    const csv = leadsToCsv(visible, {
      unitCode: (id) => (id ? (unitById.get(id)?.code ?? '') : ''),
      developmentName: (id) => devById.get(id)?.name ?? '',
      memberName,
    });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const setFilter = <K extends keyof LeadFilters>(key: K, value: LeadFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  return (
    <>
      <p className={styles.srOnly} role="status" aria-live="polite">
        {announce}
      </p>

      <div className={styles.toolbar}>
        <label className={styles.field}>
          <span>Status</span>
          <select
            value={filters.status}
            onChange={(e) => setFilter('status', e.target.value as LeadFilters['status'])}
          >
            <option value="all">Todos</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Origem</span>
          <select
            value={filters.source}
            onChange={(e) => setFilter('source', e.target.value as LeadFilters['source'])}
          >
            <option value="all">Todas</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {LEAD_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {developments.length > 1 && (
          <label className={styles.field}>
            <span>Empreendimento</span>
            <select
              value={filters.developmentId}
              onChange={(e) => setFilter('developmentId', e.target.value)}
            >
              <option value="all">Todos</option>
              {developments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={filters.mine}
            onChange={(e) => setFilter('mine', e.target.checked)}
          />
          Meus leads
        </label>
        <span className={styles.toolbarEnd}>
          <span className={`${styles.muted} ${styles.mono}`} aria-live="polite">
            {visible.length} de {leads.length}
          </span>
          <span className={styles.liveDot} data-on={connected || undefined} title="Tempo real">
            {connected ? 'ao vivo' : 'conectando'}
          </span>
          <button
            type="button"
            className={styles.secondary}
            onClick={exportCsv}
            disabled={!visible.length}
          >
            Exportar CSV
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => setShowManual((v) => !v)}
            aria-expanded={showManual}
          >
            Cadastrar lead manual
          </button>
        </span>
      </div>

      {showManual && (
        <ManualLeadForm
          developments={developments}
          units={units}
          consentText={consentInPersonText}
          onCancel={() => setShowManual(false)}
          onCreated={(row) => {
            const lead = leadFromRow(row);
            setLeads((l) => upsertLead(l, lead));
            flashLead(lead.id);
            setShowManual(false);
          }}
        />
      )}

      {visible.length === 0 ? (
        <p className={styles.empty}>
          {leads.length ? 'Nenhum lead com esses filtros.' : 'Nenhum lead ainda.'}
        </p>
      ) : (
        <ol className={styles.leadList}>
          {visible.map((lead) => {
            const dev = devById.get(lead.developmentId);
            const unit = lead.unitId ? unitById.get(lead.unitId) : undefined;
            const admin = isAdminOf(lead.organizationId);
            const row = rows[lead.id] ?? {};
            const mayChangeStatus = canChangeStatus(lead, me.userId, admin);
            const team = members.filter((m) => m.organizationId === lead.organizationId);
            const waText = sellerWhatsappMessage({
              leadName: lead.name,
              sellerName: me.name,
              organizationName: orgNames[lead.organizationId] ?? '',
              developmentName: dev?.name ?? '',
              unitCode: unit?.code ?? null,
            });
            return (
              <li
                key={lead.id}
                id={`lead-${lead.id}`}
                className={styles.leadCard}
                data-flash={flash.has(lead.id) || undefined}
                aria-busy={row.pending || undefined}
              >
                <div className={styles.leadHead}>
                  <h2 className={styles.leadName}>{lead.name}</h2>
                  <span className={styles.leadStatus} data-status={lead.status}>
                    {LEAD_STATUS_LABELS[lead.status]}
                  </span>
                  {flash.has(lead.id) && <span className={styles.newBadge}>agora</span>}
                  <time className={`${styles.muted} ${styles.mono}`} dateTime={lead.createdAt}>
                    {dateTime.format(new Date(lead.createdAt))}
                  </time>
                </div>

                <p className={styles.leadMeta}>
                  {unit && dev ? (
                    <a
                      href={`/e/${dev.slug}?u=${encodeURIComponent(unit.code)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Unidade <span className={styles.mono}>{unit.code}</span> ↗
                    </a>
                  ) : (
                    <span>Sem unidade</span>
                  )}
                  {developments.length > 1 && dev && <span>{dev.name}</span>}
                  <span>{LEAD_SOURCE_LABELS[lead.source]}</span>
                  <span>
                    {lead.assignedTo
                      ? `Com ${lead.assignedTo === me.userId ? 'você' : memberName(lead.assignedTo)}`
                      : 'Sem responsável'}
                  </span>
                </p>

                <p className={styles.leadContact}>
                  {lead.phone && <span className={styles.mono}>{formatPhone(lead.phone)}</span>}
                  {lead.email && <a href={`mailto:${lead.email}`}>{lead.email}</a>}
                </p>
                {lead.message && <p className={styles.leadMessage}>{lead.message}</p>}

                <div className={styles.leadActions}>
                  {!lead.assignedTo && (
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={row.pending}
                      onClick={() => act(lead, 'claim_lead', {})}
                    >
                      Assumir
                    </button>
                  )}
                  <label className={styles.inlineField}>
                    <span className={styles.srOnly}>Status do lead de {lead.name}</span>
                    <select
                      value={lead.status}
                      disabled={!mayChangeStatus || row.pending}
                      title={mayChangeStatus ? undefined : 'Assuma o lead para mudar o status'}
                      onChange={(e) =>
                        act(lead, 'set_lead_status', { p_status: e.target.value as LeadStatus })
                      }
                    >
                      {LEAD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {LEAD_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {admin && (
                    <label className={styles.inlineField}>
                      <span className={styles.srOnly}>Responsável pelo lead de {lead.name}</span>
                      <select
                        value={lead.assignedTo ?? ''}
                        disabled={row.pending}
                        onChange={(e) =>
                          act(lead, 'assign_lead', { p_user_id: e.target.value || null })
                        }
                      >
                        <option value="">Sem responsável</option>
                        {team.map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {lead.phone && (
                    <a
                      className={styles.secondary}
                      href={whatsappHref(lead.phone, waText)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      WhatsApp ↗
                    </a>
                  )}
                  {admin && (
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={row.pending}
                      onClick={() => setDeleting(lead)}
                    >
                      Excluir
                    </button>
                  )}
                </div>
                {row.error && (
                  <p className={styles.error} role="alert">
                    {row.error}
                  </p>
                )}
                <p className={styles.consentLine}>
                  {lead.source === 'manual'
                    ? 'Consentimento presencial registrado'
                    : 'Consentimento online'}{' '}
                  em {lead.consentAt ? dateTime.format(new Date(lead.consentAt)) : '—'} (
                  {lead.consentVersion})
                </p>
              </li>
            );
          })}
        </ol>
      )}

      {deleting && (
        <DeleteLeadDialog
          lead={deleting}
          onCancel={() => setDeleting(null)}
          onDeleted={(id) => {
            setLeads((l) => l.filter((x) => x.id !== id));
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}
