import { createHash } from "node:crypto";
import type { DecisionReason, FailedVisitCase, PreCallAssessment } from "./case.js";

const E164 = /^\+[1-9]\d{7,14}$/;

export class SuppressionRegistry {
  readonly #phoneHashes = new Set<string>();

  isSuppressed(phoneE164: string): boolean {
    return this.#phoneHashes.has(hashPhone(phoneE164));
  }

  suppress(phoneE164: string): void {
    this.#phoneHashes.add(hashPhone(phoneE164));
  }

  get size(): number {
    return this.#phoneHashes.size;
  }
}

export function hashPhone(phoneE164: string): string {
  return createHash("sha256").update(phoneE164).digest("hex");
}

export function assessPreCall(
  failedVisit: FailedVisitCase,
  now: Date,
  suppressions?: Pick<SuppressionRegistry, "isSuppressed">,
): PreCallAssessment {
  const blocked: DecisionReason[] = [];
  const manual: DecisionReason[] = [];

  const riskReasons: Array<[boolean, string, string]> = [
    [failedVisit.riskFlags.technicalOrSafetyDefect, "TECHNICAL_OR_SAFETY_DEFECT", "A technical or site-safety defect cannot be handled by an access call."],
    [failedVisit.riskFlags.hazardousMaterialSuspected, "HAZARDOUS_MATERIAL", "Suspected hazardous material requires specialist review."],
    [failedVisit.riskFlags.lifeSupportOrVulnerability, "LIFE_SUPPORT_OR_VULNERABILITY", "Life-support or vulnerability indicators require a protected human process."],
    [failedVisit.riskFlags.emergencyOrOutage, "EMERGENCY_OR_OUTAGE", "Emergency or outage cases are outside this workflow."],
    [failedVisit.riskFlags.billingOrDisconnectionDispute, "BILLING_OR_DISCONNECTION", "Billing and disconnection disputes are outside this workflow."],
  ];
  for (const [active, code, message] of riskReasons) {
    if (active) blocked.push({ code, message });
  }

  if (!failedVisit.recipient.authorized) {
    blocked.push({ code: "MISSING_AUTHORIZATION", message: "The sole recipient is not an authorized service contact." });
  }
  if (!E164.test(failedVisit.recipient.phoneE164)) {
    blocked.push({ code: "INVALID_E164", message: "The recipient number is not valid E.164." });
  }
  if (suppressions?.isSuppressed(failedVisit.recipient.phoneE164)) {
    blocked.push({ code: "CONTACT_SUPPRESSED", message: "The recipient has opted out of automated contact." });
  }
  if (blocked.length > 0) {
    return { decision: "AUTOMATION_BLOCKED", reasons: blocked, evaluatedAt: now.toISOString() };
  }

  if (failedVisit.sourceFailure.accessControl === "EXTERNAL_PARTY") {
    manual.push({
      code: "EXTERNAL_ACCESS_PARTY",
      message: "Access is controlled by a landlord, body corporate, or other external party; this workflow may not contact them.",
    });
  }
  if (failedVisit.visitWindows.length === 0) {
    manual.push({ code: "NO_VISIT_WINDOWS", message: "There are no approved visit windows to offer." });
  }
  if (manual.length > 0) {
    return { decision: "MANUAL_REVIEW_REQUIRED", reasons: manual, evaluatedAt: now.toISOString() };
  }

  const start = Date.parse(failedVisit.callWindow.start);
  const end = Date.parse(failedVisit.callWindow.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return {
      decision: "AUTOMATION_BLOCKED",
      reasons: [{ code: "INVALID_CALL_WINDOW", message: "The controlled call window is malformed." }],
      evaluatedAt: now.toISOString(),
    };
  }
  if (now.getTime() < start || now.getTime() > end) {
    return {
      decision: "CALL_WINDOW_CLOSED",
      reasons: [{
        code: now.getTime() < start ? "CALL_WINDOW_NOT_OPEN" : "CALL_WINDOW_EXPIRED",
        message: now.getTime() < start ? "The controlled call window has not opened." : "The controlled call window has expired.",
      }],
      evaluatedAt: now.toISOString(),
    };
  }

  return {
    decision: "ELIGIBLE_FOR_CALL",
    reasons: [{ code: "POLICY_CHECKS_PASSED", message: "All deterministic pre-call checks passed." }],
    evaluatedAt: now.toISOString(),
  };
}
