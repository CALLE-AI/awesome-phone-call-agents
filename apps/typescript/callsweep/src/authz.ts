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
