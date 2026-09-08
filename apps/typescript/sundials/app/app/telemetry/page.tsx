import { Suspense } from "react";
import { TelemetryPanel } from "@/lib/console/TelemetryPanel";
import { loadConsole } from "@/lib/console/load";

export default async function TelemetryPage() {
  const { leads } = await loadConsole();
  return (
    <Suspense fallback={<div className="text-[17px] text-[var(--sd-muted)]">Loading telemetry…</div>}>
      <TelemetryPanel initialLeads={leads} />
    </Suspense>
  );
}
