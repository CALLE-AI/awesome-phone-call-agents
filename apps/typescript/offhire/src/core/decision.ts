import {
  extractionSchema,
  type CallSnapshot,
  type Decision,
  type Rental,
  type Turn,
} from "./types";

import {
  normalize,
  compact,
  uncertain,
  billingWords,
  correction,
  continuesBilling,
  containsIdentifier,
  cutoffSupported,
  positiveBillingQuote,
  cutoffClauseSupported,
  offRentReferenceSupported,
  pickupSupported,
} from "./evidence";

/** Pure, conservative projection. Provider taskCompleted is intentionally not a gate. */
export function reconcileCall(
  call: CallSnapshot,
  rental: Pick<Rental, "assetId" | "contract" | "requestedAt" | "timezone">,
): Decision {
  // The task contains one recipient and one destination. Multiple completed attempts
  // need a person to reconcile rather than mixing evidence between conversations.
  const attempts = call.recipients.flatMap((r) => r.attempts);
  const completed = attempts.filter((a) => a.status === "completed");
  const transcript: Turn[] =
    completed.length === 1
      ? completed[0].transcriptTurns
      : attempts.flatMap((a) => a.transcriptTurns);
  const decision: Decision = {
    disposition: "needs_review",
    billing: "unconfirmed",
    pickup: "unknown",
    title: "Billing cutoff unconfirmed",
    reasons: [],
    nextAction:
      "Ask the rental desk to confirm the off-rent date, time and reference.",
    offRentAt: null,
    reference: null,
    pickupWindow: null,
    evidence: [],
    extracted: null,
    transcript,
  };
  if (call.status !== "completed") {
    decision.disposition = "unreached";
    decision.title = "No completed supplier conversation";
    decision.reasons.push(
      call.failureCode
        ? `CALL-E reported ${call.failureCode}.`
        : "The call has no completed result.",
    );
    decision.nextAction =
      "Check the contact and calling window before approving another attempt.";
    return decision;
  }
  const parsed = extractionSchema.safeParse(
    call.structuredResult ?? call.recipients[0]?.structuredResult,
  );
  if (!parsed.success) {
    decision.reasons.push(
      "The returned result is missing required fields or has an invalid shape.",
    );
    return decision;
  }
  const e = parsed.data;
  decision.extracted = e;
  if (e.contact_outcome !== "reached") {
    decision.disposition = "unreached";
    decision.title =
      e.contact_outcome === "voicemail"
        ? "Voicemail is not confirmation"
        : "Rental desk not reached";
    decision.reasons.push(
      `Contact outcome: ${e.contact_outcome.replaceAll("_", " ")}.`,
    );
    return decision;
  }
  if (completed.length !== 1 || call.recipients.length !== 1) {
    decision.reasons.push(
      "More than one conversation, or no completed attempt: review each conversation separately.",
    );
    return decision;
  }
  const matchQuote = (field: string, quote: string): number => {
    if (!quote.trim()) return -1;
    // Match the complete callee turn. A clipped positive substring may omit a negation.
    const idx = transcript.findIndex(
      (t) => t.speaker === "user" && normalize(t.text) === normalize(quote),
    );
    if (idx >= 0)
      decision.evidence.push({ field, quote: transcript[idx].text, turn: idx });
    return idx;
  };
  const identity = matchQuote("Asset & contract", e.identity_quote);
  const identityOk =
    e.authorized_representative === "yes" &&
    compact(e.asset_id) === compact(rental.assetId) &&
    compact(e.contract_id) === compact(rental.contract) &&
    identity >= 0 &&
    containsIdentifier(e.identity_quote, rental.assetId) &&
    containsIdentifier(e.identity_quote, rental.contract) &&
    !uncertain.test(e.identity_quote) &&
    !/\bno\b/i.test(e.identity_quote) &&
    !e.identity_quote.includes("?") &&
    /\b(yes|confirm(?:ed)?|verif(?:y|ied))\b/i.test(e.identity_quote);
  if (!identityOk) {
    decision.title = "Asset identity needs review";
    decision.reasons.push(
      "A rental desk representative did not confirm the exact asset and contract together.",
    );
    return decision;
  }
  const pickup = matchQuote("Collection", e.pickup_quote);
  if (
    pickup >= 0 &&
    pickupSupported(e.pickup_quote, e.pickup_status, e.pickup_window) &&
    !transcript
      .slice(pickup + 1)
      .some(
        (t) =>
          t.speaker === "user" &&
          (correction.test(t.text) ||
            (/\b(collection|pickup|pick up|collected)\b/i.test(t.text) &&
              (uncertain.test(t.text) ||
                /\b(cancell?ed|rescheduled|postponed)\b/i.test(t.text)))),
      )
  ) {
    decision.pickup =
      e.pickup_status === "collected" ? "reported_collected" : e.pickup_status;
    decision.pickupWindow =
      e.pickup_status === "scheduled" ? e.pickup_window : null;
  }
  const billing = matchQuote("Billing cutoff", e.billing_quote);
  const reference = matchQuote("Off-rent reference", e.reference_quote);
  if (e.billing_status === "still_billing" && billing >= 0) {
    decision.billing = "still_billing";
    decision.title = "Rental desk reports charges continue";
  }
  if (e.billing_status !== "off_rent_confirmed")
    decision.reasons.push(
      "The rental desk did not explicitly confirm an off-rent billing cutoff.",
    );
  if (billing < 0)
    decision.reasons.push(
      "The billing quote is not a complete rental-desk transcript turn.",
    );
  if (billing >= 0 && !positiveBillingQuote(e.billing_quote))
    decision.reasons.push(
      "The billing statement is conditional, negative or ambiguous.",
    );
  const when = Date.parse(e.off_rent_at);
  if (!cutoffClauseSupported(e.off_rent_at, e.billing_quote, rental.timezone))
    decision.reasons.push(
      "The exact extracted date, time and timezone could not be independently matched to the rental-desk billing quote.",
    );
  if (Number.isFinite(when) && when < Date.parse(rental.requestedAt) - 86400000)
    decision.reasons.push(
      "The cutoff predates this return request by more than a day; reconcile the dates.",
    );
  if (
    !e.off_rent_reference ||
    reference < 0 ||
    !offRentReferenceSupported(e.reference_quote, e.off_rent_reference)
  )
    decision.reasons.push(
      "The off-rent reference was not positively confirmed in a complete rental-desk turn.",
    );
  const readback = matchQuote("Read-back confirmation", e.readback_quote);
  const precedingBot =
    readback < 0
      ? null
      : transcript
          .slice(0, readback)
          .reverse()
          .find((t) => t.speaker === "bot");
  const readbackOk =
    e.readback_confirmed === "yes" &&
    readback > billing &&
    !!precedingBot &&
    containsIdentifier(precedingBot.text, rental.assetId) &&
    containsIdentifier(precedingBot.text, e.off_rent_reference) &&
    cutoffSupported(e.off_rent_at, precedingBot.text, rental.timezone) &&
    /\b(yes|correct|confirmed|that is right|that's right)\b/i.test(
      e.readback_quote,
    ) &&
    !uncertain.test(e.readback_quote) &&
    !e.readback_quote.includes("?");
  if (!readbackOk)
    decision.reasons.push(
      "The transcript does not support an affirmative response to the complete asset, cutoff and reference read-back.",
    );
  if (e.conditions.trim())
    decision.reasons.push(`Unresolved condition: ${e.conditions}`);
  // Do not let a later correction be overridden by an earlier positive quote.
  if (
    billing >= 0 &&
    transcript
      .slice(billing + 1)
      .some(
        (t) =>
          t.speaker === "user" &&
          (correction.test(t.text) ||
            (billingWords.test(t.text) &&
              (uncertain.test(t.text) || continuesBilling.test(t.text)))),
      )
  )
    decision.reasons.push(
      "A later rental-desk statement corrects or qualifies the confirmation.",
    );
  if (decision.reasons.length === 0) {
    decision.disposition = "confirmed";
    decision.billing = "reported_off_rent";
    decision.title = "Off-rent cutoff confirmed";
    decision.offRentAt = e.off_rent_at;
    decision.reference = e.off_rent_reference;
    decision.nextAction =
      "Request written confirmation, keep the asset secure, and check the final invoice.";
  } else if (decision.pickup === "scheduled")
    decision.nextAction =
      "Collection is scheduled. Ask dispatch to confirm when billing ends and supply the off-rent reference.";
  return decision;
}

