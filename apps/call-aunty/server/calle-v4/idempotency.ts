import { createHash } from "node:crypto";

export function stableKey(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function requestKey(userId: string, clientRequestId: string): string {
  return stableKey(["calle-v4", userId, clientRequestId]);
}
