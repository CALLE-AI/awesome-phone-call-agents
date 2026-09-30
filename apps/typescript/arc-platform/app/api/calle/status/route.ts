import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { calleGetCall } from "@/lib/calle";
import { scoreRow, type CallTarget, type CampaignContext } from "@/lib/calle-media";
import { getOrCreateBrand } from "@/lib/brand";
import { applyResultToItem, persistCompletedCall, persistFailedCall, persistUnfinishedCall } from "@/lib/calls";
import { withJson } from "@/lib/api-json";
import { deepMaskPhones } from "@/lib/mask";

export const maxDuration = 30;

/**
 * Poll one call. The client sends the callId plus the original target + context
 * (so we can score the result). Returns:
 *   { done:false, status }                       — still running
 *   { done:true, failed:true, status, summary }  — terminal but not completed
 *   { done:true, failed:false, row }             — completed, scored media-plan row
 */
export const POST = withJson(async (req: NextRequest) => {
  try {
    /* Inside the try: an auth() that throws here used to escape the handler
       entirely, and the poll loop showed the user a JSON parse error. */
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { callId, target, context, finalize } = (await req.json()) as {
      callId: string;
      target: CallTarget;
      context: CampaignContext;
      /** The client has stopped polling. Record what is known rather than
       *  letting the call vanish - see persistUnfinishedCall. */
      finalize?: boolean;
    };
    if (!callId) return NextResponse.json({ error: "Missing callId" }, { status: 400 });

    const state = await calleGetCall(callId);
    if (!state.done) {
      if (finalize) {
        const brand = await getOrCreateBrand(userId);
        await persistUnfinishedCall({
          brandId: brand.id,
          calleCallId: callId,
          target,
          status: state.status,
          /* No confidence or evidence: the call has not finished, so CALL-E
             has not judged it. An empty verdict stored now would be
             indistinguishable from one it made and had nothing to say about.
             The reconcile sweep fills them in when the call settles. */
          dialedPhone: state.phone,
        });
      }
      return NextResponse.json({ done: false, status: state.status, recorded: Boolean(finalize) });
    }
    /* Everything below is a terminal state, so the call is recorded before
       the response goes back. This route only ever runs for a real call - the
       simulated path returns from /confirm and never polls - so mock is
       false here as a fact, not an inference. */
    const brand = await getOrCreateBrand(userId);

    if (state.failed || !state.structuredResult) {
      // A call that settled nothing confirms nothing: every result field on
      // the row stays null rather than falling back to an estimate.
      await persistFailedCall({
        brandId: brand.id,
        calleCallId: callId,
        target,
        status: state.status,
        summary: state.summary,
        mock: false,
        /* Connected means someone was actually there. CALL-E reports some
           calls as "completed" with zero connected seconds and an empty
           transcript; those never reached anyone, so they are NOT_CONNECTED
           whatever the status string says. Our data should not inherit that
           inconsistency. */
        connected: state.status === "completed" && state.transcriptTurns > 0,
        confidenceScore: state.confidence?.score ?? null,
        confidenceLabel: state.confidence?.label ?? null,
        evidence: state.evidence,
        turns: state.turns,
        dialedPhone: state.phone,
        completedAt: state.completedAt ? new Date(state.completedAt) : null,
      });
      return NextResponse.json({
        done: true,
        failed: true,
        status: state.status,
        summary: state.summary,
        /* CALL-E's own reason, not our "NOT_CONNECTED" label. The card said
           the same sentence for a busy line, a wrong number and a route the
           carrier refused; those need three different actions. */
        failure: state.failure,
      });
    }

    const row = scoreRow(context ?? {}, target, state.structuredResult);
    row.summary = state.summary ?? "";
    row.mock = false;
    /* CALL-E's own read on the call, carried through rather than discarded.
       Its evidence array named the exact defect behind a wrong rate on
       a creator call and nothing was reading it. */
    row.confidenceLabel = state.confidence?.label ?? "";
    row.evidence = state.evidence;

    const saved = await persistCompletedCall({
      brandId: brand.id,
      calleCallId: callId,
      target,
      row,
      status: state.status,
      mock: false,
      structuredResult: state.structuredResult,
      dialedPhone: state.phone,
      completedAt: state.completedAt ? new Date(state.completedAt) : null,
    });

    /* The call already knows its line when it came from a campaign, so the
       result goes straight onto it - no name matching, no time window. */
    if (saved?.mediaPlanItemId) await applyResultToItem(saved.mediaPlanItemId, saved.id);

    return NextResponse.json({ done: true, failed: false, status: state.status, row });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("CALL-E status error:", deepMaskPhones(message));
    return NextResponse.json({ error: message || "Status check failed" }, { status: 500 });
  }
});
