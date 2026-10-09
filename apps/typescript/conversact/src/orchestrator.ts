import { CalleCallError, type CallePort } from "./calle.js";
import { CommerceError } from "./commerce.js";
import { assessCallResult } from "./result-policy.js";
import { assertUsableConsent, consumeConsent } from "./safety.js";
import type { CallConsent, CallPlan, CommercePort, PaymentPort, WorkflowOutcome } from "./types.js";

export class ConversactOrchestrator {
  private readonly outcomes = new Map<string, WorkflowOutcome>();

  constructor(private readonly commerce: CommercePort, private readonly payment: PaymentPort) {}

  async reconcile(consent: CallConsent, call: Parameters<typeof assessCallResult>[0]): Promise<WorkflowOutcome> {
    const existing = this.outcomes.get(consent.sessionId);
    if (existing !== undefined) return existing;
    const result = assessCallResult(call, consent.sessionId, consent.recipientPhone);
    if (result.state !== "INTENT_VALIDATED" || result.intent === undefined) return this.store(result);
    try {
      const quote = await this.commerce.quote(result.intent, consent.sessionId);
      const payment = await this.payment.createHandoff(quote, consent.sessionId);
      return this.store({ sessionId: consent.sessionId, state: "PAYMENT_HANDOFF_CREATED", intent: result.intent, quote, payment });
    } catch (error) {
      if (error instanceof CommerceError) {
        return this.store({ sessionId: consent.sessionId, state: "RESULT_REJECTED", intent: result.intent, reason: error.code });
      }
      throw error;
    }
  }

  async startLive(consent: CallConsent, plan: CallPlan, calle: CallePort): Promise<WorkflowOutcome> {
    assertUsableConsent(consent, consent.recipientPhone);
    const existing = this.outcomes.get(consent.sessionId);
    if (existing !== undefined) return existing;
    const consumed = consumeConsent(consent);
    try {
      const created = await calle.createCall(plan);
      if (created.status !== "completed") {
        const finalCall = await calle.waitForResult(created.id);
        return this.reconcile(consumed, finalCall);
      }
      return this.reconcile(consumed, created);
    } catch (error) {
      if (error instanceof CalleCallError && error.ambiguous) {
        return this.store({ sessionId: consent.sessionId, state: "CALL_AMBIGUOUS", reason: "submission outcome is unknown; Conversact will not redial automatically" });
      }
      return this.store({ sessionId: consent.sessionId, state: "FAILED", reason: error instanceof Error ? error.message : "CALL-E call creation failed" });
    }
  }

  private store(outcome: WorkflowOutcome): WorkflowOutcome {
    this.outcomes.set(outcome.sessionId, outcome);
    return outcome;
  }
}
