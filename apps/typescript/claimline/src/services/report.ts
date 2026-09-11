import type { CaseView } from "../app.js";
import type { Payment } from "../domain/types.js";
import type { FraudAssessment } from "./fraud.js";

export interface ReportParty {
  name: string;
  role: string;
  callType: string;
  status: string;
  summary: string | null;
}

export interface CaseReport {
  reference: string;
  title: string;
  /** Human-readable body suitable for Slack/Teams or the dashboard. */
  text: string;
  structured: {
    reference: string;
    policyholder: string;
    incidentType: string;
    parties: ReportParty[];
    callsMade: number;
    needsReview: number;
    billedTotal: number | null;
    currency: string | null;
    decision: string | null;
    sanctionedAmount: number | null;
    payment: { status: string; provider: string; reference: string } | null;
    fraud: { level: string; score: number; flags: string[] } | null;
    generatedAt: string;
  };
}

const STATE_LABEL: Record<string, string> = {
  reserved: "queued",
  submission_unknown: "submitting",
  accepted: "in progress",
  terminal_unverified: "reviewing",
  terminal_verified: "completed",
  needs_human: "needs review",
  applied: "reviewed",
  canceled: "canceled",
};

function human(value: string): string {
  return value.replace(/_/g, " ");
}

/** Build a consolidated end-of-case report from an aggregated case view. */
export function buildCaseReport(
  view: CaseView,
  payment?: Payment | null,
  fraud?: FraudAssessment | null,
): CaseReport {
  const parties: ReportParty[] = view.contacts
    .filter((c) => c.intent) // only parties that were actually called
    .map((c) => ({
      name: c.contact.name,
      role: human(c.contact.role),
      callType: human(c.intent!.callType),
      status: STATE_LABEL[c.intent!.state] ?? human(c.intent!.state),
      summary: c.result?.summary ?? null,
    }));

  const callsMade = parties.length;
  const needsReview = parties.filter((p) => p.status === "needs review").length;
  const decision = view.claimDecision?.decision ?? null;

  const lines: string[] = [];
  lines.push(
    `Claim ${view.claim.reference} — ${view.claim.policyholderName} (${human(view.claim.incidentType)})`,
  );
  lines.push(`Calls made: ${callsMade}${needsReview ? ` · ${needsReview} need review` : ""}`);
  for (const p of parties) {
    const tail = p.summary ? ` — ${p.summary}` : "";
    lines.push(`• ${p.name} (${p.role}, ${p.callType}): ${p.status}${tail}`);
  }
  if (view.totals.billedTotal !== null) {
    lines.push(
      `Total billed gathered: ${view.totals.billedTotal} ${view.totals.currency ?? ""}`.trim() +
        (view.totals.incomplete ? " (incomplete)" : ""),
    );
  }
  if (view.claimDecision) {
    const amt =
      view.claimDecision.sanctionedAmount !== null
        ? ` ${view.claimDecision.sanctionedAmount} ${view.claimDecision.currency ?? ""}`.trimEnd()
        : "";
    lines.push(`Decision: ${view.claimDecision.decision}${amt} (by ${view.claimDecision.decidedBy})`);
  } else {
    lines.push("Decision: pending human review");
  }
  if (payment) {
    lines.push(
      `Payout: ${payment.status} — ${payment.amount} ${payment.currency} via ${payment.provider} (${payment.reference})`,
    );
  }
  if (fraud && fraud.flags.length > 0) {
    lines.push(`Fraud risk: ${fraud.level.toUpperCase()} (score ${fraud.score})`);
    for (const f of fraud.flags) lines.push(`  ⚠ ${f.message}`);
  } else if (fraud) {
    lines.push("Fraud risk: LOW — no inconsistencies detected.");
  }

  return {
    reference: view.claim.reference,
    title: `ClaimLine report — ${view.claim.reference}`,
    text: lines.join("\n"),
    structured: {
      reference: view.claim.reference,
      policyholder: view.claim.policyholderName,
      incidentType: view.claim.incidentType,
      parties,
      callsMade,
      needsReview,
      billedTotal: view.totals.billedTotal,
      currency: view.totals.currency,
      decision,
      sanctionedAmount: view.claimDecision?.sanctionedAmount ?? null,
      payment: payment
        ? { status: payment.status, provider: payment.provider, reference: payment.reference }
        : null,
      fraud: fraud
        ? { level: fraud.level, score: fraud.score, flags: fraud.flags.map((f) => f.message) }
        : null,
      generatedAt: new Date().toISOString(),
    },
  };
}
