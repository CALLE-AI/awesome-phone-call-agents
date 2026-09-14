import { isE164 } from "../domain/redact";

function allowlistEntries(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function liveModeEnabled(): boolean {
  return process.env.CHANGELOCK_MODE === "live";
}

export function livePolicyCheck(input: { phoneE164: string; region: string }):
  | { ok: true }
  | { ok: false; reason: string } {
  const contacts = allowlistEntries(process.env.CHANGELOCK_LIVE_CONTACT_ALLOWLIST);
  const regions = allowlistEntries(process.env.CHANGELOCK_LIVE_REGION_ALLOWLIST);
  if (contacts.length === 0 || regions.length === 0) {
    return { ok: false, reason: "live policy: allowlists are not configured" };
  }
  if (!isE164(input.phoneE164)) {
    return { ok: false, reason: "live policy: destination is not valid E.164" };
  }
  if (!contacts.includes(input.phoneE164)) {
    return { ok: false, reason: "live policy: contact not allowlisted" };
  }
  if (!regions.includes(input.region)) {
    return { ok: false, reason: "live policy: region not allowlisted" };
  }
  return { ok: true };
}
