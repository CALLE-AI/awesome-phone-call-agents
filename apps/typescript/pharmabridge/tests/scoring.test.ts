import { describe, expect, it } from "vitest";
import { assess, assessBlood, parsePrice, tierOf } from "@/lib/scoring";
import type { BloodInquiryResult, InquiryResult } from "@/lib/types";

const blank: InquiryResult = {
  reached: "pharmacy_staff",
  stock_status: "unknown",
  can_fill_today: "unknown",
  quantity_on_hand: "",
  alternative_available: "not_discussed",
  alternative_details: "",
  hold_offered: "unknown",
  hold_duration_hours: 0,
  ready_time: "",
  cash_price: "",
  restock_eta: "",
  transfer_accepted: "unknown",
  staff_name: "",
  evidence_quote: "",
  notes: "",
};

const blankBlood: BloodInquiryResult = {
  reached: "facility_staff",
  stock_status: "unknown",
  units_available: "",
  can_issue_today: "unknown",
  reserve_offered: "unknown",
  reserve_duration_hours: 0,
  requisition_required: "unknown",
  crossmatch_sample_required: "unknown",
  replacement_donor_required: "unknown",
  processing_charge: "",
  open_24x7: "unknown",
  referral_or_restock: "",
  staff_name: "",
  evidence_quote: "",
  notes: "",
};

const at = (distanceKm: number) => ({ distanceKm });

describe("tierOf", () => {
  it("only confirms stock the staff clearly stated", () => {
    expect(tierOf({ ...blank, stock_status: "in_stock", can_fill_today: "yes" }, false)).toBe("confirmed");
    expect(tierOf({ ...blank, stock_status: "in_stock", can_fill_today: "no" }, false)).toBe("partial");
    expect(tierOf({ ...blank, stock_status: "unknown" }, false)).toBe("unknown");
  });

  it("keeps refusals distinct from out-of-stock", () => {
    expect(tierOf({ ...blank, stock_status: "refused_to_disclose" }, false)).toBe("refused");
    expect(tierOf({ ...blank, stock_status: "out_of_stock", alternative_available: "none" }, false)).toBe("out");
    expect(tierOf({ ...blank, stock_status: "out_of_stock", alternative_available: "different_strength" }, false)).toBe("alternative");
  });

  it("treats voicemail and failed calls as not reached", () => {
    expect(tierOf({ ...blank, reached: "voicemail", stock_status: "in_stock" }, false)).toBe("unreached");
    expect(tierOf(null, true)).toBe("unreached");
    expect(tierOf(null, false)).toBe("unknown");
  });
});

describe("assess", () => {
  it("ranks confirmed above partial above alternative above refusal", () => {
    const score = (r: InquiryResult) => assess(r, at(1), 0.9, false).score;
    const confirmed = score({ ...blank, stock_status: "in_stock", can_fill_today: "yes" });
    const partial = score({ ...blank, stock_status: "partial" });
    const alternative = score({ ...blank, stock_status: "out_of_stock", alternative_available: "generic" });
    const refused = score({ ...blank, stock_status: "refused_to_disclose" });
    expect(confirmed).toBeGreaterThan(partial);
    expect(partial).toBeGreaterThan(alternative);
    expect(alternative).toBeGreaterThan(refused);
  });

  it("rewards a hold and penalizes distance", () => {
    const inStock = { ...blank, stock_status: "in_stock" as const, can_fill_today: "yes" as const };
    const withHold = assess({ ...inStock, hold_offered: "yes", hold_duration_hours: 24 }, at(1), 0.9, false);
    const withoutHold = assess(inStock, at(1), 0.9, false);
    const farAway = assess(inStock, at(8), 0.9, false);
    expect(withHold.score).toBeGreaterThan(withoutHold.score);
    expect(withoutHold.score).toBeGreaterThan(farAway.score);
    expect(withHold.reasons).toContain("Will hold ~24h");
    expect(withHold.score).toBeLessThanOrEqual(100);
  });
});

describe("blood bank assessment", () => {
  it("confirms only when the requested units can be issued", () => {
    expect(assessBlood({ ...blankBlood, stock_status: "in_stock", can_issue_today: "yes" }, at(1), 0.9, false).tier).toBe("confirmed");
    expect(assessBlood({ ...blankBlood, stock_status: "in_stock", can_issue_today: "no" }, at(1), 0.9, false).tier).toBe("partial");
    expect(assessBlood({ ...blankBlood, stock_status: "partial" }, at(1), 0.9, false).tier).toBe("partial");
    expect(assessBlood({ ...blankBlood, stock_status: "out_of_stock" }, at(1), 0.9, false).tier).toBe("out");
    expect(assessBlood({ ...blankBlood, reached: "voicemail" }, at(1), 0.9, false).tier).toBe("unreached");
  });

  it("rewards a reservation and round-the-clock issue", () => {
    const available = { ...blankBlood, stock_status: "in_stock" as const, can_issue_today: "yes" as const };
    const reserved = assessBlood({ ...available, reserve_offered: "yes", reserve_duration_hours: 6, open_24x7: "yes" }, at(2), 0.9, false);
    const plain = assessBlood(available, at(2), 0.9, false);
    expect(reserved.score).toBeGreaterThan(plain.score);
    expect(reserved.reasons).toEqual(expect.arrayContaining(["Will reserve ~6h", "Issues 24×7"]));
  });
});

describe("parsePrice", () => {
  it("parses stated prices and never invents one", () => {
    expect(parsePrice("$18.40")).toBe(18.4);
    expect(parsePrice("1,204.50 dollars")).toBe(1204.5);
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("about eighteen")).toBeNull();
  });
});
