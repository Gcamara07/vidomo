import type { Metadata } from 'next';
import { getPanelContext } from '@/lib/panel/context';
import { LEAD_COLUMNS, leadFromRow } from '@/lib/panel/leads';
import { serverClient } from '@/lib/supabase/server';
import { linkCodes } from '@/lib/unit-ref';
import styles from '../painel.module.css';
import { LeadsBoard, type BoardDevelopment, type BoardMember, type BoardUnit } from './LeadsBoard';

export const metadata: Metadata = { title: 'Leads · Vidomo' };
export const dynamic = 'force-dynamic';

/** Mais novos primeiro. TODO(paginação): carregar mais quando passar deste número. */
const LEADS_LIMIT = 500;

interface PageProps {
  /** ?lead=<id>: destaca um lead (link do e-mail de lead novo). */
  searchParams: Promise<{ lead?: string }>;
}

/** Leads da equipe. Tudo passa pela RLS do usuário logado (só a própria organização). */
export default async function LeadsPage({ searchParams }: PageProps) {
  const ctx = await getPanelContext();
  const { lead: focusId } = await searchParams;
  const supabase = await serverClient();

  const [leads, devs, units, members, profiles, consent] = await Promise.all([
    supabase
      .from('leads')
      .select(LEAD_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(LEADS_LIMIT),
    supabase.from('developments').select('id, organization_id, name, slug, status').order('name'),
    supabase.from('units').select('id, development_id, code, towers(code, name, sort_order)'),
    supabase.from('organization_members').select('organization_id, user_id, role'),
    supabase.from('profiles').select('id, full_name'),
    supabase
      .from('consent_texts')
      .select('body')
      .eq('kind', 'in_person')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const failed = [leads, devs, units, members, profiles].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  const names = new Map(
    (profiles.data ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? null]),
  );
  const boardMembers: BoardMember[] = (members.data ?? []).map((m) => ({
    organizationId: m.organization_id as string,
    userId: m.user_id as string,
    role: m.role as 'admin' | 'sales',
    name: names.get(m.user_id as string) ?? 'Sem nome',
  }));
  const developments: BoardDevelopment[] = (devs.data ?? []).map((d) => ({
    id: d.id as string,
    organizationId: d.organization_id as string,
    name: d.name as string,
    slug: d.slug as string,
    published: d.status === 'published',
  }));
  const boardUnits = toBoardUnits(
    (units.data ?? []) as unknown as {
      id: string;
      development_id: string;
      code: string;
      towers: { code: string; name: string; sort_order: number } | null;
    }[],
  );

  return (
    <main className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Painel comercial</p>
          <h1 className={styles.pageTitle}>Leads</h1>
        </div>
      </header>
      <LeadsBoard
        initialLeads={(leads.data ?? []).map((r) => leadFromRow(r as Record<string, unknown>))}
        developments={developments}
        units={boardUnits}
        members={boardMembers}
        me={{ userId: ctx.userId, name: ctx.fullName }}
        adminOrgIds={ctx.memberships.filter((m) => m.role === 'admin').map((m) => m.organizationId)}
        orgNames={Object.fromEntries(
          ctx.memberships.map((m) => [m.organizationId, m.organizationName]),
        )}
        consentInPersonText={(consent.data?.body as string | undefined) ?? null}
        focusId={typeof focusId === 'string' ? focusId : null}
        limit={LEADS_LIMIT}
      />
    </main>
  );
}

/**
 * Unidades do painel: bloco só em empreendimento com vários blocos, código do link da
 * página pública (mesma regra de lá) e ordem bloco → código.
 */
function toBoardUnits(
  rows: {
    id: string;
    development_id: string;
    code: string;
    towers: { code: string; name: string; sort_order: number } | null;
  }[],
): BoardUnit[] {
  const byDev = new Map<string, typeof rows>();
  for (const r of rows) byDev.set(r.development_id, [...(byDev.get(r.development_id) ?? []), r]);
  const out: (BoardUnit & { order: number; tower: string })[] = [];
  for (const list of byDev.values()) {
    const many = new Set(list.map((r) => r.towers?.code)).size > 1;
    const links = linkCodes(
      list.map((r) => ({ object_key: r.id, code: r.code, tower_code: r.towers?.code ?? '' })),
    );
    for (const r of list) {
      out.push({
        id: r.id,
        developmentId: r.development_id,
        code: r.code,
        linkCode: links.get(r.id)!,
        towerName: many ? (r.towers?.name ?? null) : null,
        order: r.towers?.sort_order ?? 0,
        tower: r.towers?.code ?? '',
      });
    }
  }
  return out
    .sort(
      (a, b) =>
        a.order - b.order ||
        a.tower.localeCompare(b.tower) ||
        a.code.localeCompare(b.code, 'pt-BR', { numeric: true }),
    )
    .map(({ order: _order, tower: _tower, ...u }) => u);
}
