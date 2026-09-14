import type { CalleAdapter, CallePollResult } from "../calle/types.js";
import {
  assertMockCannotBurnLiveBudget,
  checkDispatchGuards,
  type GuardConfig,
} from "./guards.js";
import { evaluateVerbalConfirmation } from "./transitions.js";
import { canonicalSha256 } from "./crypto.js";
import type { MissionRuntime } from "./mission-runtime.js";
import type { BusinessOutcome, CallIntent } from "./types.js";

export type DispatchResult =
  | { ok: true; intent: CallIntent; reused: boolean }
  | {
      ok: false;
      intent: CallIntent;
      kind: "ambiguous" | "rejected" | "guard_blocked" | "fault_injected";
      reason: string;
      code?: string;
    };

export type FaultPoint = "after_create_before_persist" | null;

/**
 * Places a provider create through the adapter while holding Continuum invariants.
 * Never used with live adapter unless SPIKE_LIVE is explicitly set by the operator.
 */
export class IntentDispatcher {
  /** Armed fault: fires once on next successful create before durable persist. */
  faultPoint: FaultPoint = null;

  constructor(
    private readonly runtime: MissionRuntime,
    private readonly adapter: CalleAdapter,
    private readonly guardConfig: Partial<GuardConfig> = {},
  ) {}

  private resultFingerprint(poll: CallePollResult): string {
    return canonicalSha256({
      call_id: poll.call_id,
      status: poll.status,
      provider_state: poll.provider_state,
      business_outcome: poll.business_outcome,
      structured: poll.structured,
      transcript: poll.transcript,
      confirmation_question_asked: poll.confirmation_question_asked,
      answer_after_question: poll.answer_after_question,
      slot_matches_offered: poll.slot_matches_offered,
      schema_valid: poll.schema_valid,
      reliable_transcript: poll.reliable_transcript,
      transcript_result_conflict: poll.transcript_result_conflict,
    });
  }

  private checkGuards(
    callIntentId: string,
    operation: "dispatch" | "recover" = "dispatch",
  ): DispatchResult | null {
    const intent = this.runtime.getIntent(callIntentId);
    if (!intent) throw new Error("unknown intent");

    const missionId = this.runtime.missionIdForIntent(callIntentId);
    const mission = this.runtime.getMission(missionId);
    if (!mission) throw new Error("unknown mission");

    if (
      operation === "dispatch" &&
      this.runtime.listStuckIntents(missionId).length > 0
    ) {
      const code = "MISSION_HAS_STUCK_INTENT";
      const reason =
        "new dispatch refused while another intent has an unresolved provider identity";
      this.runtime.recordGuardBlocked(missionId, callIntentId, code, reason);
      return {
        ok: false,
        intent,
        kind: "guard_blocked",
        reason,
        code,
      };
    }

    const liveBudget = assertMockCannotBurnLiveBudget(
      this.adapter.mode === "live" ? "live" : "mock",
    );
    if (!liveBudget.ok) {
      this.runtime.recordGuardBlocked(
        missionId,
        callIntentId,
        liveBudget.code,
        liveBudget.reason,
      );
      return {
        ok: false,
        intent,
        kind: "guard_blocked",
        reason: liveBudget.reason,
        code: liveBudget.code,
      };
    }

    if (
      operation === "recover" &&
      this.adapter.idempotency_guarantee !== "hard"
    ) {
      const code = "RECOVERY_IDEMPOTENCY_UNVERIFIED";
      const reason =
        "lost-response retry refused until provider same-key idempotency is proven";
      this.runtime.recordGuardBlocked(missionId, callIntentId, code, reason);
      return {
        ok: false,
        intent,
        kind: "guard_blocked",
        reason,
        code,
      };
    }

    const guard = checkDispatchGuards({
      consent_recorded: intent.consent_recorded,
      timezone: intent.timezone,
      payload: intent.canonical_call_payload,
      provider_run_count: this.runtime.callBudgetUsed(missionId),
      mission_status: mission.status,
      dispatches_stopped: this.runtime.isDispatchesStopped(missionId),
      operation,
      config: this.guardConfig,
    });
    if (!guard.ok) {
      this.runtime.recordGuardBlocked(
        missionId,
        callIntentId,
        guard.code,
        guard.reason,
      );
      return {
        ok: false,
        intent,
        kind: "guard_blocked",
        reason: guard.reason,
        code: guard.code,
      };
    }
    return null;
  }

