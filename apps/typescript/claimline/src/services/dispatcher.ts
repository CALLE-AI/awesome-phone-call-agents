import type { ClaimLineConfig } from "../config.js";
import type { CalleGateway, CallRequest } from "../calle/gateway.js";
import { deriveIdempotencyKey } from "../domain/idempotency.js";
import { assertE164, isValidE164 } from "../domain/phone.js";
import type {
  CallIntent,
  CallType,
  Claim,
  ClaimContact,
} from "../domain/types.js";
import type { Store } from "../store/store.js";
import {
  planFor,
  planForContact,
  toContactPreview,
  toPreview,
  type CallPlan,
  type CallPreview,
} from "./tasks.js";

export type DispatchStatus =
  | "preview"
  | "submitted"
  | "duplicate"
  | "submission_unknown"
  | "preflight_failed";

export interface DispatchOutcome {
  status: DispatchStatus;
  intent: CallIntent;
  preview: CallPreview;
  reason?: string;
}

export interface DispatchOptions {
  /** A real (or simulated) call is only placed when confirm === true. */
  confirm?: boolean;
  /** Fixture-mode only: force a specific canned scenario for demos/tests. */
  fixtureScenario?: string;
  /** Which actor placed the call (owner / guest / fixture). */
  placedBy?: string | null;
  /** Retry generation for an explicit re-dial (fresh idempotency key). */
  retryAttempt?: number;
}

interface PreflightResult {
  ok: boolean;
  issues: string[];
}

/**
 * The dispatch pipeline: reserve intent -> no-call preflight -> explicit
 * confirmation gate -> submit to CALL-E. Without confirm=true it returns a
 * masked preview and places no call (the safe default).
 */
export class Dispatcher {
  constructor(
    private readonly store: Store,
    private readonly gateway: CalleGateway,
    private readonly config: ClaimLineConfig,
  ) {}

  preview(claimId: string, callType: CallType): CallPreview {
    const { claim, plan } = this.resolve(claimId, callType);
    return toPreview(claim, plan);
  }

  previewContact(claimId: string, contactId: string): CallPreview {
    const { claim, contact, plan } = this.resolveContact(claimId, contactId);
    return toContactPreview(claim, contact, plan);
  }

  async dispatch(
    claimId: string,
    callType: CallType,
    opts: DispatchOptions = {},
  ): Promise<DispatchOutcome> {
    const { claim, plan } = this.resolve(claimId, callType);
    const preview = toPreview(claim, plan);
    return this.dispatchPlan(claim, plan, null, preview, opts);
  }

  /** Dispatch a call to a specific associated contact (doctor, billing, ...). */
  async dispatchToContact(
    claimId: string,
    contactId: string,
    opts: DispatchOptions = {},
  ): Promise<DispatchOutcome> {
    const { claim, contact, plan } = this.resolveContact(claimId, contactId);
    const preview = toContactPreview(claim, contact, plan);
    return this.dispatchPlan(claim, plan, contact.id, preview, opts);
  }

  /**
   * Re-dial a call that has terminally failed (needs_human / submission_unknown /
   * canceled) as a fresh attempt. A new idempotency key is derived from a
   * monotonic attempt count, so an explicit re-dial places a new call while a
   * double-click still collapses to one (the count is stable until it lands).
   */
  async redial(
    intentId: string,
    opts: { placedBy?: string | null } = {},
  ): Promise<DispatchOutcome> {
    const intent = this.store.getIntent(intentId);
    if (!intent) throw new Error(`unknown intent: ${intentId}`);
    const retryable = new Set<string>([
      "needs_human",
      "submission_unknown",
      "canceled",
    ]);
    if (!retryable.has(intent.state)) {
      throw new Error(
        `intent ${intentId} is ${intent.state}; only a failed call can be retried`,
      );
    }
    const retryAttempt = this.store.countIntentsForContact(
      intent.claimId,
      intent.contactId,
      intent.callType,
    );
    const dispatchOpts: DispatchOptions = {
      confirm: true,
      placedBy: opts.placedBy ?? intent.placedBy,
      retryAttempt,
    };
    return intent.contactId
      ? this.dispatchToContact(intent.claimId, intent.contactId, dispatchOpts)
      : this.dispatch(intent.claimId, intent.callType, dispatchOpts);
  }

  /** Shared pipeline for both claim-level and contact-level dispatch. */
  private async dispatchPlan(
    claim: Claim,
    plan: CallPlan,
    contactId: string | null,
    preview: CallPreview,
    opts: DispatchOptions,
  ): Promise<DispatchOutcome> {
    const idempotencyKey = deriveIdempotencyKey({
      claimId: claim.id,
      callType: plan.callType,
      contactId,
      destinationPhone: plan.recipient.phone,
      schemaVersion: plan.schemaVersion,
      ...(opts.retryAttempt ? { retryAttempt: opts.retryAttempt } : {}),
    });

    const { intent } = this.store.reserveIntent({
      claimId: claim.id,
      contactId,
      callType: plan.callType,
      idempotencyKey,
      destinationPhone: plan.recipient.phone,
      region: plan.recipient.region,
      locale: plan.recipient.locale,
      schemaVersion: plan.schemaVersion,
      placedBy: opts.placedBy ?? null,
    });

    // Idempotent: an intent already past "reserved" is in flight or terminal.
    if (intent.state !== "reserved") {
      return { status: "duplicate", intent, preview };
    }

    const preflight = this.preflight(claim, plan);
    if (!preflight.ok) {
      const updated = this.store.updateIntentState(intent.id, "needs_human", {
        reason: `preflight_failed:${preflight.issues.join(";")}`,
      });
      return {
        status: "preflight_failed",
        intent: updated,
        preview,
        reason: preflight.issues.join("; "),
      };
    }

    // Confirmation gate — the no-call default. Nothing is dialed without this.
    if (opts.confirm !== true) {
      return { status: "preview", intent, preview };
    }

    const request: CallRequest = {
      idempotencyKey,
      task: plan.task,
      resultSchema: plan.resultSchema,
      recipient: plan.recipient,
      metadata: {
        claimReference: claim.reference,
        callType: plan.callType,
        ...(contactId ? { contactId } : {}),
        ...(opts.fixtureScenario ? { fixtureScenario: opts.fixtureScenario } : {}),
      },
      ...(this.webhookUrl() ? { webhookUrl: this.webhookUrl()! } : {}),
    };

    try {
      const handle = await this.gateway.startCall(request);
      const updated = this.store.updateIntentState(intent.id, "accepted", {
        callId: handle.callId,
        reason: null,
      });
      return { status: "submitted", intent: updated, preview };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const updated = this.store.updateIntentState(
        intent.id,
        "submission_unknown",
        { reason: `submit_error:${message}` },
      );
      return {
        status: "submission_unknown",
        intent: updated,
        preview,
        reason: message,
      };
    }
  }

