import type { CaseView } from "../app.js";

export type FraudLevel = "low" | "medium" | "high";

export interface FraudFlag {
  severity: "info" | "warn" | "high";
  message: string;
}

export interface FraudAssessment {
  level: FraudLevel;
  /** 0-100 risk score (higher = more suspicious). */
  score: number;
  flags: FraudFlag[];
  /** One-line summary suitable for the report / Slack. */
  summary: string;
}

export interface FraudContext {
  /** Policy coverage limit, if known (for over-coverage detection). */
  coverageLimit?: number | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function parseDate(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/**
 * Cross-party consistency / fraud-risk assessment. It never accuses — it only
 * surfaces contradictions across the structured results ClaimLine already
 * gathered (claimant vs. doctor vs. billing vs. repair), so a human can look
 * closer. Every flag is explainable and evidence-based; the human still decides.
 */
export function assessFraud(view: CaseView, ctx: FraudContext = {}): FraudAssessment {
  // Collect the first completed structured result per call type.
  const byType = new Map<string, Record<string, unknown>>();
  let unreached = 0;
  let reached = 0;
  const rows = [
    ...view.contacts.map((c) => ({ intent: c.intent, result: c.result })),
    ...view.otherCalls.map((c) => ({ intent: c.intent, result: c.result })),
  ];
  for (const { intent, result } of rows) {
    if (!intent) continue;
    if (result?.disposition === "auto_ok" && result.structuredResult) {
      reached += 1;
      if (!byType.has(intent.callType)) byType.set(intent.callType, result.structuredResult);
    } else if (intent.state === "needs_human") {
      unreached += 1;
    }
  }

  const fnol = byType.get("fnol_intake");
  const medical = byType.get("medical_report");
  const bill = byType.get("bill_verification");
  const status = byType.get("status_chase");

  const flags: FraudFlag[] = [];
  let score = 0;
  const add = (points: number, severity: FraudFlag["severity"], message: string) => {
    score += points;
    flags.push({ severity, message });
  };

  // 1. Doctor says the injuries are NOT consistent with the incident.
  if (medical && str(medical.accident_consistent) === "no") {
    add(55, "high", "Treating doctor reports the injuries are NOT consistent with the stated incident.");
  }

  // 2. Claimant reported no injuries, but a medical report describes injuries.
  if (fnol && str(fnol.injuries) === "no" && medical && str(medical.injuries_summary)) {
    add(30, "warn", "Claimant reported no injuries, but a medical report describes treated injuries.");
  }

  // 3. Billed service date precedes the incident date (impossible).
  const incidentAt = parseDate(fnol?.incident_datetime);
  const serviceFrom = parseDate(bill?.service_from_date);
  if (incidentAt !== null && serviceFrom !== null && serviceFrom < incidentAt) {
    add(50, "high", "A billed service date is BEFORE the incident date.");
  }

  // 4. Billed total exceeds the policy coverage limit.
  const billed = num(bill?.total_amount);
  const limit = ctx.coverageLimit ?? null;
  if (billed !== null && limit !== null && billed > limit) {
    add(
      30,
      "warn",
      `Billed total (${billed}) exceeds the policy coverage limit (${limit}).`,
    );
  }

  // 5. Third party involved but no police report filed.
  if (
    fnol &&
    str(fnol.other_party_involved) === "yes" &&
    str(fnol.police_report_filed) === "no"
  ) {
    add(15, "warn", "A third party was involved but no police report was filed.");
  }

  // 6. Bill vs. repair estimate differ sharply (both present).
  const repair = num(status?.estimated_cost_amount);
  if (billed !== null && repair !== null && repair > 0 && billed > 0) {
    const ratio = Math.max(billed, repair) / Math.min(billed, repair);
    if (ratio >= 3) {
      add(15, "warn", "The billed amount and the repair estimate differ significantly.");
    }
  }

  // 7. Evidence gap: some parties could not be reached (lowers confidence).
  if (unreached > 0 && reached > 0) {
    add(8, "info", `${unreached} part${unreached === 1 ? "y" : "ies"} could not be reached — verify manually.`);
  }

  const level: FraudLevel = score >= 50 ? "high" : score >= 20 ? "medium" : "low";
  const summary =
    flags.length === 0
      ? "No inconsistencies detected across the parties called."
      : `${flags.length} signal${flags.length === 1 ? "" : "s"} to review (${level.toUpperCase()} risk).`;

  return { level, score, flags, summary };
}
