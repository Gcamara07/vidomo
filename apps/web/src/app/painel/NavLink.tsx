'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './painel.module.css';

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const current = usePathname().startsWith(href);
  return (
    <Link href={href} className={styles.navLink} aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  );
}
