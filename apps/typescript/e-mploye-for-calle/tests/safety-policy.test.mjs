import { describe, expect, it } from "vitest";
import { evaluateCallSafety, isE164, maskPhone, sanitizeError, sanitizeSensitiveData, sanitizeText } from "../server/safety-policy.mjs";

const employee = { phone: "+14155550101" };
const task = "Call the employee about the proposed shift and ask whether they can work it.";

describe("call safety policy", () => {
  it("validates and masks E.164 numbers", () => {
    expect(isE164("+14155550101")).toBe(true);
    expect(isE164("555-0101")).toBe(false);
    expect(maskPhone("+14155550101")).toContain("•");
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
    const rawPhone = "+14155550106";
    const sanitized = sanitizeSensitiveData({
      phone: rawPhone,
      phoneNumber: "415-555-0104",
      recipientPhone: 14155550106,
      nested: {
        phones: [rawPhone],
        transcript_turns: [{ text: `The number is ${rawPhone}.` }],
        evidence: [{ detail: rawPhone, numeric: 14155550106 }],
        result: { contact_message: `Call ${rawPhone}`, phone_number: rawPhone },
      },
      authorization: "Bearer test-secret",
    });

    expect(JSON.stringify(sanitized)).not.toContain(rawPhone);
    expect(sanitized.phone).toBe(maskPhone(rawPhone));
    expect(sanitized.phoneNumber).toBe("[phone masked]");
    expect(sanitized.recipientPhone).toBe("[phone masked]");
    expect(sanitized.nested.transcript_turns[0].text).toContain("+141•••••106");
    expect(sanitized.nested.evidence[0].numeric).toBe("[phone masked]");
    expect(sanitized.authorization).toBe("[redacted]");
    expect(sanitizeText("Call (415) 555-0107")).toContain("[phone masked]");
    expect(sanitizeText("Call 14155550106")).toContain("[phone masked]");
    expect(sanitizeText("https://example.test/call?phone=%2B14155550106")).not.toContain("14155550106");
    expect(sanitizeText("job_1788605144770_b12483")).toBe("job_1788605144770_b12483");
    expect(sanitizeError("CALL-E rejected Bearer private-token for +14155550106")).not.toContain("private-token");
  });
});
