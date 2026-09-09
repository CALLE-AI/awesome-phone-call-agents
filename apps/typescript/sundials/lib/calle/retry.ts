import { AMBIGUOUS_OUTCOME_REASON, HACKATHON_RETRY_LOCKED } from "./retry-lock.ts";
import { brainCallDirectives, getBrainConfigForAccount, retryDelayHoursOrSkip } from "../brain/config.ts";
import { newEntityId } from "../ids.ts";
import { isMissedPickup } from "../intent/opportunity.ts";
import type { BrainConfig, SundialCallRecord } from "../types.ts";
import { validatePhoneNumber, sameE164 } from "./security.ts";
import { dispatchLiveCalleCall, liveCalleCreateInput, type LiveCallContext } from "./live-binding.ts";
import { isInFlightStatus } from "./sync-live.ts";

export type RetryStore = {
  saveCall(call: SundialCallRecord, options?: { skipRetryHooks?: boolean }): void;
  getCall(id: string): SundialCallRecord | undefined;
  peekCalls(): SundialCallRecord[];
};

export function isQueuedRetry(call: SundialCallRecord): boolean {
  return call.status === "queued" && Boolean(call.retryOfCallId);
}

export function isRetryRecord(call: SundialCallRecord): boolean {
  return Boolean(call.retryOfCallId) || (call.retryCount ?? 0) >= 1;
}

export { brainCallDirectives };

export function liveContextForCall(call: SundialCallRecord, brain: BrainConfig): LiveCallContext {
  return {
    company: call.company,
    useCase: call.useCase,
    companySize: call.companySize,
    declaredCta: call.declaredCta,
    declaredInterest: call.declaredInterest,
    intent: call.intentSnapshot,
    ...brainCallDirectives(brain)
  };
}

/** Loads current Brain at call time — not a snapshot from the first dial. */
export function liveCreateInputForRecord(call: SundialCallRecord) {
  const phone = call.rawPhoneNumber;
  if (!phone) return null;
  const accountId = call.session.accountId || "harbor";
  const brain = getBrainConfigForAccount(accountId);
  return liveCalleCreateInput(
    phone,
    call.session,
    call.contactName,
    call.rawContactEmail,
    liveContextForCall(call, brain)
  );
}

function isDisqualifiedCall(call: SundialCallRecord): boolean {
  return (
    call.opportunityProfile?.priority === "disqualified" || call.leadDossier?.intentTier === "disqualified"
  );
}

function visitorIsDisqualified(store: RetryStore, visitorId?: string): boolean {
  if (!visitorId) return false;
  return store.peekCalls().some((call) => call.visitorId === visitorId && isDisqualifiedCall(call));
}

function visitorHasCompletedConversation(store: RetryStore, visitorId: string, exceptCallId: string): boolean {
  return store
    .peekCalls()
    .some((call) => call.visitorId === visitorId && call.id !== exceptCallId && call.status === "completed");
}

function existingRetryForParent(calls: SundialCallRecord[], parentId: string): SundialCallRecord | undefined {
  return calls.find((call) => call.retryOfCallId === parentId);
}

function queuedRetryForVisitor(calls: SundialCallRecord[], visitorId: string): SundialCallRecord | undefined {
  return calls.find((call) => call.visitorId === visitorId && isQueuedRetry(call));
}

function isLiveCalle(): boolean {
  return Boolean(process.env.CALLE_API_KEY) && process.env.CALLE_LIVE === "true";
}

export function isRetryEligibleFailure(call: SundialCallRecord): boolean {
  if (HACKATHON_RETRY_LOCKED) return false;
  if (isRetryRecord(call)) return false;
  if (call.retryScheduledAt) return false;
  if (isDisqualifiedCall(call)) return false;
  if (!call.rawPhoneNumber) return false;
  if (call.callConsentAllowOneRetry !== true) return false;
  if (!sameE164(call.callConsentE164, call.rawPhoneNumber)) return false;
  return isMissedPickup(call);
}

