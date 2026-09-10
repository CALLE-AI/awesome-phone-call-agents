import type { Metadata } from "next";
import Link from "next/link";

import { RealtimeHarness } from "./RealtimeHarness";

export const metadata: Metadata = {
  title: "Realtime harness | Senior Phone AI",
  robots: { index: false, follow: false },
};

export default function RealtimeHarnessPage() {
  return (
    <main className="harness-page">
      <nav aria-label="Developer harness">
        <Link className="brand" href="/">Senior Phone AI</Link>
        <span className="mode">private harness</span>
      </nav>
      <RealtimeHarness />
    </main>
  );
}
