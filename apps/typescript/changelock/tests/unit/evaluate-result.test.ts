import { describe, expect, it } from "vitest";
import {
  evaluateCallResult,
  CONFIDENCE_THRESHOLD,
  type EvaluationIntent,
  type NormalizedSnapshot,
} from "../../src/domain/evaluate-result";
import { phoneFingerprint } from "../../src/domain/fingerprint";

const intent: EvaluationIntent = {
  id: "intent-1",
  providerCallId: "call_abc",
  requestHash: "rh-1",
  taskVersion: "task_v1",
  schemaVersion: "recipient_result_v1",
  destinationFingerprint: phoneFingerprint("+12025550114"),
};

function passingSnapshot(over: Partial<NormalizedSnapshot> = {}): NormalizedSnapshot {
  return {
    callId: "call_abc",
    status: "completed",
    taskCompleted: true,
    recipientStatus: "completed",
    confidenceScore: 0.92,
    destinationFingerprint: intent.destinationFingerprint,
    meta: {
      intentId: intent.id,
      requestHash: intent.requestHash,
      taskVersion: intent.taskVersion,
      schemaVersion: intent.schemaVersion,
    },
    structuredResult: {
      organization_identity: "confirmed",
      change_request_status: "initiated",
      safe_case_code_confirmed: "yes",
      sensitive_data_disclosed: "no",
      recipient_opt_out: "no",
    },
    evidence: ["Recipient confirmed finance team initiated request CL-7F3A9C."],
    ...over,
  };
}

function sr(patch: Record<string, unknown>): unknown {
  return {
    organization_identity: "confirmed",
    change_request_status: "initiated",
    safe_case_code_confirmed: "yes",
    sensitive_data_disclosed: "no",
    recipient_opt_out: "no",
    ...patch,
  };
}

describe("evaluateCallResult — confirmed", () => {
  it("confirms when every gate passes", () => {
    const r = evaluateCallResult(intent, passingSnapshot());
    expect(r.disposition).toBe("confirmed");
    expect(r.caseState).toBe("verification_confirmed");
    expect(r.failedGates).toEqual([]);
  });

  it("denies under the same gates with not_initiated", () => {
    const r = evaluateCallResult(
      intent,
      passingSnapshot({ structuredResult: sr({ change_request_status: "not_initiated" }) }),
    );
    expect(r.disposition).toBe("denied");
    expect(r.caseState).toBe("verification_denied");
    expect(r.failedGates).toEqual([]);
  });
});

describe("evaluateCallResult — every gate fails closed", () => {
  const cases: [string, Partial<NormalizedSnapshot>][] = [
    ["non-terminal status", { status: "in_progress" }],
    ["failed status", { status: "failed" }],
    ["taskCompleted false", { taskCompleted: false }],
    ["taskCompleted missing", { taskCompleted: null }],
    ["recipient not completed", { recipientStatus: "not_reached" }],
    ["wrong call id", { callId: "call_other" }],
    ["wrong intent binding", { meta: { intentId: "intent-2", requestHash: "rh-1", taskVersion: "task_v1", schemaVersion: "recipient_result_v1" } }],
    ["wrong request hash", { meta: { intentId: "intent-1", requestHash: "rh-X", taskVersion: "task_v1", schemaVersion: "recipient_result_v1" } }],
    ["wrong task version", { meta: { intentId: "intent-1", requestHash: "rh-1", taskVersion: "task_v2", schemaVersion: "recipient_result_v1" } }],
    ["wrong schema version", { meta: { intentId: "intent-1", requestHash: "rh-1", taskVersion: "task_v1", schemaVersion: "recipient_result_v2" } }],
    ["destination mismatch", { destinationFingerprint: phoneFingerprint("+13125550199") }],
    ["confidence below threshold", { confidenceScore: 0.69 }],
    ["confidence at threshold edge below", { confidenceScore: CONFIDENCE_THRESHOLD - 0.001 }],
    ["confidence missing", { confidenceScore: null }],
    ["no evidence", { evidence: [] }],
    ["unknown identity", { structuredResult: sr({ organization_identity: "unknown" }) }],
    ["identity not confirmed", { structuredResult: sr({ organization_identity: "not_confirmed" }) }],
    ["unknown case code", { structuredResult: sr({ safe_case_code_confirmed: "unknown" }) }],
    ["case code no", { structuredResult: sr({ safe_case_code_confirmed: "no" }) }],
    ["unknown change status", { structuredResult: sr({ change_request_status: "unknown" }) }],
    ["extra field in result", { structuredResult: sr({ unexpected: "x" }) }],
    ["missing required field", { structuredResult: sr({ recipient_opt_out: undefined }) }],
    ["malformed enum value", { structuredResult: sr({ organization_identity: "yes" }) }],
    ["structuredResult not object", { structuredResult: "yes" }],
    ["structuredResult null", { structuredResult: null }],
  ];
  it.each(cases)("%s -> needs_human", (_name, over) => {
    const r = evaluateCallResult(intent, passingSnapshot(over));
    expect(r.caseState).toBe("needs_human");
    expect(r.disposition).not.toBe("confirmed");
    expect(r.disposition).not.toBe("denied");
    expect(r.failedGates.length).toBeGreaterThan(0);
  });

  it("exactly at threshold confirms", () => {
    const r = evaluateCallResult(intent, passingSnapshot({ confidenceScore: CONFIDENCE_THRESHOLD }));
    expect(r.disposition).toBe("confirmed");
  });
});

describe("evaluateCallResult — distinct non-answer dispositions", () => {
  it("unable_to_verify stays distinct", () => {
    const r = evaluateCallResult(
      intent,
      passingSnapshot({ structuredResult: sr({ change_request_status: "unable_to_verify" }) }),
    );
    expect(r.disposition).toBe("unable_to_verify");
    expect(r.caseState).toBe("needs_human");
  });

  it("recipient opt-out is a refusal, not a denial", () => {
    const r = evaluateCallResult(
      intent,
      passingSnapshot({ structuredResult: sr({ recipient_opt_out: "yes" }) }),
    );
    expect(r.disposition).toBe("refused");
    expect(r.caseState).toBe("needs_human");
  });

  it("sensitive-data flag invalidates the result", () => {
    const r = evaluateCallResult(
      intent,
      passingSnapshot({ structuredResult: sr({ sensitive_data_disclosed: "yes" }) }),
    );
    expect(r.disposition).toBe("sensitive_data");
    expect(r.caseState).toBe("needs_human");
  });

  it("sensitive data inside evidence invalidates the result", () => {
    const r = evaluateCallResult(
      intent,
      passingSnapshot({ evidence: ["They said account 987654321 is correct"] }),
    );
    expect(r.disposition).toBe("sensitive_data");
  });

  it.each(["voicemail", "no_answer", "busy", "failed", "canceled"])(
    "provider status %s is unreachable, not denied",
    (status) => {
      const r = evaluateCallResult(intent, passingSnapshot({ status }));
      expect(r.disposition).toBe("unreachable");
      expect(r.caseState).toBe("needs_human");
    },
  );
});
