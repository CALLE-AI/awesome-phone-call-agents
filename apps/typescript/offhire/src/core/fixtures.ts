import type { CallSnapshot, Extraction, Rental, Scenario, Turn } from "./types";
export const demoDate = "2026-09-14T14:30:00-05:00";
export function demoRentals(workspaceId: string): Rental[] {
  return [
    {
      assetId: "SL-204",
      name: "19′ electric scissor lift",
      supplier: "Crest Equipment",
      contract: "CR-10842",
      dailyRate: 185,
      site: "Riverside · Level 3",
      accessNotes:
        "Staged inside the north gate. Site lead meets the driver; keys are in the site office.",
      requestNote:
        "Return request submitted by the site lead. No off-rent confirmation received yet.",
    },
    {
      assetId: "TH-118",
      name: "6,000 lb telehandler",
      supplier: "Northstar Rentals",
      contract: "NR-62018",
      dailyRate: 320,
      site: "Riverside · Loading bay",
      accessNotes:
        "Loading bay B. Collection needs an appointment with the site lead.",
      requestNote:
        "Pickup requested. Dispatch has not confirmed whether rental charges stop today.",
    },
    {
      assetId: "LT-042",
      name: "LED light tower",
      supplier: "Crest Equipment",
      contract: "CR-39002",
      dailyRate: 95,
      site: "Riverside · East gate",
      accessNotes:
        "Staged in the fenced compound. Collect during staffed site hours.",
      requestNote:
        "Supplier confirmed off-rent. Written confirmation and physical collection are still pending.",
    },
  ].map((r, i) => ({
    ...r,
    id: `${workspaceId}-r${i + 1}`,
    workspaceId,
    currency: "USD",
    phone: "",
    region: "US",
    timezone: "America/Chicago",
    requestedAt: demoDate,
    ready: true,
    authorizedContact: false,
    isTest: true,
    createdAt: new Date(Date.now() - 600000 + i).toISOString(),
    collectedAt: null,
    writtenConfirmation: false,
    invoiceReviewed: false,
  }));
}

/** Explicit synthetic fixtures. Never call a provider or invent a live call ID. */
export function fixtureCall(
  r: Rental,
  scenario: Scenario,
  id = "sim-call",
): CallSnapshot {
  const identity = `I'm Jordan at ${r.supplier}'s rental desk. I can verify asset ${r.assetId} on contract ${r.contract}.`;
  const billing =
    "Rental billing stops on September 14, 2026 at 3:00 PM Central Daylight Time. The asset is confirmed off-rent at that time.";
  const reference =
    "Yes, that read-back is correct. The off-rent confirmation number is OR-78416.";
  const pickup =
    "Collection is scheduled for September 15, 2026 between 8 AM and noon Central Daylight Time.";
  const turn = (
    speaker: Turn["speaker"],
    text: string,
    offset: number,
  ): Turn => ({ speaker, text, offset_seconds: offset });
  let turns = [
    turn(
      "bot",
      `Hi, this is OffHire, an AI assistant. This is a fictional rental verification test. Can you verify ${r.assetId} on ${r.contract}?`,
      0,
    ),
    turn("user", identity, 8),
    turn(
      "bot",
      "Could you confirm the effective off-rent billing cutoff and reference separately from collection?",
      15,
    ),
    turn("user", billing, 23),
    turn(
      "bot",
      `To read that back: ${r.assetId}, September 14, 2026 at 3 PM Central Daylight Time, off-rent reference OR-78416. Is that correct?`,
      35,
    ),
    turn("user", reference, 44),
    turn(
      "bot",
      "And when is the asset being collected? Please send written confirmation to the customer address already on file.",
      51,
    ),
    turn("user", pickup, 60),
  ];
  const e: Extraction = {
    contact_outcome: "reached",
    authorized_representative: "yes",
    representative_name: "Jordan",
    asset_id: r.assetId,
    contract_id: r.contract,
    identity_quote: identity,
    billing_status: "off_rent_confirmed",
    off_rent_at: "2026-09-14T15:00:00-05:00",
    off_rent_reference: "OR-78416",
    billing_quote: billing,
    reference_quote: reference,
    readback_confirmed: "yes",
    readback_quote: reference,
    pickup_status: "scheduled",
    pickup_window:
      "September 15, 2026 between 8 AM and noon Central Daylight Time",
    pickup_quote: pickup,
    written_confirmation: "requested",
    conditions: "",
  };
  if (scenario === "ambiguous") {
    const ambiguous =
      "I can confirm the pickup for tomorrow, but I cannot confirm when billing stops. Dispatch still needs to approve the off-rent.";
    turns[3] = turn("user", ambiguous, 23);
    turns[4] = turn(
      "bot",
      "Understood. I will flag the billing cutoff for your dispatcher to confirm. Is there an off-rent reference yet?",
      35,
    );
    turns[5] = turn(
      "user",
      "No off-rent reference yet. The collection booking is separate.",
      44,
    );
    Object.assign(e, {
      billing_status: "unknown",
      off_rent_at: "",
      off_rent_reference: "",
      billing_quote: ambiguous,
      reference_quote: "",
      readback_confirmed: "no",
      conditions: "Dispatcher approval of off-rent is outstanding.",
    });
  }
  if (scenario === "voicemail") {
    turns = [
      turn(
        "user",
        "You have reached the rental desk. Please leave a message after the tone.",
        0,
      ),
      turn("bot", "I will try another time. Thank you.", 5),
    ];
    Object.assign(e, {
      contact_outcome: "voicemail",
      authorized_representative: "unknown",
      billing_status: "unknown",
      off_rent_at: "",
      off_rent_reference: "",
      billing_quote: "",
      reference_quote: "",
      identity_quote: "",
      pickup_status: "unknown",
      pickup_quote: "",
      pickup_window: "",
      readback_confirmed: "unknown",
    });
  }
  if (scenario === "contradiction")
    turns.push(
      turn(
        "user",
        "Wait, correction: I gave you the pickup ticket. The off-rent is not approved yet and billing continues.",
        70,
      ),
    );
  if (scenario === "unsupported") turns[3] = turn("bot", billing, 23);
  if (scenario === "wrong_asset") e.asset_id = "SL-999";
  return {
    id,
    status: "completed",
    taskCompleted: true,
    structuredResult: e,
    summary:
      scenario === "confirmed"
        ? "Supplier reported an off-rent cutoff and collection window."
        : "Review the separate billing and collection results.",
    completedAt: "2026-09-14T20:02:00Z",
    recipients: [
      {
        status: "completed",
        attempts: [{ status: "completed", transcriptTurns: turns }],
      },
    ],
  };
}
