import "server-only";

import { assertLiveOperatorUser } from "@/lib/auth/live-access";
import { LiveAccessError } from "@/lib/auth/live-policy";
import { assertApprovedCallReady, CallConfigurationError, executeApprovedCall } from "@/lib/calle/client";
import { createCallPreview, type SafeCallPreview } from "@/lib/calle/safety";
import type { PreparedCampaignCall, PreparedCampaignLaunch } from "@/lib/campaigns/lifecycle";
import {
  claimCallDispatch,
  pauseCampaignForReconciliation,
  recordCallSubmission,
  recordPreSubmissionFailure,
  recordSubmissionFailure,
  reserveCampaignRuns,
} from "@/lib/db/call-lifecycle";
import { publishCallDispatch } from "@/lib/queue/rabbitmq";

export interface CallDispatchJob {
  userId: string;
  campaignId: string;
  call: PreparedCampaignCall;
}

export type CallDispatchOutcome =
  | "processed"
  | "deferred"
  | "skipped"
  | "reconciliation_required";

/**
 * Guards processCallDispatchJob against a message that isn't actually a CallDispatchJob
 * (a stray test publish, a future producer sending an incompatible shape, corrupted
 * JSON that still parses). Without this, `job.call` being undefined makes both the
 * execution attempt *and* the catch block's own error-reporting throw — a confusing
 * double-fault — since the catch block also reads `call.callResultId` to report what
 * failed. Reject cleanly here instead, before any of that runs.
 */
export function isCallDispatchJob(value: unknown): value is CallDispatchJob {
  if (typeof value !== "object" || value === null) return false;
  const job = value as Record<string, unknown>;
  if (typeof job.userId !== "string") return false;
  if (typeof job.campaignId !== "string") return false;
  if (typeof job.call !== "object" || job.call === null) return false;
  const call = job.call as Record<string, unknown>;
  return (
    typeof call.callResultId === "string" &&
    typeof call.draft === "object" &&
    call.draft !== null &&
    typeof call.preview === "object" &&
    call.preview !== null &&
    typeof call.contact === "object" &&
    call.contact !== null
  );
}

export async function dispatchPreparedCampaign(params: {
  userId: string;
  campaignId: string;
  prepared: PreparedCampaignLaunch;
  fromStatus?: "compiled" | "scheduled";
}): Promise<{ status: "submitted" | "already_launched" }> {
  await assertLiveOperatorUser(params.userId, params.prepared.preview.mode);
  for (const call of params.prepared.calls) {
    assertApprovedCallReady(call.draft, call.preview);
  }

  const reservation = await reserveCampaignRuns({
    userId: params.userId,
    campaignId: params.campaignId,
    calls: params.prepared.calls,
    fromStatus: params.fromStatus,
  });
  if (reservation === "already_launched") {
    return { status: "already_launched" };
  }

  // Fake mode completes locally so a safe demo needs neither RabbitMQ nor a worker. Live
  // execution stays off the request path — one queued job per call, picked up by the
  // standalone worker in scripts/dispatch-worker.ts.
  if (params.prepared.preview.mode === "fake") {
    for (const call of params.prepared.calls) {
      await processCallDispatchJob({
        userId: params.userId,
        campaignId: params.campaignId,
        call,
      });
    }
  } else {
    try {
      for (const call of params.prepared.calls) {
        const job = {
          userId: params.userId,
          campaignId: params.campaignId,
          call,
        } satisfies CallDispatchJob;
        await publishCallDispatch(job);
      }
    } catch {
      // A confirm-channel failure cannot prove whether the broker accepted the job.
      // Quarantine the batch so already-published work cannot continue unnoticed.
      await pauseCampaignForReconciliation({
        userId: params.userId,
        campaignId: params.campaignId,
      });
      throw new CallConfigurationError(
        "Campaign dispatch was paused because queue delivery could not be confirmed",
      );
    }
  }

  return { status: "submitted" };
}

/**
 * Runs exactly one queued call. Called by the RabbitMQ worker (scripts/dispatch-worker.ts)
 * per consumed message — this is the same body that used to run inline in the dispatch
 * loop above before dispatch moved to a queue, unchanged in behavior.
 */
export async function processCallDispatchJob(job: CallDispatchJob): Promise<CallDispatchOutcome> {
  const { userId, campaignId, call } = job;
  let verifiedPreview: SafeCallPreview;

  try {
    await assertLiveOperatorUser(userId, call.preview.mode);
    verifiedPreview = await createCallPreview(userId, call.draft, call.preview.mode);
    if (
      verifiedPreview.approvalDigest !== call.preview.approvalDigest ||
      verifiedPreview.idempotencyKey !== call.preview.idempotencyKey
    ) {
      throw new CallConfigurationError("Queued call approval does not match its contents");
    }
    assertApprovedCallReady(call.draft, verifiedPreview);
  } catch (error) {
    if (!(error instanceof LiveAccessError) && !(error instanceof CallConfigurationError)) {
      throw error;
    }
    await recordPreSubmissionFailure({
      campaignId,
      callResultId: call.callResultId,
      code: error instanceof LiveAccessError ? "authorization_error" : "configuration_error",
    });
    return "processed";
  }

  const claim = await claimCallDispatch({
    userId,
    campaignId,
    callResultId: call.callResultId,
    contactId: call.contact.id,
    approvalDigest: verifiedPreview.approvalDigest,
    idempotencyKey: verifiedPreview.idempotencyKey,
  });
  if (claim === "defer") return "deferred";
  if (claim === "require_reconciliation") return "reconciliation_required";
  if (claim === "skip") return "skipped";

  try {
    const execution = await executeApprovedCall(call.draft, verifiedPreview);
    await recordCallSubmission({ campaignId, callResultId: call.callResultId, execution });
    return "processed";
  } catch {
    console.error(
      `[dispatch] call submission failed campaignId=${campaignId} ` +
        `callResultId=${call.callResultId} category=provider_submission`,
    );
    if (call.preview.mode === "fake") {
      await recordPreSubmissionFailure({
        campaignId,
        callResultId: call.callResultId,
        code: "configuration_error",
      });
      return "processed";
    }
    await recordSubmissionFailure({ campaignId, callResultId: call.callResultId });
    return "reconciliation_required";
  }
}
