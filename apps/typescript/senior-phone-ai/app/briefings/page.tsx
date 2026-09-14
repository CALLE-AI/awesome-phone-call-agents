import { BriefingWorkspace } from "./workspace";
import styles from "./page.module.css";

export default function BriefingsPage() {
  return <main className={styles.page}>
    <h1>Daily knowledge for every call.</h1>
    <p>Prepare one source-backed Australian briefing for every senior before the phone rings. No personal profile is required.</p>
    <BriefingWorkspace />
  </main>;
}
