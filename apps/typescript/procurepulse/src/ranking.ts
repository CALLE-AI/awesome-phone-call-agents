import { QUOTE_FIELDS, type QuoteResult } from "./schema.ts";

/**
 * Turning spoken quotes into a comparison. A comparable total exists only when quantity,
 * unit, availability, currency, unit price and fees are all unambiguous; anything vaguer
 * becomes "needs review" with the specific reasons and stays out of the ranking. Nothing
 * here asks a model for a number, and the same inputs always rank the same way.
 */
export type RankingStatus = "eligible" | "needs_review" | "excluded";

export interface Analysis {
  warnings: string[];
  comparableTotal: number | null;
  status: RankingStatus;
}

export interface RankedQuote extends Analysis {
  vendorId: string;
  vendorName: string;
  quote: QuoteResult;
  completeness: number;
}

/** Share of fields the supplier actually answered. Separate from CALL-E's own certainty. */
export function completeness(quote: QuoteResult): number {
  const answered = QUOTE_FIELDS.filter((f) => quote[f].trim() !== "" && quote[f] !== "unknown").length;
  return Math.round((answered / QUOTE_FIELDS.length) * 100);
}

const UNITS: Record<string, string> = {
  kg: "kg", kilogram: "kg", kilograms: "kg", kilo: "kg", kilos: "kg",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  each: "each", unit: "each", units: "each",
};
const STRICT_NUMBER = /^\d+(?:\.\d+)?$/;
const amount = (value: string) => (STRICT_NUMBER.test(value.trim()) ? Number(value.trim()) : null);
/** Whole words only: "verified" must not read as "if". */
const HEDGE = /\b(if|may|might|subject to|depend\w*|estimate\w*|approx\w*|about|around|plus tax)\b/i;

export function analyzeQuote(quote: QuoteResult, requestedQuantity: string): Analysis {
  if (quote.reached !== "yes" || quote.item_match === "unavailable")
    return { warnings: ["Supplier did not provide an available quote."], comparableTotal: null, status: "excluded" };

  const warnings: string[] = [];
  const requested = requestedQuantity.trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/);
  const requestedAmount = requested ? Number(requested[1]) : null;
  const requestedUnit = requested ? UNITS[requested[2]!.toLowerCase()] : undefined;
  const quoteUnit = UNITS[quote.unit.trim().toLowerCase()];
  const available = amount(quote.available_quantity);
  const price = amount(quote.unit_price);
  const fees = amount(quote.extra_fees);

  if (!requestedAmount || !requestedUnit || !quoteUnit || requestedUnit !== quoteUnit)
    warnings.push("Ambiguous or incompatible quantity unit.");
  if (available === null || (requestedAmount !== null && available < requestedAmount))
    warnings.push("Available quantity does not cover the request.");
  if (price === null || fees === null || !/^[A-Z]{3}$/.test(quote.currency))
    warnings.push("Price, fees, or currency need review.");
  if (HEDGE.test(quote.conditions)) warnings.push("Price or fulfillment is conditional.");
  if (quote.certainty === "low" || quote.certainty === "unknown") warnings.push("CALL-E reported low answer certainty.");

  if (warnings.length || requestedAmount === null || price === null || fees === null)
    return { warnings, comparableTotal: null, status: "needs_review" };
  return { warnings, comparableTotal: Math.round((requestedAmount * price + fees) * 100) / 100, status: "eligible" };
}

/** Lowest complete total and earliest parseable ready time; supplier name breaks ties. */
export function rankQuotes(quotes: RankedQuote[]): { cheapest: string | null; earliest: string | null } {
  const eligible = quotes.filter((q) => q.status === "eligible");
  const cheapest = [...eligible].sort(
    (a, b) => a.comparableTotal! - b.comparableTotal! || a.vendorName.localeCompare(b.vendorName),
  )[0];
  const earliest = eligible
    .filter((q) => !Number.isNaN(Date.parse(q.quote.ready_at)))
    .sort((a, b) => Date.parse(a.quote.ready_at) - Date.parse(b.quote.ready_at) || a.vendorName.localeCompare(b.vendorName))[0];
  return { cheapest: cheapest?.vendorId ?? null, earliest: earliest?.vendorId ?? null };
}