  async dispatch(callIntentId: string): Promise<DispatchResult> {
    const intent = this.runtime.getIntent(callIntentId);
    if (!intent) throw new Error("unknown intent");

    const blocked = this.checkGuards(callIntentId);
    if (blocked) return blocked;

    this.runtime.beginDispatch(callIntentId, intent.canonical_call_payload);

    try {
      const created = await this.adapter.createCall({
        idempotency_key: intent.provider_idempotency_key,
        payload: intent.canonical_call_payload,
      });

      if (this.faultPoint === "after_create_before_persist") {
        this.faultPoint = null;
        const missionId = this.runtime.missionIdForIntent(callIntentId);
        this.runtime.recordFaultInjected(
          missionId,
          callIntentId,
          "after_create_before_persist",
          created.call_id,
        );
        // Persist stuck state before "crash" if store attached
        this.runtime.flushStore?.(missionId);
        const err = new Error(
          "CRASH RUNTIME: fault after create before provider_run_id persist",
        ) as Error & { code: string; call_id: string };
        err.code = "FAULT_INJECTED";
        err.call_id = created.call_id;
        throw err;
      }

      const updated = this.runtime.attachProviderRun(
        callIntentId,
        created.call_id,
      );
      return { ok: true, intent: updated, reused: created.reused };
    } catch (e) {
      const err = e as Error & { code?: string; call_id?: string };
      if (err.code === "FAULT_INJECTED") {
        return {
          ok: false,
          intent: this.runtime.getIntent(callIntentId)!,
          kind: "fault_injected",
          reason: "after_create_before_persist",
          code: "FAULT_INJECTED",
        };
      }
      if (err.code === "LOST_RESPONSE") {
        const marked = this.runtime.markAmbiguous(
          callIntentId,
          "lost_response_after_create",
        );
        return {
          ok: false,
          intent: marked,
          kind: "ambiguous",
          reason: "lost_response_after_create",
        };
      }
      if (
        err.code === "PAYLOAD_CHANGED" ||
        err.code === "IDEMPOTENCY_PAYLOAD_MISMATCH"
      ) {
        return {
          ok: false,
          intent: this.runtime.getIntent(callIntentId)!,
          kind: "rejected",
          reason: err.code,
        };
      }
      const safeReason = err.code || "create_failed_or_unknown";
      const marked = this.runtime.markAmbiguous(callIntentId, safeReason);
      return {
        ok: false,
        intent: marked,
        kind: "ambiguous",
        reason: safeReason,
        code: err.code,
      };
    }
  }

  /**
   * Recover after ambiguous/lost response / fault: retry SAME frozen key.
   * Guards apply — pause / stop_dispatches / quiet hours still block.
   */
  async recover(callIntentId: string): Promise<DispatchResult> {
    const intent = this.runtime.getIntent(callIntentId);
    if (!intent) throw new Error("unknown intent");
    if (intent.state !== "ambiguous" && intent.state !== "dispatching") {
      throw new Error(
        `recover only from dispatching/ambiguous, got ${intent.state}`,
      );
    }

    const blocked = this.checkGuards(callIntentId, "recover");
    if (blocked) return blocked;

    try {
      this.runtime.assertIntentPayloadIntegrity(callIntentId);
      const created = await this.adapter.createCall({
        idempotency_key: intent.provider_idempotency_key,
        payload: intent.canonical_call_payload,
      });
      const updated = this.runtime.recoverProviderRun(
        callIntentId,
        created.call_id,
      );
      return { ok: true, intent: updated, reused: created.reused };
    } catch (e) {
      const err = e as Error & { code?: string };
      if (
        err.code === "PAYLOAD_INTEGRITY_FAILED" ||
        err.code === "PAYLOAD_CHANGED" ||
        err.code === "IDEMPOTENCY_PAYLOAD_MISMATCH"
      ) {
        return {
          ok: false,
          intent,
          kind: "rejected",
          reason: err.code,
          code: err.code,
        };
      }
      return {
        ok: false,
        intent,
        kind: "ambiguous",
        reason: err.code || "recovery_failed_or_unknown",
        code: err.code,
      };
    }
  }

