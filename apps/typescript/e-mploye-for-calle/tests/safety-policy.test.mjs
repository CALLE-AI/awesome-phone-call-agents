import { describe, expect, it } from "vitest";
import { evaluateCallSafety, isE164, maskPhone, sanitizeError, sanitizeSensitiveData, sanitizeText } from "../server/safety-policy.mjs";

const employee = { phone: "+15550101001" };
const task = "Call the employee about the proposed shift and ask whether they can work it.";

describe("call safety policy", () => {
  it("validates and masks E.164 numbers", () => {
    expect(isE164("+15550101001")).toBe(true);
    expect(isE164("555-0101")).toBe(false);
    expect(maskPhone("+15550101001")).toContain("•");
  });

  it("requires explicit manager approval and idempotency", () => {
    expect(evaluateCallSafety({ employee, task })).toMatchObject({ ok: false, reason: "safety:manager_approval_required" });
    expect(evaluateCallSafety({ employee, task, managerApproved: true })).toMatchObject({ ok: false, reason: "safety:idempotency_key_required" });
  });

  it("blocks sensitive data and recurring calls", () => {
    expect(evaluateCallSafety({ employee, task: `${task} Never say the API key.`, managerApproved: true, idempotencyKey: "job-1" })).toMatchObject({ ok: false, reason: "safety:sensitive_data_in_task" });
    expect(evaluateCallSafety({ employee, task, managerApproved: true, idempotencyKey: "job-1", recurring: true })).toMatchObject({ ok: false, reason: "safety:recurring_calls_not_supported" });
  });

  it("blocks restricted medical, legal, financial, and emergency tasks", () => {
    expect(evaluateCallSafety({ employee, task: "Call the patient about a prescription.", managerApproved: true, idempotencyKey: "job-1" })).toMatchObject({ ok: false, reason: "safety:restricted_high_risk_use_case" });
    expect(evaluateCallSafety({ employee, task: "Call about an emergency and dispatch an ambulance.", managerApproved: true, idempotencyKey: "job-2" })).toMatchObject({ ok: false, reason: "safety:restricted_high_risk_use_case" });
  });

  it("recursively masks phones and credentials in result-like data", () => {
    const rawPhone = "+15551234567";
    const sanitized = sanitizeSensitiveData({
      phone: rawPhone,
      phoneNumber: "415-555-2671",
      recipientPhone: 15551234567,
      nested: {
        phones: [rawPhone],
        transcript_turns: [{ text: `The number is ${rawPhone}.` }],
        evidence: [{ detail: rawPhone, numeric: 15551234567 }],
        result: { contact_message: `Call ${rawPhone}`, phone_number: rawPhone },
      },
      authorization: "Bearer test-secret",
    });

    expect(JSON.stringify(sanitized)).not.toContain(rawPhone);
    expect(sanitized.phone).toBe(maskPhone(rawPhone));
    expect(sanitized.phoneNumber).toBe("[phone masked]");
    expect(sanitized.recipientPhone).toBe("[phone masked]");
    expect(sanitized.nested.transcript_turns[0].text).toContain("+155•••••567");
    expect(sanitized.nested.evidence[0].numeric).toBe("[phone masked]");
    expect(sanitized.authorization).toBe("[redacted]");
    expect(sanitizeText("Call (415) 555-2671")).toContain("[phone masked]");
    expect(sanitizeText("Call 15551234567")).toContain("[phone masked]");
    expect(sanitizeText("https://example.test/call?phone=%2B15551234567")).not.toContain("15551234567");
    expect(sanitizeText("job_1788605144770_b12483")).toBe("job_1788605144770_b12483");
    expect(sanitizeError("CALL-E rejected Bearer private-token for +15551234567")).not.toContain("private-token");
  });
});
