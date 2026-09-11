import styles from "./family.module.css";

export default function FamilyLoading() {
  return <main className={styles.card} aria-live="polite"><p className={styles.eyebrow}>Private family workspace</p><h1>Loading shared records…</h1></main>;
}