  async ingestTerminal(callIntentId: string): Promise<{
    intent: CallIntent;
    outcome: BusinessOutcome;
  }> {
    const intent = this.runtime.getIntent(callIntentId);
    if (!intent?.provider_run_id) {
      throw new Error("ingest requires run_known provider_run_id");
    }
    if (intent.state === "terminal") {
      if (!intent.business_outcome) {
        throw new Error("terminal intent missing business outcome");
      }
      const repeatedPoll = await this.adapter.getCall(intent.provider_run_id);
      if (
        repeatedPoll.status !== "completed" &&
        repeatedPoll.status !== "failed"
      ) {
        const error = new Error(
          `provider result regressed from terminal to ${repeatedPoll.status}`,
        ) as Error & { code: string };
        error.code = "RESULT_CONFLICT";
        this.runtime.recordResultConflict(
          callIntentId,
          this.resultFingerprint(repeatedPoll),
        );
        throw error;
      }
      const observedFingerprint = this.resultFingerprint(repeatedPoll);
      if (observedFingerprint !== intent.result_fingerprint) {
        const error = new Error(
          "provider returned a conflicting terminal result for the same call",
        ) as Error & { code: string };
        error.code = "RESULT_CONFLICT";
        this.runtime.recordResultConflict(callIntentId, observedFingerprint);
        throw error;
      }
      const duplicate = this.runtime.recordDuplicateResultIgnored(callIntentId);
      return { intent: duplicate, outcome: intent.business_outcome };
    }
    if (intent.state !== "run_known") {
      throw new Error(`ingest requires run_known state, got ${intent.state}`);
    }
    const poll = await this.adapter.getCall(intent.provider_run_id);

    if (poll.status !== "completed" && poll.status !== "failed") {
      const err = new Error(`provider result is not terminal (${poll.status})`) as Error & {
        code: string;
      };
      err.code = "PROVIDER_NOT_TERMINAL";
      throw err;
    }

    const hardRuleOutcome = evaluateVerbalConfirmation({
      confirmationQuestionAsked: poll.confirmation_question_asked,
      answerAfterQuestion: poll.answer_after_question,
      slotMatchesOfferedFact: poll.slot_matches_offered,
      schemaValid: poll.schema_valid,
      transcriptResultConflict: poll.transcript_result_conflict,
      reliableTranscript: poll.reliable_transcript,
    });
    const claimed = poll.business_outcome;
    const affirmative =
      claimed === "candidate_accepted" ||
      claimed === "verbally_confirmed" ||
      claimed === "practice_acknowledged";
    const conversationEvidenceIsCoherent =
      poll.schema_valid &&
      poll.reliable_transcript &&
      !poll.transcript_result_conflict &&
      poll.confirmation_question_asked &&
      poll.answer_after_question &&
      poll.slot_matches_offered;
    const providerDispositionIsCoherent =
      poll.schema_valid &&
      !poll.transcript_result_conflict &&
      poll.provider_state === "completed";
    let outcome: BusinessOutcome;
    if (affirmative) {
      outcome =
        hardRuleOutcome === "verbally_confirmed" ? claimed : "unresolved";
    } else if (claimed === "declined" || claimed === "callback_requested") {
      // A negative conversational result can also unlock real-world work. It
      // therefore needs the same ordered, reliable evidence as an acceptance.
      outcome = conversationEvidenceIsCoherent ? claimed : "unresolved";
    } else if (claimed === "no_answer" || claimed === "voicemail") {
      // These have no transcript by definition, but still require a coherent
      // terminal provider disposition and a validated structured result.
      outcome = providerDispositionIsCoherent ? claimed : "unresolved";
    } else if (claimed === "unresolved") {
      outcome = "unresolved";
    } else if (poll.status === "failed") {
      outcome = "unresolved";
    } else {
      outcome = hardRuleOutcome;
    }

    const validatedFacts: Record<string, string> = {};
    if (
      outcome === "candidate_accepted" ||
      outcome === "verbally_confirmed" ||
      outcome === "practice_acknowledged"
    ) {
      const appointmentTime =
        poll.structured?.appointment_time ??
        poll.structured?.confirmed_slot ??
        poll.structured?.slot;
      if (typeof appointmentTime === "string" && appointmentTime.length > 0) {
        validatedFacts.appointment_time = appointmentTime;
      }
      if (outcome === "practice_acknowledged") {
        validatedFacts.practice_ack = "accepted";
      }
    }

    const resultFingerprint = this.resultFingerprint(poll);
    const completed = this.runtime.completeIntent(
      callIntentId,
      outcome,
      resultFingerprint,
      validatedFacts,
    );
    return { intent: completed, outcome };
  }
}
