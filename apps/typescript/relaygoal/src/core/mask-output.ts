// Mask phone-bearing text in a finished outcome before it leaves the server. Applied at the
// API-route boundary, after verification, so a number spoken on a (live) call never reaches the
// browser in the clear — in addition to the recipient number, which is already masked separately.
import { maskPhonesInText } from "./phone";
import type { VerifiedOutcome, VerifiedField, Quote, TranscriptTurn } from "./types";
import type { BatchOutcome } from "./batch";

const maskTurn = (t: TranscriptTurn): TranscriptTurn => ({ ...t, text: maskPhonesInText(t.text) });
const maskQuote = (q: Quote): Quote => ({ ...q, text: maskPhonesInText(q.text) });

const maskField = (f: VerifiedField): VerifiedField => ({
  ...f,
  value: typeof f.value === "string" ? maskPhonesInText(f.value) : f.value,
  quotes: f.quotes.map(maskQuote),
  ...(f.reason !== undefined ? { reason: maskPhonesInText(f.reason) } : {}),
});

export function maskVerifiedOutcome(o: VerifiedOutcome): VerifiedOutcome {
  return {
    ...o,
    summary: maskPhonesInText(o.summary),
    fields: o.fields.map(maskField),
    transcript: o.transcript.map(maskTurn),
    ...(o.advice !== undefined ? { advice: maskPhonesInText(o.advice) } : {}),
  };
}

export function maskBatchOutcome(o: BatchOutcome): BatchOutcome {
  return {
    ...o,
    reason: maskPhonesInText(o.reason),
    items: o.items.map((it) => ({ ...it, outcome: maskVerifiedOutcome(it.outcome) })),
  };
}
