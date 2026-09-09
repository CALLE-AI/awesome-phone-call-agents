import { Suspense } from "react";
import { LeadDetail } from "@/lib/console/LeadDetail";
import { requireAccount } from "@/lib/console/auth-gate";
import { loadLead } from "@/lib/console/load";

export default async function LeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const account = await requireAccount();
  const { leadId } = await params;
  const { lead, calls } = await loadLead(leadId, account.id);
  return (
    <Suspense fallback={<div className="text-[17px] text-[var(--sd-muted)]">Loading lead…</div>}>
      <LeadDetail key={leadId} leadId={leadId} initialLead={lead} initialCalls={calls} />
    </Suspense>
  );
}