export function markAmbiguousProviderOutcome(
  store: RetryStore,
  call: SundialCallRecord
): SundialCallRecord | undefined {
  if (!isMissedPickup(call) || call.needsReconciliation) return undefined;
  call.needsReconciliation = true;
  call.errorReason = call.errorReason || AMBIGUOUS_OUTCOME_REASON;
  store.saveCall(call, { skipRetryHooks: true });
  return call;
}

function cancelRetry(store: RetryStore, retry: SundialCallRecord, reason: string): void {
  if (retry.status !== "queued") return;
  retry.status = "failed";
  retry.errorReason = `Retry cancelled: ${reason}`;
  retry.retryCancelReason = reason;
  retry.endedAt = new Date().toISOString();
  store.saveCall(retry);
}

export function cancelPendingRetriesForVisitor(
  store: RetryStore,
  visitorId: string | undefined,
  exceptCallId: string,
  reason: string
): void {
  if (!visitorId) return;
  for (const call of store.peekCalls()) {
    if (call.id === exceptCallId) continue;
    if (call.visitorId !== visitorId) continue;
    if (!isQueuedRetry(call)) continue;
    cancelRetry(store, call, reason);
  }
}

function enqueueRetry(store: RetryStore, parent: SundialCallRecord, delayHours: number): SundialCallRecord {
  const now = new Date();
  const due = new Date(now.getTime() + delayHours * 3_600_000);
  const scheduledAt = now.toISOString();
  const retryDueAt = due.toISOString();
  const retry: SundialCallRecord = {
    id: newEntityId(),
    sessionId: parent.sessionId,
    visitorId: parent.visitorId,
    phoneNumber: parent.phoneNumber,
    rawPhoneNumber: parent.rawPhoneNumber,
    contactEmail: parent.contactEmail,
    rawContactEmail: parent.rawContactEmail,
    contactName: parent.contactName,
    company: parent.company,
    companySize: parent.companySize,
    useCase: parent.useCase,
    declaredCta: parent.declaredCta,
    declaredInterest: parent.declaredInterest,
    dryRun: parent.dryRun,
    status: "queued",
    dispatchMode: parent.dispatchMode,
    agentId: parent.agentId,
    requestedAt: scheduledAt,
    durationSec: 0,
    intentSnapshot: parent.intentSnapshot,
    behaviorSnapshot: parent.behaviorSnapshot,
    session: parent.session,
    retryOfCallId: parent.id,
    retryCount: 1,
    retryScheduledAt: scheduledAt,
    retryDueAt,
    callConsentE164: parent.callConsentE164,
    callConsentAt: parent.callConsentAt,
    callConsentAllowOneRetry: parent.callConsentAllowOneRetry
  };
  parent.retryScheduledAt = scheduledAt;
  parent.retryDueAt = retryDueAt;
  store.saveCall(retry);
  store.saveCall(parent);
  return retry;
}

export function maybeScheduleFailedCallRetry(store: RetryStore, call: SundialCallRecord): SundialCallRecord | undefined {
  if (!isRetryEligibleFailure(call)) return undefined;
  if (call.visitorId && visitorIsDisqualified(store, call.visitorId)) return undefined;

  const known = store.peekCalls();
  if (existingRetryForParent(known, call.id)) return undefined;
  if (call.visitorId && queuedRetryForVisitor(known, call.visitorId)) return undefined;

  const accountId = call.session.accountId || "harbor";
  const delayHours = retryDelayHoursOrSkip(getBrainConfigForAccount(accountId));
  if (delayHours == null) return undefined;

  return enqueueRetry(store, call, delayHours);
}

export function stopFollowUpsForVisitor(
  store: RetryStore,
  visitorId: string | undefined,
  phone?: string
): number {
  if (!visitorId) return 0;
  let cancelled = 0;
  for (const call of [...store.peekCalls()]) {
    if (call.visitorId !== visitorId) continue;
    if (phone && !sameE164(call.rawPhoneNumber, phone) && !sameE164(call.callConsentE164, phone)) continue;
    call.callConsentAllowOneRetry = false;
    if (isQueuedRetry(call) && call.status === "queued") {
      call.status = "failed";
      call.errorReason = "Retry cancelled: the visitor stopped the follow-up.";
      call.retryCancelReason = "the visitor stopped the follow-up.";
      call.endedAt = new Date().toISOString();
      cancelled += 1;
    }
    store.saveCall(call);
  }
  return cancelled;
}

