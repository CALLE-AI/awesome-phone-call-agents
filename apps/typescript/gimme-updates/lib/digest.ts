import { randomUUID } from "crypto";

import { and, eq, inArray } from "drizzle-orm";

import {
  callLogs,
  db,
  emails,
  reminders,
  type CallLog,
  type Email,
  type User,
} from "@/db";
import {
  CALLE_DRY_RUN,
  isCalleResultResolved,
  runDigestCall,
  type DigestAction,
  type DigestCallResult,
} from "@/lib/calle";

const URGENCY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

const STATUS_BY_ACTION: Record<DigestAction, string> = {
  none: "resolved",
  remind: "reminder_scheduled",
  followup: "followup_in_progress",
};

export interface DigestRunResult {
  call: DigestCallResult;
  callLog: CallLog;
  emails: Email[];
  unresolved: boolean;
}

export interface PublicDigestEmail {
  id: string;
  sender: string;
  subject: string;
  decision: string | null;
  decisionDetail: string | null;
  status: string;
}

/**
 * Client-safe digest payload: no full CALL-E result, transcript, evidence,
 * or call-log row. Phone numbers never belong in this response (the digest
 * is keyed by userId).
 */
export interface PublicDigestResult {
  call: {
    id: string | null;
    status: string;
    taskCompleted: boolean | null;
    dryRun: boolean;
  };
  emails: PublicDigestEmail[];
  unresolved: boolean;
}

export function toPublicDigestResult(result: DigestRunResult): PublicDigestResult {
  return {
    call: {
      id: result.call.id,
      status: result.call.status,
      taskCompleted: result.call.taskCompleted,
      dryRun: CALLE_DRY_RUN,
    },
    emails: result.emails.map((email) => ({
      id: email.id,
      sender: email.sender,
      subject: email.subject,
      decision: email.decision,
      decisionDetail: email.decisionDetail,
      status: email.status,
    })),
    unresolved: result.unresolved,
  };
}

export type DigestSkipReason = "no_pending_emails" | "rate_limited";

export interface DigestSkipped {
  skipped: true;
  reason: DigestSkipReason;
}

/**
 * A callLog counts as a "real" completed call (i.e. one that actually
 * reached CALL-E and finished) only if its status is "completed" AND it
 * isn't one of our dry-run placeholders (calleCallId starting with
 * "dry-run-", see lib/calle.ts). Failed real-call attempts — like the one
 * caused by the resultSchema bug — must NOT count against the limit, since
 * the user never actually received a working call.
 */
function isCompletedRealCall(log: CallLog): boolean {
  return (
    log.status === "completed" &&
    !!log.calleCallId &&
    !log.calleCallId.startsWith("dry-run-")
  );
}

async function hasCompletedRealCall(userId: string): Promise<boolean> {
  const existingLogs = await db.query.callLogs.findMany({
    where: eq(callLogs.userId, userId),
  });
  return existingLogs.some(isCompletedRealCall);
}

/**
 * Decides when a "remind" decision's reminder should fire:
 * 1. CALL-E's reminderDate, if it provided one (and it parses as a date).
 * 2. One day before the email's dueDate, if the email has one — a more
 *    contextually useful default than a flat offset.
 * 3. Otherwise, 24 hours from now.
 */
