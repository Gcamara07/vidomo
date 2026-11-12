'use server';
import { redirect } from 'next/navigation';
import { safeNextPath } from '@/lib/safe-next';
import { serverClient } from '@/lib/supabase/server';

export async function signIn(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = safeNextPath(formData.get('next'));

  const supabase = await serverClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Mensagem genérica: não revela se o e-mail existe.
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}

export async function signOut() {
  const supabase = await serverClient();
  await supabase.auth.signOut();
  redirect('/login');
}
