import type { Stop } from "./types.js";

export interface CallCandidate {
  stop: Stop;
  /** Expected arrival, minutes after shift start, in the current order. */
  eta: number;
  /** True once this stop has been called today; each stop is called at most once. */
  called: boolean;
}

export interface CallPick {
  stopId: string;
  eta: number;
  reason: string;
}

/** A call takes about two minutes and the route needs room to adapt afterwards. */
export const MIN_LEAD_MINUTES = 6;
/** An answer given much earlier than this goes stale before the rider arrives. */
export const MAX_LEAD_MINUTES = 45;

/**
 * Picks the one stop to call next. There is only one line, so nothing is
 * picked while a call is in flight. Among uncalled stops the rider will reach
 * between MIN_LEAD and MAX_LEAD minutes from now, the soonest wins.
 */
export function pickNextCall(now: number, candidates: CallCandidate[], lineBusy: boolean): CallPick | null {
  if (lineBusy) return null;
  const eligible = candidates
    .filter((c) => !c.called && c.eta - now >= MIN_LEAD_MINUTES && c.eta - now <= MAX_LEAD_MINUTES)
    .sort((a, b) => a.eta - b.eta);
  const next = eligible[0];
  if (!next) return null;
  return { stopId: next.stop.id, eta: next.eta, reason: describeWhy(next, now) };
}

function describeWhy(candidate: CallCandidate, now: number): string {
  const { stop } = candidate;
  const parts = [`rider arrives in about ${Math.round(candidate.eta - now)} min`];
  if (stop.firstTime) parts.push("first-time customer");
  if (stop.gated) parts.push("gated building");
  if (stop.codAmount !== null) parts.push(`cash on delivery ${stop.codAmount} taka`);
  return parts.join(", ");
}
