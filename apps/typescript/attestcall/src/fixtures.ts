/**
 * Deterministic demo fixtures.
 *
 * These return the exact `Call` shape the real CALL-E SDK returns, so demo
 * mode exercises the identical downstream code path (disposition, audit,
 * dashboard) with zero live calls and no credentials. This is what CI runs
 * and what a judge can run out of the box.
 */
import type { Call } from "@call-e/calle";
import type { AttestationRequest } from "./types.js";

export type FixtureScenario =
  | "compliant" // clean attested outcome
  | "non_compliant" // recipient says not compliant
  | "no_consent" // recipient declines recording
  | "low_confidence" // ambiguous, CALL-E unsure
  | "call_failed"; // call did not complete

export const FIXTURE_SCENARIOS: FixtureScenario[] = [
  "compliant",
  "non_compliant",
  "no_consent",
  "low_confidence",
  "call_failed",
];

function baseCall(req: AttestationRequest, overrides: Partial<Call>): Call {
  const now = new Date().toISOString();
  const call: Call = {
    id: "demo_" + Math.random().toString(36).slice(2, 12),
    object: "call_task",
    status: "completed",
    task: `Attestation call to ${req.vendorName} for ${req.framework}`,
    recipients: [
      {
        id: "rcp_demo",
        phones: [req.vendorPhone],
        locale: req.locale ?? "en-US",
        region: req.region ?? "US",
        status: "completed",
        structuredResult: null,
        summary: null,
        attempts: [],
      },
    ],
    structuredResult: null,
    summary: null,
    taskCompleted: true,
    completionConfidence: { score: 0.93, label: "high" },
    evidence: [],
    metadata: { app: "attestcall", framework: req.framework },
    failureCode: null,
    failureMessage: null,
    createdAt: now,
    completedAt: now,
    ...overrides,
  };
  return call;
}

export function loadFixture(scenario: string, req: AttestationRequest): Call {
  switch (scenario as FixtureScenario) {
    case "non_compliant":
      return baseCall(req, {
        structuredResult: {
          is_compliant: "no",
          cert_expiry_date: null,
          auditor_name: null,
          attesting_contact: "Dana Lee, Security Lead",
          consent_to_record: "yes",
          scope_caveats: "Certification lapsed last quarter; renewal in progress.",
        },
        completionConfidence: { score: 0.9, label: "high" },
        evidence: [
          "The contact said: 'We are not currently certified; our renewal audit is scheduled for next month.'",
        ],
        summary: "Recipient stated the organization is not currently compliant; renewal in progress.",
      });

    case "no_consent":
      return baseCall(req, {
        structuredResult: {
          is_compliant: "unknown",
          cert_expiry_date: null,
          auditor_name: null,
          attesting_contact: null,
          consent_to_record: "no",
          scope_caveats: null,
        },
        completionConfidence: { score: 0.88, label: "high" },
        evidence: ["The contact declined to have the attestation recorded."],
        summary: "Recipient did not consent to recording; no attestation captured.",
      });

    case "low_confidence":
      return baseCall(req, {
        structuredResult: {
          is_compliant: "yes",
          cert_expiry_date: null,
          auditor_name: null,
          attesting_contact: null,
          consent_to_record: "yes",
          scope_caveats: "Person was unsure and said to 'check with the compliance team'.",
        },
        completionConfidence: { score: 0.42, label: "low" },
        evidence: [],
        summary: "Ambiguous answers; recipient unsure. Routed to human review.",
      });

    case "call_failed":
      return baseCall(req, {
        status: "failed",
        taskCompleted: false,
        completionConfidence: null,
        structuredResult: null,
        evidence: [],
        failureCode: "no_answer",
        failureMessage: "Recipient did not answer after retries.",
        completedAt: null,
        summary: null,
      });

    case "compliant":
    default:
      return baseCall(req, {
        structuredResult: {
          is_compliant: "yes",
          cert_expiry_date: "2026-11-30",
          auditor_name: "Meridian Assurance LLP",
          attesting_contact: "Priya Nair, Compliance Officer",
          consent_to_record: "yes",
          scope_caveats: null,
        },
        completionConfidence: { score: 0.94, label: "high" },
        evidence: [
          "The contact confirmed: 'Yes, we are currently PCI DSS compliant, valid through the end of November 2026, audited by Meridian Assurance.'",
          "The contact identified herself as Priya Nair, Compliance Officer, and consented to recording.",
        ],
        summary:
          "Recipient attested current compliance, provided expiry date and auditor, and consented to recording.",
      });
  }
}
