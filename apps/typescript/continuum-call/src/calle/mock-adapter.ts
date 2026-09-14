import type { BusinessOutcome, CanonicalCallPayload } from "../runtime/types.js";
import { canonicalSha256, payloadSha256 } from "../runtime/crypto.js";
import type { CalleAdapter, CalleCreateResult, CallePollResult } from "./types.js";

export type MockScenario =
  | "declined"
  | "verbally_confirmed"
  | "practice_acknowledged"
  | "early_ja_unresolved"
  | "no_answer"
  | "fail_create";

type Stored = {
  call_id: string;
  idempotency_key: string;
  payload_hash: string;
  scenario: MockScenario;
  create_count: number;
};

function hashPayload(payload: CanonicalCallPayload): string {
  return payloadSha256(payload);
}

function outcomeFor(scenario: MockScenario): {
  status: CallePollResult["status"];
  provider_state: CallePollResult["provider_state"];
  business_outcome: BusinessOutcome | null;
  transcript: CallePollResult["transcript"];
  confirmation_question_asked: boolean;
  answer_after_question: boolean;
  slot_matches_offered: boolean;
  schema_valid: boolean;
  reliable_transcript: boolean;
  structured: Record<string, unknown> | null;
} {
  switch (scenario) {
    case "declined":
      return {
        status: "completed",
        provider_state: "completed",
        business_outcome: "declined",
        confirmation_question_asked: true,
        answer_after_question: true,
        slot_matches_offered: true,
        schema_valid: true,
        reliable_transcript: true,
        structured: { acceptance: "declined" },
        transcript: [
          { speaker: "bot", text: "Can you take Friday at 15:00?" },
          { speaker: "user", text: "No, that does not work for me." },
        ],
      };
    case "verbally_confirmed":
      return {
        status: "completed",
        provider_state: "completed",
        business_outcome: "verbally_confirmed",
        confirmation_question_asked: true,
        answer_after_question: true,
        slot_matches_offered: true,
        schema_valid: true,
        reliable_transcript: true,
        structured: {
          acceptance: "candidate_accepted",
          confirmed_slot: "2026-09-04T15:00:00+02:00",
        },
        transcript: [
          { speaker: "bot", text: "Can you take Friday at 15:00?" },
          { speaker: "user", text: "Yes, Friday at 15:00 works." },
        ],
      };
    case "practice_acknowledged":
      return {
        status: "completed",
        provider_state: "completed",
        business_outcome: "practice_acknowledged",
        confirmation_question_asked: true,
        answer_after_question: true,
        slot_matches_offered: true,
        schema_valid: true,
        reliable_transcript: true,
        structured: {
          acceptance: "practice_acknowledged",
          slot: "2026-09-04T15:00:00+02:00",
        },
        transcript: [
          {
            speaker: "bot",
            text: "Patient confirmed Friday 15:00. Can the practice accept?",
          },
          { speaker: "user", text: "Yes, we accept that slot." },
        ],
      };
    case "early_ja_unresolved":
      return {
        status: "completed",
        provider_state: "completed",
        business_outcome: "unresolved",
        confirmation_question_asked: false,
        answer_after_question: false,
        slot_matches_offered: false,
        schema_valid: true,
        reliable_transcript: true,
        structured: { acceptance: "unresolved" },
        transcript: [
          { speaker: "bot", text: "Hello, this is Continuum Call." },
          { speaker: "user", text: "Yes, Morgan speaking." },
        ],
      };
    case "no_answer":
      return {
        status: "completed",
        provider_state: "completed",
        business_outcome: "no_answer",
        confirmation_question_asked: false,
        answer_after_question: false,
        slot_matches_offered: false,
        schema_valid: true,
        reliable_transcript: false,
        structured: { acceptance: "unresolved" },
        transcript: [],
      };
    case "fail_create":
      return {
        status: "failed",
        provider_state: "failed",
        business_outcome: null,
        confirmation_question_asked: false,
        answer_after_question: false,
        slot_matches_offered: false,
        schema_valid: false,
        reliable_transcript: false,
        structured: null,
        transcript: [],
      };
  }
}

