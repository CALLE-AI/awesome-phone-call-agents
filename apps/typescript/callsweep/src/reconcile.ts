import type { Quote } from "./types";

// A quote outcome is ambiguous when the call did not produce a clear,
// comparable answer: no answer / the call did not complete, an "unknown"
// availability, or an answered call that gave no price for a slot it says it
// can do. A definite "no, we can't do it" is NOT ambiguous, it is a clear no.
export function isAmbiguous(q: Quote): boolean {
  if (!q.answered) return true;
  if (q.available === "unknown") return true;
  if (q.available === "yes" && q.price === null) return true;
  return false;
}

// The ambiguous outcomes in a set of quotes. If any exist, the comparison is
// incomplete and the run must halt for human reconciliation rather than book.
export function ambiguousQuotes(quotes: Quote[]): Quote[] {
  return quotes.filter(isAmbiguous);
}
