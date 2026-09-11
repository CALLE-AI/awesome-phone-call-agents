import { Suspense } from "react";
import { ClarityApp } from "./components/ClarityApp";
import { isReplayMode } from "@/lib/replay";

// Read the mode at request time so the UI agrees with the API after deployment.
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-ink" />}>
      <ClarityApp demoMode={isReplayMode() ? "replay" : "live"} />
    </Suspense>
  );
}
