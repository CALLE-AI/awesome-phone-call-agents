import { BriefingWorkspace } from "./workspace";
import Link from "next/link";
import styles from "./page.module.css";

export default function BriefingsPage() {
  return <main className={styles.page}><nav><Link className="brand" href="/">Senior Phone AI</Link><Link href="/calls">Call monitor</Link></nav>
    <h1>A morning briefing, just for them.</h1>
    <p>Country news, nearby activities and useful updates prepared before the phone rings. Each senior has their own location, interests and local morning.</p>
    <BriefingWorkspace />
  </main>;
}
