// File: src/lib/extract.ts
// Deterministic core. Imports nothing outward (types only).
//
// WHY THIS EXISTS (verified live against api.heycall-e.com, 2026-09-14):
//   The CALL-E API on the current tier REJECTS structured extraction at call-create time:
//     - `result_schema`            -> 400 "result_schema is not supported"
//     - `recipient_result_schema`  -> 400 "recipient_result_schema is not supported"
//   The OpenAPI spec and @call-e/calle SDK types still expose these fields, but the server
//   will not accept them. So on the LIVE path we cannot ask CALL-E to return a typed
//   RecipientResult; we only get back what CALL-E DOES return: a recipient `summary`,
//   `transcript_turns`, `completion_confidence`, and `evidence`.
//
//   This module derives a RecipientResult from that free text, CONSERVATIVELY. The
//   no-fabricated-quotes invariant is load-bearing: if no cash price is confidently found,
//   we return outcome "unknown" with quote_given=false and cash_price=null. We NEVER invent
//   a number. Confidence gating in normalize.ts still applies downstream.
import type { RecipientResult, PriceBasis, Outcome } from "@/lib/schemas";
import type { CallRecipient, TranscriptTurn } from "@/lib/calle-types";

// A cash price: 3+ digit run, optional leading $, optional thousands commas. We deliberately
// require 3+ digits so we don't latch onto "code 72148"-style small artifacts or "$5" noise.
// (72148 is 5 digits so it CAN match the raw regex; the code-guard below removes it.)
const PRICE_RE = /\$?\s?([0-9][0-9,]{2,}(?:\.[0-9]{2})?)\b/g;

const ALL_INCLUSIVE_KEYWORDS = ["all-inclusive", "all inclusive", "everything included", "includes the read", "read is included", "including the radiologist"];
const FACILITY_KEYWORDS = ["facility fee", "facility only", "facility charge", "scan fee"];
const PROFESSIONAL_KEYWORDS = ["reading fee", "professional fee", "radiologist read", "read separately", "reads separately", "bills separately"];
const REFUSED_KEYWORDS = ["won't quote", "will not quote", "can't give a price", "cannot give a price", "no quotes over the phone", "we don't quote"];
const CONSULT_KEYWORDS = ["consult first", "come in first", "physician order", "need a referral", "in-person", "in person", "book a consult"];
const VOICEMAIL_KEYWORDS = ["leave a message", "voicemail", "we're closed", "after the tone", "please call back"];

function turnsOf(rec: CallRecipient): TranscriptTurn[] {
  return rec.attempts.flatMap((a) => a.transcript_turns ?? []);
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

// Strip a known CPT/procedure code from text so it can't be mistaken for a price.
function stripCode(text: string, code?: string): string {
  if (!code) return text;
  return text.split(code).join(" ");
}

interface PriceHit {
  value: number;
  turn: TranscriptTurn | null;
  text: string; // the sentence/summary the price was found in
}

// Find the first confident cash-price hit, preferring a transcript turn (for verbatim).
function findPrice(rec: CallRecipient, code?: string): PriceHit | null {
  const turns = turnsOf(rec);
  for (const turn of turns) {
    const hit = matchPrice(stripCode(turn.text, code));
    if (hit !== null) return { value: hit, turn, text: turn.text };
  }
  if (rec.summary) {
    const hit = matchPrice(stripCode(rec.summary, code));
    if (hit !== null) return { value: hit, turn: null, text: rec.summary };
  }
  return null;
}

function matchPrice(text: string): number | null {
  PRICE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PRICE_RE.exec(text)) !== null) {
    const raw = m[1].replace(/,/g, "");
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 100) return value;
  }
  return null;
}

function detectBasis(text: string): PriceBasis {
  const lower = text.toLowerCase();
  if (containsAny(lower, ALL_INCLUSIVE_KEYWORDS)) return "all_inclusive";
  if (containsAny(lower, FACILITY_KEYWORDS)) return "facility_only";
  if (containsAny(lower, PROFESSIONAL_KEYWORDS)) return "professional_only";
  return "unknown";
}

function detectNoQuoteOutcome(rec: CallRecipient): Outcome {
  const blob = [rec.summary ?? "", ...turnsOf(rec).map((t) => t.text)].join(" ").toLowerCase();
  if (containsAny(blob, VOICEMAIL_KEYWORDS)) return "voicemail";
  if (containsAny(blob, CONSULT_KEYWORDS)) return "needs_consult";
  if (containsAny(blob, REFUSED_KEYWORDS)) return "refused";
  return "unknown";
}

const UNKNOWN_RESULT: RecipientResult = {
  reached_billing: false,
  quote_given: false,
  cash_price: null,
  currency: "USD",
  price_basis: "unknown",
  includes: [],
  excludes: [],
  requires_consult_first: false,
  estimate_valid_days: null,
  earliest_appointment_days: null,
  cpt_or_code_confirmed: null,
  quoted_verbatim: null,
  outcome: "unknown",
};

/**
 * Derive a RecipientResult from CALL-E's free-text return (summary + transcript_turns).
 * Conservative by design: if no confident cash price is found, returns an "unknown"
 * no-quote result. Never fabricates a number and never sets quote_given=true without a price.
 *
 * @param rec  mapped recipient (see calle-types.ts)
 * @param code optional procedure/CPT code to exclude from price matching (e.g. "72148")
 */
export function extractRecipientResult(rec: CallRecipient, code?: string): RecipientResult {
  const priceHit = findPrice(rec, code);

  if (priceHit === null) {
    const outcome = detectNoQuoteOutcome(rec);
    const requiresConsult = outcome === "needs_consult";
    return { ...UNKNOWN_RESULT, requires_consult_first: requiresConsult, outcome };
  }

  const basis = detectBasis(priceHit.text);
  const verbatim = priceHit.turn?.text ?? priceHit.text;

  return {
    reached_billing: true,
    quote_given: true,
    cash_price: priceHit.value,
    currency: "USD",
    price_basis: basis,
    includes: [],
    excludes: [],
    requires_consult_first: false,
    estimate_valid_days: null,
    earliest_appointment_days: null,
    cpt_or_code_confirmed: code ?? null,
    quoted_verbatim: verbatim,
    outcome: "quoted",
  };
}
