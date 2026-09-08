import { Suspense } from "react";
import { readBrainConfig } from "@/lib/brain/config";
import { CallDossier } from "@/lib/console/CallDossier";
import { loadCall } from "@/lib/console/load";
import { HARBOR_ACCOUNT_ID } from "@/lib/sdk/public-key";

export default async function CallPage({ params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  const { call, lead } = await loadCall(callId);
  const brain = readBrainConfig(HARBOR_ACCOUNT_ID);
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
