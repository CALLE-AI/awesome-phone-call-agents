import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Who is allowed to make this app do something on the account.
 *
 * The earlier version let the browser name its own button press and treated
 * that as the authorization. That is fine for idempotency and useless as
 * authentication: anybody can mint a random string. So anything that spends
 * money or reads account state now needs an operator token, and the token is
 * something only the server's secret can produce.
 *
 * Every token is an HMAC over what it is for and exactly what it covers. A dial
 * token names one E.164 number, so a token for one destination cannot dial
 * another. An inbox token names one inbox, and posting and reading are separate
 * tokens, so the URL you hand to a webhook sender cannot read the inbox back.
 *
 * No secret, no tokens. There is no fallback derived from another key: if
 * ASHEARD_OPERATOR_SECRET is not set, dialling and the inbox are simply off.
 */

export const OPERATOR_HEADER = "x-asheard-operator";

export type Purpose = "dial" | "inbox-post" | "inbox-read";

/** Short secrets are refused rather than accepted weakly. */
const MIN_SECRET_LENGTH = 32;

export function operatorSecret(): string | null {
  const value = process.env.ASHEARD_OPERATOR_SECRET?.trim() ?? "";
  return value.length >= MIN_SECRET_LENGTH ? value : null;
}

export function mint(purpose: Purpose, subject: string, secret: string | null): string | null {
  if (secret === null || secret.length < MIN_SECRET_LENGTH || subject === "") return null;
  return createHmac("sha256", secret).update(`asheard:${purpose}:v1:${subject}`).digest("hex");
}

/** Constant time, and false for anything missing rather than throwing. */
export function verify(
  purpose: Purpose,
  subject: string,
  presented: string | null | undefined,
  secret: string | null,
): boolean {
  const expected = mint(purpose, subject, secret);
  if (expected === null || typeof presented !== "string") return false;
  const given = presented.trim();
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

/**
 * An inbox address is an id plus the post token for that id.
 *
 * Only the server secret can produce a valid pair, so a made-up inbox is
 * refused before anything is looked at. It is still not proof of who sent a
 * delivery, because whoever holds the URL can post. That is why nothing a
 * delivery says is trusted: see the hook route.
 */
export function parseInbox(segment: string): { id: string; sig: string } | null {
  const match = /^([0-9a-f]{32})\.([0-9a-f]{64})$/.exec(segment);
  return match ? { id: match[1]!, sig: match[2]! } : null;
}
