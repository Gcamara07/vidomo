import type { Metadata } from 'next';
import { getPanelContext } from '@/lib/panel/context';
import { LEAD_COLUMNS, leadFromRow } from '@/lib/panel/leads';
import { serverClient } from '@/lib/supabase/server';
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
    supabase.from('units').select('id, development_id, code'),
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
  const boardUnits: BoardUnit[] = (units.data ?? [])
    .map((u) => ({
      id: u.id as string,
      developmentId: u.development_id as string,
      code: u.code as string,
    }))
    .sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }));

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
