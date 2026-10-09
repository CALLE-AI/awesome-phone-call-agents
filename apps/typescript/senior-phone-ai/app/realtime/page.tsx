import type { Metadata } from "next";

import { RealtimeHarness } from "./RealtimeHarness";

export const metadata: Metadata = {
  title: "Realtime harness | Senior Phone AI",
  robots: { index: false, follow: false },
};

export default function RealtimeHarnessPage() {
  return (
    <main className="harness-page">
      <div className="page-context"><span className="mode">private harness</span></div>
      <RealtimeHarness />
    </main>
  );
}
