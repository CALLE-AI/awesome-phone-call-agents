import "server-only";

import { and, asc, eq, isNull, lte, ne, or } from "drizzle-orm";

import type { SafeCallExecution } from "@/lib/calle/client";
import type { PreparedCampaignCall } from "@/lib/campaigns/lifecycle";
import type { ParsedWebhookEvent } from "@/lib/calle/webhook-event";
import { dispatchClaimAction, type DispatchClaimAction } from "@/lib/campaigns/dispatch-state";
import type { CallStatus, CampaignStatus } from "@/types/campaign";
import {
  publicProviderFailureMessage,
  sanitizeDisplayError,
  sanitizeFailureCode,
  sanitizeResultData,
  sanitizeSummary,
  sanitizeTranscript,
} from "@/lib/privacy/redaction";

import { getDb } from "./client";
import { callResults, campaigns, processedWebhookEvents } from "./schema";

const TERMINAL = new Set<CallStatus>([
  "completed",
  "failed",
  "canceled",
  "no_answer",
  "result_validation_failed",
  "submission_uncertain",
]);

function qualified(result: Record<string, unknown> | null): boolean | null {
  return typeof result?.qualified === "boolean" ? result.qualified : null;
}

function executionStatus(status: string): CallStatus {
  if (["queued", "in_progress", "completed", "failed", "canceled"].includes(status)) {
    return status as CallStatus;
  }
  return "queued";
}

const RECONCILIATION_MESSAGE =
  "Dispatch paused because CALL-E may have accepted a call. Reconcile it in the provider dashboard before taking further action.";
const PAUSED_CALL_MESSAGE =
  "The call was not submitted because an earlier campaign submission requires reconciliation.";

async function cancelPendingCallsTx(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  campaignId: string,
): Promise<void> {
  await tx
    .update(callResults)
    .set({
      status: "canceled",
      failureCode: "campaign_paused",
      failureMessage: PAUSED_CALL_MESSAGE,
      completedAt: new Date(),
    })
    .where(and(eq(callResults.campaignId, campaignId), eq(callResults.status, "pending")));
}

async function refreshCampaignStatusTx(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  campaignId: string,
): Promise<CampaignStatus> {
  const [campaign] = await tx
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (campaign?.status === "reconciliation_required") return "reconciliation_required";
  const rows = await tx
    .select({ status: callResults.status })
    .from(callResults)
    .where(eq(callResults.campaignId, campaignId));
  const statuses = rows.map((row) => row.status as CallStatus);
  const allTerminal = statuses.length > 0 && statuses.every((status) => TERMINAL.has(status));
  const allFailed = allTerminal && statuses.every((status) => status !== "completed");
  const status: CampaignStatus = allTerminal ? (allFailed ? "failed" : "completed") : "launched";
  await tx.update(campaigns).set({ status }).where(eq(campaigns.id, campaignId));
  return status;
}

/**
 * The lifecycle writer intentionally uses the owner database role because call_results
 * are read-only under browser RLS. Every launch mutation re-checks campaign ownership
 * and changes only validated, server-compiled rows.
 */
export async function reserveCampaignRuns(params: {
  userId: string;
  campaignId: string;
  calls: PreparedCampaignCall[];
  fromStatus?: "compiled" | "scheduled";
}): Promise<"reserved" | "already_launched"> {
  return getDb().transaction(async (tx) => {
    const now = new Date();
    const [claimed] = await tx
      .update(campaigns)
      .set({ status: "launching", launchedAt: now })
      .where(
        and(
          eq(campaigns.id, params.campaignId),
          eq(campaigns.userId, params.userId),
          eq(campaigns.status, params.fromStatus ?? "compiled"),
        ),
      )
      .returning({ id: campaigns.id });
    if (!claimed) {
      const [existing] = await tx
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(and(eq(campaigns.id, params.campaignId), eq(campaigns.userId, params.userId)))
        .limit(1);
      if (existing && existing.status !== (params.fromStatus ?? "compiled")) {
        return "already_launched";
      }
      throw new Error("Campaign is not available for launch");
    }

    await tx.insert(callResults).values(
      params.calls.map((call) => ({
        id: call.callResultId,
        campaignId: params.campaignId,
        contactId: call.contact.id,
        idempotencyKey: call.preview.idempotencyKey,
        approvalDigest: call.preview.approvalDigest,
        compiledRequest: sanitizeResultData(call.draft),
        status: "pending",
        createdAt: now,
      })),
    );
    return "reserved";
  });
}

