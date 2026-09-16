import { Suspense } from "react";
import { TelemetryPanel } from "@/lib/console/TelemetryPanel";
import { requireAccount } from "@/lib/console/auth-gate";
import { loadConsole } from "@/lib/console/load";

export default async function TelemetryPage() {
  const account = await requireAccount();
  const { leads } = await loadConsole(undefined, account.id);
  return (
    <Suspense fallback={<div className="text-[17px] text-[var(--sd-muted)]">Loading telemetry…</div>}>
      <TelemetryPanel initialLeads={leads} />
    </Suspense>
  );
}
