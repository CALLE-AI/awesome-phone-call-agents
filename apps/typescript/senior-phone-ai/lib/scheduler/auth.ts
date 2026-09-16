import { timingSafeEqual } from "node:crypto";

export function authorizeSchedulerRequest(headers: Headers, expectedSecret: string): boolean {
  if (expectedSecret.length < 32) return false;
  const authorization = headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(expectedSecret, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
