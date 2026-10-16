import type { VendorCallResult } from "./types";

function availabilityScore(result: VendorCallResult) {
  if (result.availability === "available") return 0;
  if (result.availability === "unavailable") return 1;
  return 2;
}

function etaScore(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function priceScore(value: number | null) {
  return value ?? Number.POSITIVE_INFINITY;
}

export function rankVendorResults(results: VendorCallResult[]): VendorCallResult[] {
  return results
    .map((result, index) => ({ result, index }))
    .sort((left, right) => {
      const leftVerified = left.result.status === "verified";
      const rightVerified = right.result.status === "verified";
      if (leftVerified !== rightVerified) return leftVerified ? -1 : 1;
      if (!leftVerified) return left.index - right.index;
      return (
        availabilityScore(left.result) - availabilityScore(right.result) ||
        etaScore(left.result.earliestEta) - etaScore(right.result.earliestEta) ||
        priceScore(left.result.priceAmount) - priceScore(right.result.priceAmount) ||
        left.result.vendorName.localeCompare(right.result.vendorName) ||
        left.index - right.index
      );
    })
    .map(({ result }) => result);
}
