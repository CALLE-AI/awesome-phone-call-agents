// File: src/lib/normalize.ts
// Deterministic core. No network, no store, no Next. Enforces INVARIANTS 1-3 structurally.
import type { RecipientResult, TaskRollup } from "@/lib/schemas";
import type { CallTask, CallRecipient } from "@/lib/calle-types";

export const CONFIDENCE_THRESHOLD = 0.6;

export type RowStatus = "ranked" | "non_comparable" | "needs_review" | "no_quote";
export type RejectionCode =
  | "NO_EVIDENCE"
  | "LOW_CONFIDENCE"
  | "NON_COMPARABLE"
  | "NO_QUOTE"
  | null;

export interface FairPriceEntry {
  label: string;
  national_average: number;
  fair_self_pay: number;
  low: number;
  high: number;
}
export interface FairPrices {
  source: string;
  updated: string;
  procedures: Record<string, FairPriceEntry>;
}

export interface Benchmark {
  code: string;
  label: string | null;
  fair_self_pay: number | null;
  national_average: number | null;
  winner_landed: number | null;
  pct_vs_fair: number | null; // negative = below fair (good)
  pct_vs_national: number | null;
}

export interface EvidenceRef {
  quoted_verbatim: string;
  offset_seconds: number | null;
  speaker: string | null;
}

export interface NormalizedResult {
  name: string;
  phone: string | null;
  status: RowStatus;
  rejection: RejectionCode;
  ranked: boolean;
  comparable: boolean;
  landed_cost: number | null;
  price_basis: RecipientResult["price_basis"] | null;
  includes: string[];
  excludes: string[];
  requires_consult_first: boolean;
  earliest_appointment_days: number | null;
  confidence_score: number | null;
  confidence_label: string | null;
  pct_vs_fair: number | null;
  quoted_verbatim: string | null;
  evidence: EvidenceRef | null;
  summary: string | null;
}

export interface NormalizedRfq {
  status: CallTask["status"];
  results: NormalizedResult[];
  rollup: TaskRollup;
  benchmark: Benchmark;
}

function findEvidence(recipient: CallRecipient, verbatim: string | null | undefined): EvidenceRef | null {
  if (!verbatim) return null;
  const needle = verbatim.trim().toLowerCase();
  for (const attempt of recipient.attempts ?? []) {
    for (const turn of attempt.transcript_turns ?? []) {
      if (turn.text && turn.text.toLowerCase().includes(needle.slice(0, Math.min(needle.length, 24)))) {
        return { quoted_verbatim: verbatim, offset_seconds: turn.offset_seconds, speaker: turn.speaker };
      }
    }
  }
  // verbatim present but not traceable to a turn -> return the verbatim without a turn ref
  return { quoted_verbatim: verbatim, offset_seconds: null, speaker: null };
}

function landedCost(r: RecipientResult): { landed: number | null; comparable: boolean } {
  // Sanity floor: a price <= 0 is never a real quote, so it is never comparable/ranked.
  const price = typeof r.cash_price === "number" && r.cash_price > 0 ? r.cash_price : null;
  if (price === null) return { landed: null, comparable: false };
  if (r.price_basis === "all_inclusive") {
    return { landed: price, comparable: true };
  }
  // facility_only / professional_only: only a single leg captured here -> partial, non-comparable
  if (r.price_basis === "facility_only" || r.price_basis === "professional_only") {
    return { landed: price, comparable: false };
  }
  return { landed: null, comparable: false };
}

