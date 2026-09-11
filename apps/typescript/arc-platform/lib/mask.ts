/**
 * Masking destinations before they are written down or sent back.
 *
 * A phone number is the one piece of data in this system that belongs to
 * someone who never agreed to be in it. The station answering the call did
 * not sign up, cannot see what we store, and cannot ask for it back. So its
 * number should not be sitting in a log line that is retained, searchable and
 * readable by anyone with access to the deployment.
 *
 * Every call Arc placed used to write the destination in clear to the
 * platform log twice - once in the request body and once in CALL-E's reply.
 *
 * WHAT THIS IS NOT. Masking a log is not anonymisation: the number is still
 * in the database, because dialling requires it and a call record without a
 * destination cannot be reconciled. This narrows where it is REPEATED, which
 * is the part that was gratuitous.
 */

/** E.164-ish, and deliberately loose: anything number-shaped enough to be a
 *  real destination should be masked, including formats we do not emit. */
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;

/**
 * Mask one number, keeping the country code and the last few digits.
 *
 * Both ends are kept on purpose. A fully starred number makes a log useless -
 * you cannot tell two calls apart, or match a row to a complaint - and a
 * useless log is one nobody keeps, which is how the unmasked version came
 * back. The country code says which market; the tail lets a human confirm
 * "yes, that is the number I typed" without the log carrying a dialable one.
 */
export function maskPhone(value: string | null | undefined, revealLast = 2): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");
  /* Too short to be a destination - a extension, an id, a stray number.
     Masked anyway rather than passed through: guessing that something short
     is harmless is how one gets missed. */
  if (digits.length < 7) return "•".repeat(raw.length);

  const plus = raw.trimStart().startsWith("+") ? "+" : "";
  /* Two digits of country code covers +92 (Pakistan), +1 as a single digit
     stays legible as +1. Deliberately not a country table: this is a display
     nicety and a wrong guess costs nothing but a slightly odd-looking mask. */
  const head = digits.slice(0, 2);
  const tail = revealLast > 0 ? digits.slice(-revealLast) : "";
  const hidden = Math.max(0, digits.length - head.length - tail.length);
  return `${plus}${head}${"•".repeat(hidden)}${tail}`;
}

/**
 * Walk a value and mask every number-shaped string inside it.
 *
 * "Deeply" is the point. Provider payloads are not a shape we control: a
 * recipient array today, a nested attempt list tomorrow, an error body that
 * quotes the request back. Masking the fields we happen to know about leaves
 * the next one unmasked, and the failure is silent - a log that looks clean
 * and is not.
 *
 * Object keys are left alone; only values are rewritten. Cycles are handled,
 * because a provider SDK object may well hold a reference back to its client.
 */
export function deepMaskPhones<T>(value: T, revealLast = 2, seen = new WeakSet()): T {
  if (typeof value === "string") {
    return value.replace(PHONE, m => maskPhone(m, revealLast) ?? m) as unknown as T;
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[circular]" as unknown as T;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map(v => deepMaskPhones(v, revealLast, seen)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = deepMaskPhones(v, revealLast, seen);
  }
  return out as unknown as T;
}

/**
 * Mask a value for a log line, as JSON.
 *
 * One call rather than remembering to wrap each argument, because the sites
 * this replaces were `JSON.stringify(body)` and the mistake to prevent is
 * someone adding a third one.
 */
export function maskedJson(value: unknown, revealLast = 2): string {
  try {
    return JSON.stringify(deepMaskPhones(value, revealLast));
  } catch {
    return "[unserialisable]";
  }
}
