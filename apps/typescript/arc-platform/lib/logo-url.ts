/**
 * Whether a logo URL may be stored.
 *
 * The value arrives from a client and is rendered in an <img> on every page of
 * the app, so it is checked rather than trusted. Only uploadthing's own hosts
 * are accepted - the point is that the file went through our uploader, which
 * authenticates the caller and caps the size, and not that the string happens
 * to look like a picture.
 *
 * Kept apart from the server action so the rule can be tested without a
 * database or a signed-in user.
 */
const ALLOWED = /^(?:[a-z0-9-]+\.)*(?:ufs\.sh|utfs\.io|uploadthing\.com)$/i;

export function isAllowedLogoUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  /* http:// would load a mixed-content image and can be tampered with in
     transit; the uploader only ever returns https. */
  if (u.protocol !== "https:") return false;
  return ALLOWED.test(u.hostname);
}