  /** Cancel a reserved intent before it is dialed. */
  cancel(intentId: string): CallIntent {
    const intent = this.store.getIntent(intentId);
    if (!intent) throw new Error(`unknown intent: ${intentId}`);
    if (intent.state !== "reserved") {
      throw new Error(
        `intent ${intentId} is ${intent.state}; only reserved intents can be canceled`,
      );
    }
    return this.store.updateIntentState(intentId, "canceled", {
      reason: "canceled_before_dial",
    });
  }

  /**
   * Re-submit an intent whose acceptance is unknown. CALL-E's idempotency key
   * makes this safe: it returns the existing call rather than dialing again.
   */
  async retrySubmission(intentId: string): Promise<CallIntent> {
    const intent = this.store.getIntent(intentId);
    if (!intent) throw new Error(`unknown intent: ${intentId}`);
    if (intent.state !== "submission_unknown") return intent;

    const claim = this.store.getClaim(intent.claimId);
    if (!claim) throw new Error(`unknown claim: ${intent.claimId}`);

    let plan: CallPlan;
    if (intent.contactId) {
      const contact = this.store.getContact(intent.contactId);
      if (!contact) throw new Error(`unknown contact: ${intent.contactId}`);
      plan = planForContact(
        claim,
        contact,
        { insurerName: this.config.insurerName },
        intent.callType,
      );
    } else {
      plan = planFor(claim, intent.callType, {
        insurerName: this.config.insurerName,
      });
    }

    const request: CallRequest = {
      idempotencyKey: intent.idempotencyKey,
      task: plan.task,
      resultSchema: plan.resultSchema,
      recipient: plan.recipient,
      metadata: {
        claimReference: claim.reference,
        callType: intent.callType,
        ...(intent.contactId ? { contactId: intent.contactId } : {}),
      },
      ...(this.webhookUrl() ? { webhookUrl: this.webhookUrl()! } : {}),
    };
    const handle = await this.gateway.startCall(request);
    return this.store.updateIntentState(intent.id, "accepted", {
      callId: handle.callId,
      reason: null,
    });
  }

  private resolve(
    claimId: string,
    callType: CallType,
  ): { claim: Claim; plan: CallPlan } {
    const claim = this.store.getClaim(claimId);
    if (!claim) throw new Error(`unknown claim: ${claimId}`);
    const plan = planFor(claim, callType, {
      insurerName: this.config.insurerName,
    });
    return { claim, plan };
  }

  private resolveContact(
    claimId: string,
    contactId: string,
  ): { claim: Claim; contact: ClaimContact; plan: CallPlan } {
    const claim = this.store.getClaim(claimId);
    if (!claim) throw new Error(`unknown claim: ${claimId}`);
    const contact = this.store.getContact(contactId);
    if (!contact) throw new Error(`unknown contact: ${contactId}`);
    if (contact.claimId !== claim.id) {
      throw new Error(`contact ${contactId} does not belong to claim ${claimId}`);
    }
    const plan = planForContact(claim, contact, {
      insurerName: this.config.insurerName,
    });
    return { claim, contact, plan };
  }

  private preflight(claim: Claim, plan: CallPlan): PreflightResult {
    const issues: string[] = [];
    if (!isValidE164(plan.recipient.phone)) {
      issues.push("destination_not_e164");
    } else {
      // Never silently repair; assert to be explicit about the invariant.
      assertE164(plan.recipient.phone, "destination");
    }
    if (plan.recipient.phone !== plan.recipient.phone.trim()) {
      issues.push("destination_has_whitespace");
    }
    if (
      !plan.resultSchema ||
      typeof plan.resultSchema !== "object" ||
      Object.keys(plan.resultSchema).length === 0
    ) {
      issues.push("missing_result_schema");
    }
    if (!plan.task || plan.task.trim().length === 0) {
      issues.push("empty_task");
    }
    if (!claim.region || !claim.locale) {
      issues.push("missing_region_or_locale");
    }
    return { ok: issues.length === 0, issues };
  }

  private webhookUrl(): string | null {
    if (this.config.mode !== "live") return null;
    if (!this.config.publicBaseUrl) return null;
    const base = this.config.publicBaseUrl.replace(/\/$/, "");
    const url = new URL(`${base}/calle/webhook`);
    if (this.config.webhookSecret) {
      url.searchParams.set("secret", this.config.webhookSecret);
    }
    return url.toString();
  }
}
