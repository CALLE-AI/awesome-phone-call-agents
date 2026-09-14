export type PilotRunRecord = {
  requestId: string;
  status: string;
  requestCreatedAt: string;
  runCreatedAt: string;
  completedAt: string | null;
};

export type PilotSupplierRecord = {
  requestId: string;
  supplierId: string;
};

export type PilotQuoteRecord = {
  requestId: string;
  supplierId: string;
  status: string;
  resultJson: string | null;
};

export type PilotMetrics = {
  liveRequests: number;
  completedRequests: number;
  supplierAttempts: number;
  successfulContacts: number;
  contactRate: number | null;
  quoteCompleteness: number | null;
  medianSourcingMinutes: number | null;
  compatibleOptions: number;
  averagePriceSpread: number | null;
  humanInterventionRate: number | null;
  fixtureRunsExcluded: number;
  generatedAt: string;
};

const REQUIRED_QUOTE_FIELDS = [
  "part_found",
  "compatibility",
  "brand",
  "condition",
  "price_amount",
  "currency",
  "available_quantity",
  "delivery_available",
  "delivery_eta",
  "reservation_possible",
  "evidence",
  "notes",
] as const;

function parseResult(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 10) / 10;
}

export function calculatePilotMetrics(
  runs: PilotRunRecord[],
  suppliers: PilotSupplierRecord[],
  quotes: PilotQuoteRecord[],
  fixtureRunsExcluded: number,
  now = new Date(),
): PilotMetrics {
  const latestRuns = new Map<string, PilotRunRecord>();
  for (const run of runs) {
    const previous = latestRuns.get(run.requestId);
    if (!previous || run.runCreatedAt > previous.runCreatedAt) latestRuns.set(run.requestId, run);
  }

  const requestIds = new Set(latestRuns.keys());
  const attemptedSuppliers = new Set(
    suppliers.filter((supplier) => requestIds.has(supplier.requestId)).map((supplier) => `${supplier.requestId}:${supplier.supplierId}`),
  );
  const relevantQuotes = quotes.filter((quote) => requestIds.has(quote.requestId));
  const completedQuotes = relevantQuotes.filter((quote) => quote.status === "completed");
  const results = completedQuotes.map((quote) => ({ quote, result: parseResult(quote.resultJson) }));
  const completeFields = results.reduce(
    (total, { result }) => total + (result ? REQUIRED_QUOTE_FIELDS.filter((field) => Object.hasOwn(result, field)).length : 0),
    0,
  );

  const completedRuns = [...latestRuns.values()].filter((run) => run.status === "completed" && run.completedAt);
  const sourcingMinutes = completedRuns.map((run) =>
    Math.max(0, (new Date(run.completedAt as string).getTime() - new Date(run.requestCreatedAt).getTime()) / 60000),
  );
  const compatibleOptions = results.filter(({ result }) => result?.compatibility === "confirmed").length;

  const pricesByRequest = new Map<string, number[]>();
  for (const { quote, result } of results) {
    if (result?.compatibility !== "confirmed" || typeof result.price_amount !== "number" || result.price_amount <= 0) continue;
    const prices = pricesByRequest.get(quote.requestId) ?? [];
    prices.push(result.price_amount);
    pricesByRequest.set(quote.requestId, prices);
  }
  const spreads = [...pricesByRequest.values()]
    .filter((prices) => prices.length > 1)
    .map((prices) => ((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices)) * 100);

  let interventionRequests = 0;
  for (const [requestId, run] of latestRuns) {
    const requestResults = results.filter(({ quote }) => quote.requestId === requestId);
    const needsIntervention = run.status === "failed" || run.status === "canceled" ||
      requestResults.length < suppliers.filter((supplier) => supplier.requestId === requestId).length ||
      requestResults.some(({ result }) => !result || result.compatibility !== "confirmed");
    if (needsIntervention) interventionRequests += 1;
  }

  return {
    liveRequests: latestRuns.size,
    completedRequests: completedRuns.length,
    supplierAttempts: attemptedSuppliers.size,
    successfulContacts: completedQuotes.length,
    contactRate: percentage(completedQuotes.length, attemptedSuppliers.size),
    quoteCompleteness: percentage(completeFields, completedQuotes.length * REQUIRED_QUOTE_FIELDS.length),
    medianSourcingMinutes: median(sourcingMinutes),
    compatibleOptions,
    averagePriceSpread: spreads.length ? Math.round((spreads.reduce((sum, value) => sum + value, 0) / spreads.length) * 10) / 10 : null,
    humanInterventionRate: percentage(interventionRequests, latestRuns.size),
    fixtureRunsExcluded,
    generatedAt: now.toISOString(),
  };
}
