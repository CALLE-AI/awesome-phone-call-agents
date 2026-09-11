import type { Quote } from "./types";

export type Bar = "value" | "cheapest" | "soonest";

// Roughly what a free extra is worth, for value ranking.
const EXTRA_WORTH = 4;

// A quote we can act on: they answered, gave a price, and can meet the request.
function usable(q: Quote): boolean {
  return q.answered && q.price !== null && q.available === "yes";
}

// Lower is better. Price minus the value of what they throw in for free.
export function valueScore(q: Quote): number {
  return (q.price ?? Infinity) - EXTRA_WORTH * q.includes.length;
}

// Rank usable quotes best-first by the chosen bar. ranked[0] is the winner.
export function rankQuotes(quotes: Quote[], bar: Bar): Quote[] {
  return quotes
    .filter(usable)
    .sort((a, b) => {
      if (bar === "soonest") return (a.etaMinutes ?? Infinity) - (b.etaMinutes ?? Infinity);
      if (bar === "cheapest") return (a.price ?? Infinity) - (b.price ?? Infinity);
      return valueScore(a) - valueScore(b); // "value": price adjusted for extras
    });
}