export async function claimCallDispatch(params: {
  userId: string;
  campaignId: string;
  callResultId: string;
  contactId: string;
  approvalDigest: string;
  idempotencyKey: string;
}): Promise<DispatchClaimAction> {
  return getDb().transaction(async (tx) => {
    const [campaign] = await tx
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(and(eq(campaigns.id, params.campaignId), eq(campaigns.userId, params.userId)))
      .for("update")
      .limit(1);
    if (!campaign) throw new Error("Campaign is unavailable for dispatch");

    const [call] = await tx
      .select({
        status: callResults.status,
        contactId: callResults.contactId,
        approvalDigest: callResults.approvalDigest,
        idempotencyKey: callResults.idempotencyKey,
      })
      .from(callResults)
      .where(
        and(
          eq(callResults.id, params.callResultId),
          eq(callResults.campaignId, params.campaignId),
        ),
      )
      .limit(1);
    if (!call) throw new Error("Call run is unavailable for dispatch");
    if (
      params.contactId !== call.contactId ||
      params.approvalDigest !== call.approvalDigest ||
      params.idempotencyKey !== call.idempotencyKey
    ) {
      await tx
        .update(callResults)
        .set({
          status: "failed",
          failureCode: "queue_job_mismatch",
          failureMessage: "The queued call did not match its reserved approval.",
          completedAt: new Date(),
        })
        .where(
          and(
            eq(callResults.id, params.callResultId),
            eq(callResults.campaignId, params.campaignId),
            eq(callResults.status, "pending"),
          ),
        );
      await refreshCampaignStatusTx(tx, params.campaignId);
      return "skip";
    }

    const [anotherSubmitting] =
      call.status === "pending"
        ? await tx
            .select({ id: callResults.id })
            .from(callResults)
            .where(
              and(
                eq(callResults.campaignId, params.campaignId),
                eq(callResults.status, "submitting"),
                ne(callResults.id, params.callResultId),
              ),
            )
            .limit(1)
        : [];
    const action = dispatchClaimAction({
      campaignStatus: campaign.status,
      callStatus: call.status,
      anotherCallSubmitting: Boolean(anotherSubmitting),
    });

    if (action === "claim") {
      const [claimed] = await tx
        .update(callResults)
        .set({ status: "submitting", startedAt: new Date() })
        .where(
          and(
            eq(callResults.id, params.callResultId),
            eq(callResults.campaignId, params.campaignId),
            eq(callResults.status, "pending"),
          ),
        )
        .returning({ id: callResults.id });
      return claimed ? "claim" : "defer";
    }

    // A redelivered job whose own row is still "submitting" crossed the unsafe
    // provider-acceptance/checkpoint gap. Never call create again: quarantine the
    // run and stop every later contact in this campaign.
    if (action === "require_reconciliation" && call.status === "submitting") {
      await tx
        .update(callResults)
        .set({
          status: "submission_uncertain",
          failureCode: "submission_checkpoint_missing",
          failureMessage: publicProviderFailureMessage(),
          completedAt: new Date(),
        })
        .where(
          and(
            eq(callResults.id, params.callResultId),
            eq(callResults.campaignId, params.campaignId),
            eq(callResults.status, "submitting"),
          ),
        );
      await tx
        .update(campaigns)
        .set({ status: "reconciliation_required", failureMessage: RECONCILIATION_MESSAGE })
        .where(eq(campaigns.id, params.campaignId));
      await cancelPendingCallsTx(tx, params.campaignId);
    }
    return action;
  });
}

export async function pauseCampaignForReconciliation(params: {
  userId: string;
  campaignId: string;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [campaign] = await tx
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.id, params.campaignId), eq(campaigns.userId, params.userId)))
      .for("update")
      .limit(1);
    if (!campaign) throw new Error("Campaign is unavailable for reconciliation");
    await tx
      .update(campaigns)
      .set({ status: "reconciliation_required", failureMessage: RECONCILIATION_MESSAGE })
      .where(
        and(
          eq(campaigns.id, params.campaignId),
          or(eq(campaigns.status, "launching"), eq(campaigns.status, "launched")),
        ),
      );
    await cancelPendingCallsTx(tx, params.campaignId);
  });
}

export async function scheduleCampaign(params: {
  userId: string;
  campaignId: string;
  scheduledAt: Date;
  approvalDigest: string;
}): Promise<"scheduled" | "already_launched"> {
  const [claimed] = await getDb()
    .update(campaigns)
    .set({
      status: "scheduled",
      scheduledAt: params.scheduledAt,
      approvedAt: new Date(),
      approvalDigest: params.approvalDigest,
    })
    .where(
      and(
        eq(campaigns.id, params.campaignId),
        eq(campaigns.userId, params.userId),
        eq(campaigns.status, "compiled"),
      ),
    )
    .returning({ id: campaigns.id });
  return claimed ? "scheduled" : "already_launched";
}

export async function dueScheduledCampaigns(limit = 5): Promise<
  Array<{ id: string; userId: string; approvalDigest: string }>
> {
  const rows = await getDb()
    .select({
      id: campaigns.id,
      userId: campaigns.userId,
      approvalDigest: campaigns.approvalDigest,
    })
    .from(campaigns)
    .where(and(eq(campaigns.status, "scheduled"), lte(campaigns.scheduledAt, new Date())))
    .orderBy(asc(campaigns.scheduledAt), asc(campaigns.id))
    .limit(Math.max(1, Math.min(limit, 10)));

  return rows.flatMap((row) =>
    row.approvalDigest ? [{ ...row, approvalDigest: row.approvalDigest }] : [],
  );
}

