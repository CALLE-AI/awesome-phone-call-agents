// Ranks facilities by what the call actually established. Unreached and refused facilities stay
// visible in the results instead of silently disappearing from the denominator.
import type { BloodInquiryResult, InquiryResult, ReachedParty, StockStatus, YesNoUnknown } from "./types";

export type Tier = "confirmed" | "partial" | "alternative" | "refused" | "out" | "unreached" | "unknown";

export interface Assessment {
  tier: Tier;
  score: number;
  reasons: string[];
  priceValue: number | null;
}

/** The ranking-relevant facts of one call, whichever kind of facility it reached. */
export interface Signals {
  reached: ReachedParty;
  stock: StockStatus;
  availableToday: YesNoUnknown;
  alternative: boolean;
  holdOffered: YesNoUnknown;
  holdHours: number;
  holdLabel: "hold" | "reserve";
  acceptsTransfer: YesNoUnknown;
  open247: YesNoUnknown;
  readyTime: string;
  nextSupply: string;
  price: string;
}

const BASE_SCORE: Record<Tier, number> = {
  confirmed: 100,
  partial: 70,
  alternative: 45,
  refused: 20,
  unknown: 10,
  out: 0,
  unreached: 0,
};

const UNREACHED: ReadonlyArray<ReachedParty> = ["voicemail", "no_answer", "wrong_number", "automated_system_only"];

export function parsePrice(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : null;
}

export function signalsFromInquiry(r: InquiryResult): Signals {
  return {
    reached: r.reached,
    stock: r.stock_status,
    availableToday: r.can_fill_today,
    alternative: ["generic", "different_strength", "different_form"].includes(r.alternative_available),
    holdOffered: r.hold_offered,
    holdHours: r.hold_duration_hours,
    holdLabel: "hold",
    acceptsTransfer: r.transfer_accepted,
    open247: "unknown",
    readyTime: r.ready_time,
    nextSupply: r.restock_eta,
    price: r.cash_price,
  };
}

export function signalsFromBlood(r: BloodInquiryResult): Signals {
  return {
    reached: r.reached,
    stock: r.stock_status,
    availableToday: r.can_issue_today,
    alternative: false,
    holdOffered: r.reserve_offered,
    holdHours: r.reserve_duration_hours,
    holdLabel: "reserve",
    acceptsTransfer: "unknown",
    open247: r.open_24x7,
    readyTime: "",
    nextSupply: r.referral_or_restock,
    price: r.processing_charge,
  };
}

export function tierOfSignals(s: Signals | null, callFailed: boolean): Tier {
  if (!s) return callFailed ? "unreached" : "unknown";
  if (UNREACHED.includes(s.reached)) return "unreached";
  switch (s.stock) {
    case "in_stock":
      return s.availableToday === "no" ? "partial" : "confirmed";
    case "partial":
      return "partial";
    case "refused_to_disclose":
      return "refused";
    case "out_of_stock":
      return s.alternative ? "alternative" : "out";
    default:
      return "unknown";
  }
}

export function assessSignals(s: Signals | null, distanceKm: number, confidence: number | null, callFailed: boolean): Assessment {
  const tier = tierOfSignals(s, callFailed);
  const reasons: string[] = [];
  let score = BASE_SCORE[tier];

  if (s) {
    if (s.holdOffered === "yes") {
      score += 15;
      const verb = s.holdLabel === "reserve" ? "Will reserve" : "Will hold";
      reasons.push(s.holdHours > 0 ? `${verb} ~${s.holdHours}h` : verb);
    }
    if (s.acceptsTransfer === "yes") {
      score += 5;
      reasons.push("Accepts e-prescriptions");
    }
    if (s.open247 === "yes") {
      score += 5;
      reasons.push("Issues 24×7");
    }
    if (s.readyTime) reasons.push(`Ready: ${s.readyTime}`);
    if (s.nextSupply && tier !== "confirmed") reasons.push(`Next: ${s.nextSupply}`);
  }

  if (score > 0) score -= Math.min(distanceKm * 3, 30);
  score *= 0.6 + 0.4 * (confidence ?? 0.7);

  // The raw maximum is 120 (confirmed + hold + one bonus), so report on a 0-100 scale.
  return {
    tier,
    score: Math.min(100, Math.max(0, Math.round(score / 1.2))),
    reasons,
    priceValue: parsePrice(s?.price),
  };
}

export function tierOf(result: InquiryResult | null, callFailed: boolean): Tier {
  return tierOfSignals(result ? signalsFromInquiry(result) : null, callFailed);
}

export function assess(result: InquiryResult | null, facility: { distanceKm: number }, confidence: number | null, callFailed: boolean): Assessment {
  return assessSignals(result ? signalsFromInquiry(result) : null, facility.distanceKm, confidence, callFailed);
}

export function assessBlood(
  result: BloodInquiryResult | null,
  facility: { distanceKm: number },
  confidence: number | null,
  callFailed: boolean,
): Assessment {
  return assessSignals(result ? signalsFromBlood(result) : null, facility.distanceKm, confidence, callFailed);
}
