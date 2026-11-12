import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { safeNextPath } from '@/lib/safe-next';
import { serverClient } from '@/lib/supabase/server';
import styles from '../painel/painel.module.css';
import { signIn } from './actions';

export const metadata: Metadata = { title: 'Entrar · Vidomo' };

interface LoginProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginProps) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNextPath(rawNext);

  const supabase = await serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(next);

  return (
    <main className={styles.loginWrap}>
      <form action={signIn} className={styles.loginCard}>
        <h1 className={styles.loginTitle}>
          Vidomo <em>painel</em>
        </h1>
        {error && (
          <p className={styles.error} role="alert">
            E-mail ou senha incorretos.
          </p>
        )}
        <label className={styles.field}>
          <span>E-mail</span>
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label className={styles.field}>
          <span>Senha</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <input type="hidden" name="next" value={next} />
        <button type="submit" className={styles.primary}>
          Entrar
        </button>
      </form>
    </main>
  );
}