export async function failScheduledCampaign(params: {
  campaignId: string;
  message?: string;
}): Promise<void> {
  await getDb()
    .update(campaigns)
    .set({
      status: "failed",
      failureMessage:
        sanitizeDisplayError(params.message) ?? "Scheduled dispatch stopped safely before calling.",
    })
    .where(and(eq(campaigns.id, params.campaignId), eq(campaigns.status, "scheduled")));
}

export async function recordCallSubmission(params: {
  campaignId: string;
  callResultId: string;
  execution: SafeCallExecution;
}): Promise<void> {
  const status = executionStatus(params.execution.status);
  const completedAt = TERMINAL.has(status) ? new Date() : null;
  const capturedData = sanitizeResultData(params.execution.structuredResult);
  await getDb().transaction(async (tx) => {
    await tx
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.id, params.campaignId))
      .for("update")
      .limit(1);
    await tx
      .update(callResults)
      .set({
        calleCallId: params.execution.callId,
        status,
        capturedData,
        qualified:
          params.execution.qualified !== undefined
            ? params.execution.qualified
            : qualified(capturedData),
        summary: sanitizeSummary(params.execution.summary),
        transcript: sanitizeTranscript(params.execution.transcript),
        startedAt: new Date(),
        completedAt,
      })
      .where(
        and(
          eq(callResults.id, params.callResultId),
          eq(callResults.campaignId, params.campaignId),
          eq(callResults.status, "submitting"),
        ),
      );
    await refreshCampaignStatusTx(tx, params.campaignId);
  });
}

export async function recordSubmissionFailure(params: {
  campaignId: string;
  callResultId: string;
  /** Defaults to a generic submission error; pass a more specific code when known. */
  code?: string;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.id, params.campaignId))
      .for("update")
      .limit(1);
    await tx
      .update(callResults)
      .set({
        status: "submission_uncertain",
        failureCode: params.code ?? "submission_error",
        failureMessage: publicProviderFailureMessage(),
        completedAt: new Date(),
      })
      .where(
        and(
          eq(callResults.id, params.callResultId),
          eq(callResults.campaignId, params.campaignId),
          eq(callResults.status, "submitting"),
        ),
      );
    await tx
      .update(campaigns)
      .set({ status: "reconciliation_required", failureMessage: RECONCILIATION_MESSAGE })
      .where(eq(campaigns.id, params.campaignId));
    await cancelPendingCallsTx(tx, params.campaignId);
  });
}

export async function recordPreSubmissionFailure(params: {
  campaignId: string;
  callResultId: string;
  code: "authorization_error" | "configuration_error";
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.id, params.campaignId))
      .for("update")
      .limit(1);
    await tx
      .update(callResults)
      .set({
        status: "failed",
        failureCode: params.code,
        failureMessage: "The call was stopped before submission by a safety check.",
        completedAt: new Date(),
      })
      .where(
        and(
          eq(callResults.id, params.callResultId),
          eq(callResults.campaignId, params.campaignId),
          or(eq(callResults.status, "pending"), eq(callResults.status, "submitting")),
        ),
      );
    await refreshCampaignStatusTx(tx, params.campaignId);
  });
}

export async function recordWebhookEvent(
  event: ParsedWebhookEvent,
): Promise<"processed" | "duplicate"> {
  const capturedData = sanitizeResultData(event.call.capturedData);
  return getDb().transaction(async (tx) => {
    const [inserted] = await tx
      .insert(processedWebhookEvents)
      .values({ eventId: event.id, eventType: event.type })
      .onConflictDoNothing()
      .returning({ eventId: processedWebhookEvents.eventId });
    if (!inserted) return "duplicate";

    await tx
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.id, event.call.campaignId))
      .for("update")
      .limit(1);

    const [updated] = await tx
      .update(callResults)
      .set({
        calleCallId: event.call.id,
        qualified: event.call.qualified,
        capturedData,
        summary: sanitizeSummary(event.call.summary),
        transcript: sanitizeTranscript(event.call.transcript),
        status: event.call.status,
        failureCode: sanitizeFailureCode(event.call.failureCode),
        failureMessage: event.call.failureMessage ? publicProviderFailureMessage() : null,
        completedAt: event.call.completedAt,
      })
      .where(
        and(
          eq(callResults.id, event.call.callResultId),
          eq(callResults.campaignId, event.call.campaignId),
          eq(callResults.contactId, event.call.contactId),
          or(isNull(callResults.calleCallId), eq(callResults.calleCallId, event.call.id)),
        ),
      )
      .returning({ id: callResults.id });
    if (!updated) throw new Error("Webhook does not match a known Veyra call run");
    await refreshCampaignStatusTx(tx, event.call.campaignId);
    return "processed";
  });
}
