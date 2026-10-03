// File: src/lib/__tests__/extract.test.ts
import { describe, it, expect } from "vitest";
import { extractRecipientResult } from "@/lib/extract";
import type { CallRecipient, TranscriptTurn } from "@/lib/calle-types";

function turn(text: string, over: Partial<TranscriptTurn> = {}): TranscriptTurn {
  return { offset_seconds: 0, speaker: "clinic", text, ...over };
}

function recipient(over: Partial<CallRecipient>): CallRecipient {
  return {
    name: "Test Clinic",
    phone: "+15120000000",
    status: "completed",
    summary: undefined,
    structured_result: null,
    attempts: [],
    ...over,
  };
}

describe("extractRecipientResult — price found", () => {
  it("extracts an all-inclusive cash price and sets quoted_verbatim to the transcript turn", () => {
    const priceTurn = turn(
      "Our all-inclusive self-pay cash price is $438 and that includes the radiologist read.",
    );
    const rec = recipient({
      summary: "Billing quoted an all-inclusive self-pay price.",
      attempts: [{ status: "completed", transcript_turns: [turn("What's your cash price?", { speaker: "agent" }), priceTurn] }],
    });

    const r = extractRecipientResult(rec, "72148");

    expect(r.quote_given).toBe(true);
    expect(r.outcome).toBe("quoted");
    expect(r.cash_price).toBe(438);
    expect(r.price_basis).toBe("all_inclusive");
    expect(r.reached_billing).toBe(true);
    expect(r.quoted_verbatim).toBe(priceTurn.text);
    expect(r.cpt_or_code_confirmed).toBe("72148");
  });

  it("detects facility_only basis from split-fee language", () => {
    const rec = recipient({
      attempts: [{ status: "completed", transcript_turns: [turn("The facility fee for the scan is $525, the radiologist bills separately.")] }],
    });
    const r = extractRecipientResult(rec, "72148");
    expect(r.cash_price).toBe(525);
    expect(r.price_basis).toBe("facility_only");
  });

  it("does not mistake the procedure/CPT code for a price", () => {
    const rec = recipient({
      attempts: [{ status: "completed", transcript_turns: [turn("For code 72148 we don't quote over the phone.")] }],
    });
    const r = extractRecipientResult(rec, "72148");
    expect(r.quote_given).toBe(false);
    expect(r.cash_price).toBeNull();
  });
});

describe("extractRecipientResult — no price: never fabricated", () => {
  it("returns unknown/no-quote when no price is present (no fabrication)", () => {
    const rec = recipient({
      summary: "Spoke with front desk but no price was given.",
      attempts: [{ status: "completed", transcript_turns: [turn("We can't discuss pricing right now.")] }],
    });
    const r = extractRecipientResult(rec, "72148");

    expect(r.quote_given).toBe(false);
    expect(r.cash_price).toBeNull();
    expect(r.quoted_verbatim).toBeNull();
    expect(r.outcome).toBe("unknown");
    expect(r.price_basis).toBe("unknown");
  });

  it("classifies a consult-first refusal as needs_consult", () => {
    const rec = recipient({
      attempts: [{ status: "completed", transcript_turns: [turn("We can't give a price without a physician order and a consult first.")] }],
    });
    const r = extractRecipientResult(rec);
    expect(r.outcome).toBe("needs_consult");
    expect(r.requires_consult_first).toBe(true);
    expect(r.cash_price).toBeNull();
  });

  it("classifies a voicemail as voicemail with no quote", () => {
    const rec = recipient({
      attempts: [{ status: "completed", transcript_turns: [turn("You've reached Hill Country MRI, we're closed. Please leave a message after the tone.")] }],
    });
    const r = extractRecipientResult(rec);
    expect(r.outcome).toBe("voicemail");
    expect(r.quote_given).toBe(false);
  });

  it("returns unknown for a fully empty recipient (no turns, no summary)", () => {
    const r = extractRecipientResult(recipient({}));
    expect(r.quote_given).toBe(false);
    expect(r.cash_price).toBeNull();
    expect(r.outcome).toBe("unknown");
  });
});
