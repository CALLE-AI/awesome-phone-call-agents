import { Suspense } from "react";
import { readBrainConfig } from "@/lib/brain/config";
import { requireAccount } from "@/lib/console/auth-gate";
import { CallDossier } from "@/lib/console/CallDossier";
import { loadCall } from "@/lib/console/load";

export default async function CallPage({ params }: { params: Promise<{ callId: string }> }) {
  const account = await requireAccount();
  const { callId } = await params;
  const { call, lead } = await loadCall(callId, account.id);
  const brain = readBrainConfig(account.id);
  return (
    <Suspense fallback={<div className="text-[17px] text-[var(--sd-muted)]">Loading call…</div>}>
      <CallDossier
        key={callId}
        callId={callId}
        initialCall={call}
        initialLead={lead}
        initialAgentIdentity={brain.agentIdentity}
        initialProductName={brain.productName}
      />
    </Suspense>
  );
}