/**
 * In-memory CALL-E stand-in. Never dials. Supports Idempotency-Key reuse
 * and optional "drop first response" to exercise lost-response recover.
 */
export class MockCalleAdapter implements CalleAdapter {
  readonly mode = "mock" as const;
  readonly idempotency_guarantee = "hard" as const;
  private byKey = new Map<string, Stored>();
  private byId = new Map<string, Stored>();
  /** When true, first create for a new key throws after recording — simulates lost HTTP body. */
  dropNextResponse = false;
  defaultScenario: MockScenario = "declined";
  /** Per idempotency key override */
  scenarioByKey = new Map<string, MockScenario>();

  async createCall(args: {
    idempotency_key: string;
    payload: CanonicalCallPayload;
  }): Promise<CalleCreateResult> {
    const payload_hash = hashPayload(args.payload);
    const existing = this.byKey.get(args.idempotency_key);
    if (existing) {
      if (existing.payload_hash !== payload_hash) {
        const err = new Error(
          "Idempotency-Key reused with different payload",
        ) as Error & { code: string };
        err.code = "IDEMPOTENCY_PAYLOAD_MISMATCH";
        throw err;
      }
      existing.create_count += 1;
      return {
        call_id: existing.call_id,
        status: "reused",
        reused: true,
      };
    }

    const scenario =
      this.scenarioByKey.get(args.idempotency_key) ?? this.defaultScenario;
    if (scenario === "fail_create") {
      throw new Error("mock provider create failed");
    }

    const call_id = `mock_run_${canonicalSha256(args.idempotency_key).slice(0, 16)}`;
    const stored: Stored = {
      call_id,
      idempotency_key: args.idempotency_key,
      payload_hash,
      scenario,
      create_count: 1,
    };
    this.byKey.set(args.idempotency_key, stored);
    this.byId.set(call_id, stored);

    if (this.dropNextResponse) {
      this.dropNextResponse = false;
      const err = new Error("simulated lost response after provider accept") as Error & {
        code: string;
        call_id: string;
      };
      err.code = "LOST_RESPONSE";
      err.call_id = call_id;
      throw err;
    }

    return { call_id, status: "accepted", reused: false };
  }

  async getCall(callId: string): Promise<CallePollResult> {
    const stored = this.byId.get(callId);
    if (!stored) {
      throw new Error(`unknown mock call_id ${callId}`);
    }
    const o = outcomeFor(stored.scenario);
    return {
      call_id: callId,
      status: o.status,
      provider_state: o.provider_state,
      business_outcome: o.business_outcome,
      transcript: o.transcript,
      structured: o.structured,
      confirmation_question_asked: o.confirmation_question_asked,
      answer_after_question: o.answer_after_question,
      slot_matches_offered: o.slot_matches_offered,
      schema_valid: o.schema_valid,
      reliable_transcript: o.reliable_transcript,
      transcript_result_conflict: false,
    };
  }

  createCount(idempotencyKey: string): number {
    return this.byKey.get(idempotencyKey)?.create_count ?? 0;
  }

  distinctCallCount(): number {
    return this.byId.size;
  }

  exportRuns(): Array<{
    idempotency_key: string;
    call_id: string;
    payload_hash: string;
    scenario: string;
    create_count: number;
  }> {
    return [...this.byKey.values()].map((s) => ({
      idempotency_key: s.idempotency_key,
      call_id: s.call_id,
      payload_hash: s.payload_hash,
      scenario: s.scenario,
      create_count: s.create_count,
    }));
  }

  importRuns(
    runs: Array<{
      idempotency_key: string;
      call_id: string;
      payload_hash: string;
      scenario: string;
      create_count: number;
    }>,
  ): void {
    for (const r of runs) {
      const stored: Stored = {
        call_id: r.call_id,
        idempotency_key: r.idempotency_key,
        payload_hash: r.payload_hash,
        scenario: r.scenario as MockScenario,
        create_count: r.create_count,
      };
      this.byKey.set(r.idempotency_key, stored);
      this.byId.set(r.call_id, stored);
      this.scenarioByKey.set(r.idempotency_key, stored.scenario);
    }
  }
}
