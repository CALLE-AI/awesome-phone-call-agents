import type { SourcingSupplier } from "./calle/contracts.ts";

export type LiveSecurityBindings = {
  SPARESCOUT_OPERATOR_TOKEN?: string;
  SPARESCOUT_LIVE_RECIPIENT_ALLOWLIST?: string;
};

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const encoder = new TextEncoder();

function bearerToken(authorization: string | null): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const value = authorization.slice(7).trim();
  return value.length >= 32 && value.length <= 512 ? value : null;
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

export function liveRecipientAllowlist(value: string | undefined): Set<string> {
  const entries = (value ?? "").split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean);
  if (entries.some((entry) => !E164_PATTERN.test(entry))) {
    throw new Error("The live recipient allowlist contains an invalid E.164 value.");
  }
  return new Set(entries);
}

export function hasLiveSecurityConfiguration(bindings: LiveSecurityBindings): boolean {
  const token = bindings.SPARESCOUT_OPERATOR_TOKEN?.trim() ?? "";
  try {
    return token.length >= 32 && liveRecipientAllowlist(bindings.SPARESCOUT_LIVE_RECIPIENT_ALLOWLIST).size > 0;
  } catch {
    return false;
  }
}

export async function isAuthorizedLiveOperator(authorization: string | null, bindings: LiveSecurityBindings): Promise<boolean> {
  const presented = bearerToken(authorization);
  const configured = bindings.SPARESCOUT_OPERATOR_TOKEN?.trim();
  if (!presented || !configured || configured.length < 32) return false;
  return constantTimeEqual(presented, configured);
}

export function assertAuthorizedLiveRecipients(suppliers: SourcingSupplier[], bindings: LiveSecurityBindings): void {
  const allowed = liveRecipientAllowlist(bindings.SPARESCOUT_LIVE_RECIPIENT_ALLOWLIST);
  if (!allowed.size || suppliers.some((supplier) => !allowed.has(supplier.phone))) {
    throw new Error("Every live recipient must be pre-authorized in the server-side allowlist.");
  }
}
