'use server';
import { revalidatePath } from 'next/cache';
import { getPanelContext, isAdminOf } from '@/lib/panel/context';
import { validateConfig, type ConfigField } from '@/lib/panel/config';
import { serverClient } from '@/lib/supabase/server';

export interface ConfigState {
  status: 'idle' | 'saved' | 'error';
  errors?: Partial<Record<ConfigField, string>>;
  message?: string;
}

/**
 * Salva WhatsApp, e-mails e webhook da organização. Valida aqui (https obrigatório) e grava
 * com a sessão do admin: a RLS só deixa o admin da própria organização escrever.
 */
export async function saveConfig(_prev: ConfigState, form: FormData): Promise<ConfigState> {
  const organizationId = String(form.get('organizationId') ?? '');
  const ctx = await getPanelContext();
  if (!isAdminOf(ctx, organizationId)) {
    return { status: 'error', message: 'Só administradores podem alterar a configuração.' };
  }

  const result = validateConfig({
    whatsapp: String(form.get('whatsapp') ?? ''),
    emails: String(form.get('emails') ?? ''),
    webhookUrl: String(form.get('webhookUrl') ?? ''),
  });
  if (!result.ok) return { status: 'error', errors: result.errors };

  // Atualiza; se a organização ainda não tem linha, insere. (Um upsert faria
  // "ON CONFLICT DO UPDATE SET organization_id = …", e o admin não tem — de propósito —
  // permissão de UPDATE nessa coluna.)
  const supabase = await serverClient();
  const updated = await supabase
    .from('organization_settings')
    .update(result.values)
    .eq('organization_id', organizationId)
    .select('organization_id');
  let error = updated.error;
  if (!error && (updated.data ?? []).length === 0) {
    ({ error } = await supabase
      .from('organization_settings')
      .insert({ organization_id: organizationId, ...result.values }));
  }
  if (error) {
    console.error(`organization_settings: ${error.code ?? 'sem código'}`);
    return { status: 'error', message: 'Não foi possível salvar agora. Tente de novo.' };
  }

  revalidatePath('/painel/config');
  return { status: 'saved' };
}