function concurrentDial(store: RetryStore, visitorId: string | undefined, exceptCallId: string): boolean {
  if (!visitorId) return false;
  return store.peekCalls().some((call) => {
    if (call.visitorId !== visitorId || call.id === exceptCallId) return false;
    if (call.status === "dialing" || call.status === "in_progress") return true;
    if (call.status === "queued" && !call.retryOfCallId) return true;
    if (call.status === "queued" && call.retryFiredAt) return true;
    return Boolean(call.calleCallId && isInFlightStatus(call.status));
  });
}

function fireDueRetry(store: RetryStore, retry: SundialCallRecord): void {
  const latest = store.peekCalls().find((row) => row.id === retry.id);
  if (!latest || latest.status !== "queued" || latest.retryFiredAt || latest.calleCallId) return;
  if (concurrentDial(store, latest.visitorId, latest.id)) return;
  if (latest.callConsentAllowOneRetry !== true || !sameE164(latest.callConsentE164, latest.rawPhoneNumber)) {
    cancelRetry(store, latest, "call consent no longer matches this number.");
    return;
  }

  latest.retryFiredAt = new Date().toISOString();
  store.saveCall(latest);

  if (!isLiveCalle()) return;

  const phone = latest.rawPhoneNumber;
  const phoneCheck = phone ? validatePhoneNumber(phone) : { valid: false };
  if (!phone || !phoneCheck.valid) {
    latest.status = "failed";
    latest.errorReason = "Retry cancelled: phone number is no longer available.";
    latest.retryCancelReason = latest.errorReason;
    latest.endedAt = new Date().toISOString();
    store.saveCall(latest);
    return;
  }

  const accountId = latest.session.accountId || "harbor";
  const brain = getBrainConfigForAccount(accountId);
  const email = latest.rawContactEmail;
  void dispatchLiveCalleCall(
    phone,
    latest.session,
    latest.contactName,
    email,
    `sundials_${latest.id}`,
    liveContextForCall(latest, brain)
  ).then((liveRes) => {
    const current = store.getCall(latest.id);
    if (!current || current.status === "completed") return;
    if (liveRes.success) {
      current.status = "dialing";
      current.calleCallId = liveRes.calleId;
      current.dialedAt = new Date().toISOString();
    } else {
      current.status = "failed";
      current.errorReason = liveRes.error;
    }
    store.saveCall(current);
  });
}

export function processDueRetries(store: RetryStore): void {
  const now = Date.now();
  for (const call of store.peekCalls()) {
    if (!isQueuedRetry(call)) continue;

    if (HACKATHON_RETRY_LOCKED) {
      cancelRetry(store, call, "hackathon retry lock.");
      continue;
    }

    if (call.visitorId && visitorIsDisqualified(store, call.visitorId)) {
      cancelRetry(store, call, "the lead is disqualified.");
      continue;
    }
    if (call.visitorId && visitorHasCompletedConversation(store, call.visitorId, call.id)) {
      cancelRetry(store, call, "a later completed call exists.");
      continue;
    }

    const due = Date.parse(call.retryDueAt || "");
    if (!Number.isFinite(due) || due > now) continue;
    fireDueRetry(store, call);
  }
}

export function handleCallSavedForRetry(store: RetryStore, call: SundialCallRecord): void {
  if (call.status === "queued" && !call.retryOfCallId) {
    cancelPendingRetriesForVisitor(store, call.visitorId, call.id, "a new discovery call was requested.");
  }
  if (call.status === "completed" || isDisqualifiedCall(call)) {
    cancelPendingRetriesForVisitor(
      store,
      call.visitorId,
      call.id,
      call.status === "completed" ? "a later completed call exists." : "the lead is disqualified."
    );
  }
  markAmbiguousProviderOutcome(store, call);
  maybeScheduleFailedCallRetry(store, call);
}
