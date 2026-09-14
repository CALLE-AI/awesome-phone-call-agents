import type { JsonObject } from "@call-e/calle";
import type { SourcingCallPlan, SourcingExecution } from "./contracts.ts";

const BRANDS = ["SKF", "NSK", "FAG", "NTN", "Timken"];

export function executeFixture(plan: SourcingCallPlan): SourcingExecution {
  const quotes = plan.request.suppliers.map((supplier, index) => {
    const compatibility = index === 2 ? "unknown" : "confirmed";
    const result: JsonObject = {
      part_found: true,
      compatibility,
      brand: BRANDS[index % BRANDS.length],
      condition: "new",
      price_amount: Math.round(plan.request.budgetAmount * (0.72 + index * 0.09)),
      currency: plan.request.currency,
      available_quantity: Math.max(1, 3 - index),
      delivery_available: index === 1 ? "no" : "yes",
      delivery_eta: index === 0 ? "same day" : index === 1 ? "collection only" : "next business day",
      reservation_possible: compatibility === "confirmed" ? "yes" : "unknown",
      evidence: compatibility === "confirmed"
        ? [`Seller confirmed fitment reference ${plan.request.fitmentReference}.`]
        : ["Seller matched the vehicle but could not verify the fitment reference."],
      notes: compatibility === "confirmed" ? "Quote valid while stock lasts." : "Manual fitment confirmation required.",
    };
    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      status: "completed",
      result,
      summary: `${supplier.name} returned a ${compatibility} compatibility result.`,
      evidence: result.evidence as string[],
    };
  });

  return {
    mode: "fixture",
    callId: `fixture_${plan.id}`,
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.94, label: "high" },
    summary: `${quotes.length} fixture supplier results are ready for comparison.`,
    evidence: quotes.flatMap((quote) => quote.evidence),
    quotes,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
}
