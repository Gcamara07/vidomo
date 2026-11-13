/**
 * Cria (ou redefine a senha de) o admin do AMBIENTE DE DEMONSTRAÇÃO.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     pnpm demo:admin --email voce@exemplo.com [--org construtora-exemplo] [--reset]
 *
 * - Gera uma senha forte (24 caracteres aleatórios) e a imprime UMA vez no terminal.
 *   A senha não é gravada em arquivo; guarde-a num gerenciador de senhas.
 * - E-mail confirmado na criação (sem envio de e-mail).
 * - Vincula o usuário como admin da organização.
 * - --reset gera nova senha para um usuário que já existe.
 * A service_role só é usada aqui, no terminal; nunca vai para o app nem para a Vercel.
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { serviceClient } from './lib/supabase-env';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    org: { type: 'string', default: 'construtora-exemplo' },
    reset: { type: 'boolean', default: false },
  },
});

/** 24 caracteres de [A-Za-z0-9-_] (~143 bits). */
function strongPassword(): string {
  return randomBytes(18).toString('base64url');
}

async function main() {
  const email = values.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('Informe --email válido.');
  }
  const client = serviceClient();

  const { data: org, error: orgErr } = await client
    .from('organizations')
    .select('id, name')
    .eq('slug', values.org!)
    .maybeSingle();
  if (orgErr) throw orgErr;
  if (!org) throw new Error(`Organização "${values.org}" não existe. Rode o demo-seed antes.`);

  // Procura o usuário pelo e-mail (poucos usuários na demo: uma página basta).
  const { data: list, error: listErr } = await client.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  const existing = list.users.find((u) => u.email?.toLowerCase() === email);

  const password = strongPassword();
  let userId: string;
  if (existing) {
    if (!values.reset) {
      throw new Error(`O usuário ${email} já existe. Use --reset para gerar nova senha.`);
    }
    const { error } = await client.auth.admin.updateUserById(existing.id, { password });
    if (error) throw error;
    userId = existing.id;
  } else {
    const { data, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Admin da demo' },
    });
    if (error) throw error;
    userId = data.user.id;
  }

  const { error: memberErr } = await client
    .from('organization_members')
    .upsert({ organization_id: org.id, user_id: userId, role: 'admin' });
  if (memberErr) throw memberErr;

  console.log(`Admin da demo ${existing ? 'com senha redefinida' : 'criado'}: ${email}`);
  console.log(`Organização: ${org.name} (admin)`);
  console.log(`Senha (mostrada só agora; não fica gravada): ${password}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
