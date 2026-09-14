"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./navigation.module.css";

const links = [
  ["/", "Overview"], ["/calls", "Calls"],
  ["/briefings", "Daily knowledge"], ["/realtime", "Voice test"],
] as const;

export function AppNavigation() {
  const pathname = usePathname();
  return <header className={styles.header}>
    <a className={styles.skip} href="#workspace-content">Skip to content</a>
    <div className={styles.inner}>
      <Link href="/" className={styles.brand} aria-label="Senior Phone AI home">
        <span className={styles.mark} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2c0 9 7 16 16 16a2 2 0 0 0 2-2v-3l-5-2-2 2a12 12 0 0 1-6-6l2-2-2-5Z" /></svg>
        </span>
        <span>Senior Phone AI<small>Calls &amp; follow-ups</small></span>
      </Link>
      <nav className={styles.links} aria-label="Main navigation">
        {links.map(([href, label]) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
          return <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`${styles.link} ${active ? styles.active : ""}`}>{label}</Link>;
        })}
      </nav>
    </div>
  </header>;
}
