
import styles from "./family.module.css";

export const dynamic = "force-dynamic";

export default function FamilyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={styles.shell}>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