function computeRemindAt(
  reminderDate: string | null | undefined,
  dueDate: Date | null
): Date {
  if (reminderDate) {
    const parsed = new Date(reminderDate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (dueDate) {
    return new Date(dueDate.getTime() - 24 * 60 * 60 * 1000);
  }

  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

/**
 * Runs a digest call for a single user: gathers their pending emails, places
 * (or simulates, in dry-run mode) the CALL-E call, logs the result, and
 * applies the resulting per-email decisions.
 *
 * Returns a `DigestSkipped` descriptor instead of running anything when:
 * - the user has no pending emails ("no_pending_emails"), or
 * - this would be a real (non-dry-run) call and the user already has a
 *   completed real call on record ("rate_limited") — this protects our
 *   limited CALL-E call credits; it only ever applies to real calls, never
 *   to dry runs.
 *
 * If the CALL-E result is failed or ambiguous, pending emails are marked
 * "unresolved" instead of left "pending", so the next cron tick will not
 * silently retry them. Reminders created while fake/dry-run mode is active
 * are stored with isSimulated=true.
 *
 * Shared by app/api/calle/digest/route.ts and app/api/cron/route.ts.
 */
export async function runDigestForUser(
  user: User
): Promise<DigestRunResult | DigestSkipped> {
  const pendingEmails = await db.query.emails.findMany({
    where: and(eq(emails.userId, user.id), eq(emails.status, "pending")),
  });

  if (pendingEmails.length === 0) {
    return { skipped: true, reason: "no_pending_emails" };
  }

  if (!CALLE_DRY_RUN && (await hasCompletedRealCall(user.id))) {
    return { skipped: true, reason: "rate_limited" };
  }

  const sortedPendingEmails = [...pendingEmails].sort(
    (a, b) =>
      (URGENCY_ORDER[a.urgency ?? ""] ?? Number.MAX_SAFE_INTEGER) -
      (URGENCY_ORDER[b.urgency ?? ""] ?? Number.MAX_SAFE_INTEGER)
  );

  const digestEmails = sortedPendingEmails.map((email) => ({
    id: email.id,
    sender: email.sender,
    subject: email.subject,
    summary: email.summary ?? email.subject,
    category: email.category ?? "other",
    urgency: email.urgency ?? "low",
    dueDate: email.dueDate ? email.dueDate.toISOString() : null,
  }));

  // Needed below to compute a reminder's remindAt fallback from the
  // email's dueDate (see computeRemindAt).
  const dueDateByEmailId = new Map(
    sortedPendingEmails.map((email) => [email.id, email.dueDate])
  );

  const pendingEmailIds = sortedPendingEmails.map((email) => email.id);

  let call: DigestCallResult;
  try {
    call = await runDigestCall(user.phoneNumber, digestEmails);
  } catch (error) {
    console.error("[digest] runDigestCall failed:", error);
    call = {
      id: null,
      status: "failed",
      taskCompleted: false,
      structuredResult: null,
      evidence: [
        error instanceof Error ? error.message : "Unknown error placing call",
      ],
    };
  }

  const decisions = call.structuredResult?.decisions;
  const unresolved =
    !isCalleResultResolved(call) ||
    !Array.isArray(decisions) ||
    decisions.length === 0;

  const [callLog] = await db
    .insert(callLogs)
    .values({
      id: randomUUID(),
      userId: user.id,
      callType: "digest",
      calleCallId: call.id,
      status: unresolved && call.status === "completed" ? "unresolved" : call.status,
      // Persist a compact outcome, not the full CALL-E payload/transcript.
      structuredResult: unresolved
        ? JSON.stringify({
            unresolved: true,
            callStatus: call.status,
            taskCompleted: call.taskCompleted,
            decisionCount: call.structuredResult?.decisions?.length ?? 0,
          })
        : JSON.stringify({
            decisions: (decisions ?? []).map((decision) => ({
              emailId: decision.emailId,
              action: decision.action,
            })),
          }),
    })
    .returning();

  if (unresolved) {
    console.log("[digest] marking emails unresolved; will not auto-retry", {
      userId: user.id,
      emailCount: pendingEmailIds.length,
      callStatus: call.status,
      taskCompleted: call.taskCompleted,
    });

    const unresolvedEmails = await db
      .update(emails)
      .set({ status: "unresolved" })
      .where(inArray(emails.id, pendingEmailIds))
      .returning();

    return {
      call,
      callLog,
      emails: unresolvedEmails,
      unresolved: true,
    };
  }

  const appliedDecisions = call.structuredResult?.decisions ?? [];

  const updatedEmails = await Promise.all(
    appliedDecisions.map(async (decision) => {
      // reminderDate/followupInstruction are optional (not required) in
      // RESULT_SCHEMA, so CALL-E may omit them entirely rather than sending
      // null — normalize missing/undefined to null here so DB writes are
      // consistent either way.
      const decisionDetail =
        decision.action === "remind"
          ? decision.reminderDate ?? null
          : decision.action === "followup"
            ? decision.followupInstruction ?? null
            : null;

      const [updated] = await db
        .update(emails)
        .set({
          decision: decision.action,
          decisionDetail,
          status: STATUS_BY_ACTION[decision.action] ?? "pending",
        })
        .where(eq(emails.id, decision.emailId))
        .returning();

      if (decision.action === "remind") {
        const dueDate = dueDateByEmailId.get(decision.emailId) ?? null;
        await db.insert(reminders).values({
          id: randomUUID(),
          userId: user.id,
          emailId: decision.emailId,
          remindAt: computeRemindAt(decision.reminderDate, dueDate),
          fired: false,
          isSimulated: CALLE_DRY_RUN,
          status: "pending",
        });
      }
      // action === "followup" is left as-is for now (no reminders row).

      return updated;
    })
  );

  const decidedIds = new Set(appliedDecisions.map((decision) => decision.emailId));
  const leftoverIds = pendingEmailIds.filter((id) => !decidedIds.has(id));
  if (leftoverIds.length > 0) {
    await db
      .update(emails)
      .set({ status: "unresolved" })
      .where(inArray(emails.id, leftoverIds));
  }

  return {
    call,
    callLog,
    emails: updatedEmails.filter((email): email is Email => email != null),
    unresolved: false,
  };
}