export function summarizeRentals(
  rentals: Rental[],
  jobs: {
    rentalId: string;
    decision: Decision | null;
    createdAt: string;
    updatedAt?: string;
    decisionOrder?: number;
  }[],
) {
  const latest = new Map<string, Decision>();
  for (const j of [...jobs].sort(
    (a, b) =>
      (a.decisionOrder || 0) - (b.decisionOrder || 0) ||
      (a.updatedAt || a.createdAt).localeCompare(b.updatedAt || b.createdAt),
  ))
    if (j.decision) latest.set(j.rentalId, j.decision);
  const rates: Record<string, number> = {};
  let confirmed = 0,
    awaitingPickup = 0;
  for (const r of rentals) {
    const d = latest.get(r.id);
    if (d?.billing === "reported_off_rent") {
      confirmed++;
      if (!r.collectedAt) awaitingPickup++;
    } else rates[r.currency] = (rates[r.currency] ?? 0) + r.dailyRate;
  }
  return {
    rates,
    confirmed,
    awaitingPickup,
    unconfirmed: rentals.length - confirmed,
  };
}

export function invoiceReview(
  billedThrough: string,
  decision: Decision | null,
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(billedThrough) ||
    !Number.isFinite(Date.parse(billedThrough)) ||
    new Date(billedThrough + "T00:00:00Z").toISOString().slice(0, 10) !==
      billedThrough
  )
    throw new Error("Enter a valid invoice end date.");
  if (decision?.billing !== "reported_off_rent" || !decision.offRentAt)
    return {
      flagged: false,
      reason:
        "No confirmed cutoff to compare. Resolve the off-rent evidence first.",
    };
  // Compare the supplier-reported local calendar day, not the viewer's timezone.
  const cutoffDate = decision.offRentAt.slice(0, 10);
  return billedThrough > cutoffDate
    ? {
        flagged: true,
        reason: `The invoice runs through ${billedThrough}; the supplier reported an off-rent cutoff on ${cutoffDate}. Review the contract and invoice with reference ${decision.reference}. This is a review flag, not proof of an overcharge.`,
      }
    : {
        flagged: false,
        reason:
          "The entered invoice end date is no later than the reported cutoff day. Rates, minimums, taxes and other charges still need normal review.",
      };
}
