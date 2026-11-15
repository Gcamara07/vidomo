import { getPanelContext } from '@/lib/panel/context';
import { signOut } from '../login/actions';
import { NavLink } from './NavLink';
import styles from './painel.module.css';

/** Moldura do painel: navegação, quem está logado e "Sair". */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPanelContext();
  const isAdmin = ctx.memberships.some((m) => m.role === 'admin');
  const orgs = ctx.memberships
    .map((m) => `${m.organizationName} (${m.role === 'admin' ? 'admin' : 'vendas'})`)
    .join(', ');

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <nav aria-label="Painel" className={styles.nav}>
          <span className={styles.brand}>Vidomo</span>
          <NavLink href="/painel/leads">Leads</NavLink>
          {isAdmin && <NavLink href="/painel/config">Configuração</NavLink>}
          <NavLink href="/painel/dev-status">Status das unidades</NavLink>
        </nav>
        <div className={styles.who}>
          <span className={styles.muted}>
            {ctx.fullName ?? ctx.email}
            {orgs ? ` · ${orgs}` : ''}
          </span>
          <form action={signOut}>
            <button type="submit" className={styles.linkButton}>
              Sair
            </button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
