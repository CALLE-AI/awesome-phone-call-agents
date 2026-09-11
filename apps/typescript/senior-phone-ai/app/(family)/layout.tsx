import Link from "next/link";

import styles from "./family.module.css";

export const dynamic = "force-dynamic";

export default function FamilyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={styles.shell}>
      <nav className={styles.nav} aria-label="Family workspace">
        <Link href="/dashboard">Senior Phone AI</Link>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/seniors">Seniors</Link>
        <Link href="/reminders">Reminders</Link>
        <Link href="/settings">Settings</Link>
        <Link href="/calls">Live calls</Link>
      </nav>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
