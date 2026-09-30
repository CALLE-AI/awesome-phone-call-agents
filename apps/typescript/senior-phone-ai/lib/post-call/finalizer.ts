import { createHash, randomUUID } from "node:crypto";

import type { CalleCallSnapshot } from "../calle/status";
import { assertStrictE164, redactPhoneNumbers } from "../safety/phone";
import type { AuthorizedSmsRequest } from "../tools/sms-service";

export type PostCallActionStatus = "completed" | "pending" | "failed";
export type PostCallSmsStatus = "not_requested" | "queued" | "sent" | "failed" | "unknown";

export interface PostCallAction {
  readonly label: string;
  readonly status: PostCallActionStatus;
}

export interface PostCallFinalizationRequest {
  readonly actions: readonly PostCallAction[];
  readonly call: CalleCallSnapshot;
  readonly callSessionId: string;
  readonly seniorId: string;
}

export interface PostCallRecord {
  readonly callId: string;
  readonly callSessionId: string;
  readonly createdAt: string;
  readonly fingerprint: string;
  readonly id: string;
  readonly smsMessage: string;
  readonly smsStatus: PostCallSmsStatus;
  readonly seniorId: string;
  readonly summary: string;
}

export interface PostCallStore {
  claimSms(id: string): Promise<{ claimed: boolean; record: PostCallRecord }> | { claimed: boolean; record: PostCallRecord };
  reserve(record: PostCallRecord): Promise<{ created: boolean; record: PostCallRecord }> | { created: boolean; record: PostCallRecord };
  updateSms(id: string, status: Exclude<PostCallSmsStatus, "not_requested">): Promise<PostCallRecord> | PostCallRecord;
}

export interface PostCallSmsDispatcher {
  dispatch(request: AuthorizedSmsRequest): Promise<{ status: string }>;
}

const ACTION_LABEL = /^[^\u0000-\u001F]{1,120}$/u;

function validateActions(actions: readonly PostCallAction[]): PostCallAction[] {
  if (actions.length > 10) throw new Error("too many post-call actions");
  return actions.map((action) => {
    const label = redactPhoneNumbers(action.label).trim();
    if (!ACTION_LABEL.test(label)) throw new Error("invalid post-call action");
    return { label, status: action.status };
  });
}

function requestFingerprint(request: PostCallFinalizationRequest, actions: readonly PostCallAction[]): string {
  return createHash("sha256").update(JSON.stringify([
    request.call.callId,
    request.callSessionId,
    request.seniorId,
    request.call.status,
    request.call.outcome,
    request.call.summary ?? null,
    actions,
  ])).digest("hex");
}

export function composePostCallSummary(request: PostCallFinalizationRequest): { fingerprint: string; smsMessage: string; summary: string } {
  if (request.call.outcome === "pending") throw new Error("call is not terminal");
  const actions = validateActions(request.actions);
  const parts = [`Call outcome: ${request.call.outcome}.`];
  parts.push(request.call.summary
    ? `Provider summary: ${redactPhoneNumbers(request.call.summary)}`
    : "No reliable conversation summary was available.");
  for (const action of actions) parts.push(`${action.status[0]?.toUpperCase()}${action.status.slice(1)} action: ${action.label}.`);
  const summary = parts.join(" ").slice(0, 1_200);
  return {
    fingerprint: requestFingerprint(request, actions),
    summary,
    smsMessage: `Senior Phone AI: ${summary}`.slice(0, 480),
  };
}

export class InMemoryPostCallStore implements PostCallStore {
  private readonly records = new Map<string, PostCallRecord>();

  reserve(record: PostCallRecord) {
    const existing = [...this.records.values()].find((item) => item.callId === record.callId);
    if (existing) {
      if (existing.fingerprint !== record.fingerprint) throw new Error("call finalization changed after reservation");
      return { created: false, record: existing };
    }
    this.records.set(record.id, record);
    return { created: true, record };
  }

  claimSms(id: string) {
    const existing = this.records.get(id);
    if (!existing) throw new Error("post-call record does not exist");
    if (existing.smsStatus !== "not_requested") return { claimed: false, record: existing };
    const updated = { ...existing, smsStatus: "queued" as const };
    this.records.set(id, updated);
    return { claimed: true, record: updated };
  }

  updateSms(id: string, status: Exclude<PostCallSmsStatus, "not_requested">): PostCallRecord {
    const existing = this.records.get(id);
    if (!existing) throw new Error("post-call record does not exist");
    const updated = { ...existing, smsStatus: status };
    this.records.set(id, updated);
    return updated;
  }
}

export class PostCallFinalizer {
  constructor(
    private readonly store: PostCallStore,
    private readonly sms: PostCallSmsDispatcher,
    private readonly now: () => number = Date.now,
  ) {}

  async finalize(request: PostCallFinalizationRequest): Promise<PostCallRecord> {
    const content = composePostCallSummary(request);
    const reservation = await this.store.reserve({
      callId: request.call.callId,
      callSessionId: request.callSessionId,
      createdAt: new Date(this.now()).toISOString(),
      fingerprint: content.fingerprint,
      id: randomUUID(),
      smsMessage: content.smsMessage,
      smsStatus: "not_requested",
      seniorId: request.seniorId,
      summary: content.summary,
    });
    return reservation.record;
  }

  async sendOptedInFollowup(
    record: PostCallRecord,
    optedIn: boolean,
    request: AuthorizedSmsRequest,
  ): Promise<PostCallRecord> {
    if (!optedIn) throw new Error("post-call SMS opt-in is required");
    assertStrictE164(request.destinationE164);
    if (request.message !== record.smsMessage) throw new Error("post-call SMS content changed after confirmation");
    const claim = await this.store.claimSms(record.id);
    if (!claim.claimed) return claim.record;
    try {
      const result = await this.sms.dispatch(request);
      const status = ["queued", "sent", "failed", "unknown"].includes(result.status)
        ? result.status as Exclude<PostCallSmsStatus, "not_requested">
        : "unknown";
      return this.store.updateSms(record.id, status);
    } catch {
      return this.store.updateSms(record.id, "unknown");
    }
  }
}
