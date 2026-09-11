import { test, expect } from "bun:test";
import { isAmbiguous, ambiguousQuotes } from "../src/reconcile";
import type { Quote } from "../src/types";

function q(over: Partial<Quote>): Quote {
  return {
    vendor: "Shop", phoneE164: "+14155550101", answered: true, price: 30,
    available: "yes", availableDetail: "today", etaMinutes: 15, includes: [], notes: "",
    ...over,
  };
}

test("a clear priced, available quote is not ambiguous", () => {
  expect(isAmbiguous(q({}))).toBe(false);
});

test("a definite 'no' is a clear outcome, not ambiguous", () => {
  expect(isAmbiguous(q({ available: "no", price: 30 }))).toBe(false);
});

test("no answer, unknown, or answered-with-no-price are ambiguous", () => {
  expect(isAmbiguous(q({ answered: false, price: null }))).toBe(true);
  expect(isAmbiguous(q({ available: "unknown" }))).toBe(true);
  expect(isAmbiguous(q({ available: "yes", price: null }))).toBe(true);
});

test("ambiguousQuotes collects exactly the unclear ones", () => {
  const quotes = [q({ vendor: "A" }), q({ vendor: "B", answered: false, price: null }), q({ vendor: "C", available: "no" })];
  expect(ambiguousQuotes(quotes).map((x) => x.vendor)).toEqual(["B"]);
});
