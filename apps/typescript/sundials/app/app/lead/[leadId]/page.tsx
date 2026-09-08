import { Suspense } from "react";
import { LeadDetail } from "@/lib/console/LeadDetail";
import { loadLead } from "@/lib/console/load";

export default async function LeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const { lead, calls } = await loadLead(leadId);
  return (
    <Suspense fallback={<div className="text-[17px] text-[var(--sd-muted)]">Loading lead…</div>}>
      <LeadDetail key={leadId} leadId={leadId} initialLead={lead} initialCalls={calls} />
    </Suspense>
  );
}