function normalizeRecipient(
  recipient: CallRecipient,
  confidence: number | null,
  confidenceLabel: string | null,
  fair: FairPriceEntry | null
): NormalizedResult {
  const r: RecipientResult | null = recipient.structured_result;
  const base: NormalizedResult = {
    name: recipient.name ?? recipient.phone ?? "Unknown clinic",
    phone: recipient.phone ?? null,
    status: "no_quote",
    rejection: "NO_QUOTE",
    ranked: false,
    comparable: false,
    landed_cost: null,
    price_basis: null,
    includes: [],
    excludes: [],
    requires_consult_first: false,
    earliest_appointment_days: null,
    confidence_score: confidence,
    confidence_label: confidenceLabel,
    pct_vs_fair: null,
    quoted_verbatim: null,
    evidence: null,
    summary: recipient.summary ?? null,
  };

  // K9: null structured_result -> unknown, no_quote bucket, never crash.
  if (!r) return base;

  base.price_basis = r.price_basis ?? "unknown";
  base.includes = r.includes ?? [];
  base.excludes = r.excludes ?? [];
  base.requires_consult_first = !!r.requires_consult_first;
  base.earliest_appointment_days = r.earliest_appointment_days ?? null;
  base.quoted_verbatim = r.quoted_verbatim ?? null;

  // INVARIANT 2: confidence gate (fail-closed).
  if (r.outcome !== "quoted") {
    base.status = "no_quote";
    base.rejection = "NO_QUOTE";
    return base;
  }
  if (confidence !== null && confidence < CONFIDENCE_THRESHOLD) {
    base.status = "needs_review";
    base.rejection = "LOW_CONFIDENCE";
    return base;
  }

  const { landed, comparable } = landedCost(r);
  base.landed_cost = landed;
  base.comparable = comparable;

  // INVARIANT 3: only all_inclusive complete quotes are comparable/rankable.
  if (!comparable) {
    base.status = "non_comparable";
    base.rejection = "NON_COMPARABLE";
    return base;
  }

  // INVARIANT 1 (structural): ranked requires a non-empty quoted_verbatim that traces to a
  // real transcript turn. offset_seconds === null means the verbatim matched no turn, so it
  // is not a traceable utterance and must not be ranked.
  const evidence = findEvidence(recipient, r.quoted_verbatim);
  if (
    !evidence ||
    !evidence.quoted_verbatim ||
    evidence.quoted_verbatim.trim() === "" ||
    evidence.offset_seconds === null
  ) {
    base.status = "non_comparable";
    base.rejection = "NO_EVIDENCE";
    return base;
  }

  base.evidence = evidence;
  base.status = "ranked";
  base.rejection = null;
  base.ranked = true;

  if (fair && typeof landed === "number") {
    base.pct_vs_fair = Math.round(((landed - fair.fair_self_pay) / fair.fair_self_pay) * 100);
  }
  return base;
}

export function normalizeCallTask(task: CallTask, fairPrices: FairPrices, code: string): NormalizedRfq {
  const fair = fairPrices.procedures[code] ?? null;
  const confidence = task.completion_confidence?.score ?? null;
  const confidenceLabel = task.completion_confidence?.label ?? null;

  const results = (task.recipients ?? []).map((rec) =>
    normalizeRecipient(rec, confidence, confidenceLabel, fair)
  );

  // Rank ascending by landed cost among ranked rows; sort ranked first.
  const ranked = results.filter((x) => x.ranked).sort((a, b) => (a.landed_cost! - b.landed_cost!));
  const rest = results.filter((x) => !x.ranked);
  const ordered = [...ranked, ...rest];

  const winner = ranked[0] ?? null;
  const rollup: TaskRollup = task.structured_result ?? {
    clinics_reached: results.filter((r) => r.status !== "no_quote" || r.summary !== null).length,
    quotes_obtained: ranked.length,
    lowest_all_inclusive: winner ? winner.landed_cost : null,
  };

  const benchmark: Benchmark = {
    code,
    label: fair?.label ?? null,
    fair_self_pay: fair?.fair_self_pay ?? null,
    national_average: fair?.national_average ?? null,
    winner_landed: winner?.landed_cost ?? null,
    pct_vs_fair: winner?.pct_vs_fair ?? null,
    pct_vs_national:
      fair && winner && typeof winner.landed_cost === "number"
        ? Math.round(((winner.landed_cost - fair.national_average) / fair.national_average) * 100)
        : null,
  };

  return { status: task.status, results: ordered, rollup, benchmark };
}
