import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { serverClient } from '@/lib/supabase/server';
import styles from '../painel.module.css';
import { DevStatusTable, type DevStatusUnit } from './DevStatusTable';

export const metadata: Metadata = { title: 'Status das unidades · Vidomo' };
export const dynamic = 'force-dynamic';

/**
 * Tela mínima de alteração de status (fatia vertical). Lista as unidades que a RLS deixa
 * o usuário ver (só a própria organização) e altera status só por set_unit_status.
 * TODO(painel comercial): substituir pelo painel completo (filtros, reservas, leads).
 */
export default async function DevStatusPage() {
  const supabase = await serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/painel/dev-status');

  const [{ data: memberships, error: mErr }, { data: rows, error: uErr }] = await Promise.all([
    supabase
      .from('organization_members')
      .select('role, organizations(name)')
      .eq('user_id', user.id),
    supabase
      .from('units')
      .select(
        'id, code, object_key, status, updated_at, floors(number), unit_types(name), developments(name, slug, status)',
      )
      .order('object_key'),
  ]);
  if (mErr || uErr) throw new Error((mErr ?? uErr)!.message);

  const units: DevStatusUnit[] = (rows ?? []).map((r) => {
    const floor = r.floors as unknown as { number: number } | null;
    const type = r.unit_types as unknown as { name: string } | null;
    const dev = r.developments as unknown as { name: string; slug: string; status: string };
    return {
      id: r.id,
      code: r.code,
      objectKey: r.object_key,
      status: r.status,
      updatedAt: r.updated_at,
      floor: floor?.number ?? null,
      typeName: type?.name ?? null,
      development: dev.name,
      developmentSlug: dev.slug,
      published: dev.status === 'published',
    };
  });

  const orgs = (memberships ?? []).map((m) => {
    const org = m.organizations as unknown as { name: string } | null;
    return `${org?.name ?? '—'} (${m.role === 'admin' ? 'admin' : 'vendas'})`;
  });

  return (
    <main className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Painel · dev</p>
          <h1 className={styles.pageTitle}>Status das unidades</h1>
          <p className={styles.muted}>
            {user.email} · {orgs.length ? orgs.join(', ') : 'sem organização'}
          </p>
        </div>
      </header>

      {units.length === 0 ? (
        <p className={styles.muted}>Nenhuma unidade visível para este usuário.</p>
      ) : (
        <DevStatusTable initialUnits={units} />
      )}
    </main>
  );
}
