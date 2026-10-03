import { timingSafeEqual } from "node:crypto";

/** Only a server-controlled ingress may attach this secret and operator identity. */
export function trustedOwnerId(
  requestHeaders: Headers,
  config: { ingressSecret?: string; ownerUserId?: string },
): string | null {
  const expectedSecret = config.ingressSecret || "";
  const expectedUserId = config.ownerUserId || "";
  const suppliedSecret = requestHeaders.get("x-ai-ops-trusted-ingress-secret") || "";
  const suppliedUserId = requestHeaders.get("oai-authenticated-user-id") || "";
  if (expectedSecret.length < 32 || !expectedUserId || !suppliedUserId || suppliedUserId !== expectedUserId) return null;

  const expected = Buffer.from(expectedSecret, "utf8");
  const supplied = Buffer.from(suppliedSecret, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  // Records and contacts are intentionally shared within this one-company app.
  return "single-tenant-owner";
}
