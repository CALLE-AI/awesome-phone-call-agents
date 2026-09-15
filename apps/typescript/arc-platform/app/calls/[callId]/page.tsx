import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";

import AppShell from "@/components/app-shell/AppShell";
import { db } from "@/lib/db";
import { getOrCreateBrand } from "@/lib/brand";
import CallTranscript from "./_components/CallTranscript";

/**
 * The transcript for one call, anchored so a number can be linked to the
 * moment it was said.
 *
 * This is where every "heard here" on a plan lands. It reads the transcript
 * from OUR record rather than from CALL-E: the last beat of the demo is a
 * confirmed rate opening the sentence that confirmed it, and that cannot
 * depend on an API which has spent hours refusing requests.
 */
export const dynamic = "force-dynamic";

export default async function CallPage({ params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const brand = await getOrCreateBrand(userId);

  /* Scoped to the brand: a call id should not read another brand's call. */
  const call = await db.call.findFirst({
    where: { calleCallId: callId, brandId: brand.id },
  });
  if (!call) notFound();

  return (
    <AppShell crumb={call.targetName}>
      <CallTranscript
        call={{
          calleCallId: call.calleCallId,
          targetName: call.targetName,
          targetType: call.targetType === "STATION" ? "station" : "creator",
          status: call.status,
          outcome: call.outcome,
          pricePkr: call.pricePkr,
          rateBasis: call.detail,
          rateConfirmed: call.rateConfirmed,
          estimateAtCallPkr: call.estimateAtCallPkr,
          mandateTargetPkr: call.mandateTargetPkr,
          mandateWalkAwayPkr: call.mandateWalkAwayPkr,
          completedAt: call.completedAt?.toISOString() ?? null,
          turns: (call.transcript as { at: number | null; speaker: string; text: string }[] | null) ?? [],
        }}
      />
    </AppShell>
  );
}
