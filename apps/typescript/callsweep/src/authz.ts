import { isE164 } from "./phone";

// Operator-authorized recipient allowlist. In real mode, ONLY numbers explicitly
// listed here may be dialed. A "yes" prompt is not proof of authorization; this
// allowlist is. Configure it with ALLOWED_PHONES="+1...,+1..." (E.164).
export function allowlist(): string[] {
  return (process.env.ALLOWED_PHONES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((p) => isE164(p));
}

// A destination may be dialed only if it is valid E.164 AND on the allowlist.
export function isAuthorized(phone: string): boolean {
  return isE164(phone) && allowlist().includes(phone);
}

// Hard ceiling on how many calls ONE run may place, independent of the
// allowlist. The allowlist answers "may I dial this number"; this answers
// "how many numbers may a single sweep dial at all". A wide allowlist should
// not silently turn into a wide sweep, so the cap binds even when every
// discovered shop is authorized. Configure with MAX_CALLS (default 4).
export const DEFAULT_MAX_CALLS = 4;

export function maxCalls(): number {
  const raw = (process.env.MAX_CALLS ?? "").trim();
  if (raw === "") return DEFAULT_MAX_CALLS;
  const n = Number(raw);
  // Reject anything that is not a positive whole number, and fall back to the
  // default rather than to "unlimited" — a malformed cap must never widen the
  // sweep.
  if (!Number.isInteger(n) || n < 1) return DEFAULT_MAX_CALLS;
  return n;
}

export function canPlaceAnotherCall(callsPlaced: number, cap = maxCalls()): boolean {
  return Number.isInteger(callsPlaced) && callsPlaced >= 0 && callsPlaced < cap;
}
