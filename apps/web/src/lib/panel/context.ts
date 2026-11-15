import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { serverClient } from '../supabase/server';

export interface PanelMembership {
  organizationId: string;
  organizationName: string;
  role: 'admin' | 'sales';
}

export interface PanelContext {
  userId: string;
  email: string;
  fullName: string | null;
  memberships: PanelMembership[];
}

/**
 * Quem está no painel: usuário, nome e organizações (com papel). Uma vez por requisição
 * (cache do React); sem sessão, volta para o login. A RLS continua sendo quem protege os
 * dados — isto só decide o que mostrar.
 */
export const getPanelContext = cache(async (): Promise<PanelContext> => {
  const supabase = await serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // O proxy já manda para o login com ?next=; aqui é só a defesa em profundidade.
  if (!user) redirect('/login');

  const [{ data: rows, error }, { data: profile }] = await Promise.all([
    supabase
      .from('organization_members')
      .select('organization_id, role, organizations(name)')
      .eq('user_id', user.id),
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);

  return {
    userId: user.id,
    email: user.email ?? '',
    fullName: (profile?.full_name as string | null) ?? null,
    memberships: (rows ?? []).map((r) => ({
      organizationId: r.organization_id as string,
      organizationName:
        (r.organizations as unknown as { name: string } | null)?.name ?? 'Organização',
      role: r.role as 'admin' | 'sales',
    })),
  };
});

export const isAdminOf = (ctx: PanelContext, organizationId: string) =>
  ctx.memberships.some((m) => m.organizationId === organizationId && m.role === 'admin');
