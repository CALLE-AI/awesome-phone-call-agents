/** Intentionally small accepted language surface. Unparsed phrasing needs review. */
export const normalize = (v: string) =>
  v
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
export const compact = (v: string) => normalize(v).replace(/[^a-z0-9]/g, "");
export const uncertain =
  /\b(not|cannot|can't|couldn't|unable|unconfirmed|pending|probably|maybe|might|should|subject to|unless|if|once|until|awaiting|estimated|tentative|think|assume|guess|believe|expect|hopefully|don't|doesn't|isn't|wasn't|won't|haven't)\b/i;
export const billingWords =
  /\b(bill(?:ing)?|charg(?:e|es|ing)|off[ -]?rent|off[ -]?hire)\b/i;
export const positiveCutoff =
  /\b(?:billing|charges?|rental charges?)\s+(?:(?:has|have|will|is|are)\s+)?(?:stop(?:ped|s)?|end(?:ed|s)?|ceas(?:e|ed|es))\b|\b(?:confirmed|recorded|marked)\s+off[ -]?(?:rent|hire)\b|\bno (?:further|more) (?:rental )?charges?\s+(?:will )?(?:accrue|apply)\b/i;
export const continuesBilling =
  /\b(?:billing|charges?|rental charges?)\s+(?:(?:has|have|will|is|are|still)\s+)*(?:continu(?:e|es|ing)|accru(?:e|es|ing)|running|active)\b|\bstill\s+(?:being\s+)?(?:billed|billing|charged)\b/i;
export const correction =
  /\b(correction|correct that|actually|sorry|wait|mistake|wrong|disregard|instead)\b/i;
export function containsIdentifier(quote: string, value: string): boolean {
  const tokens = normalize(quote).match(/[a-z0-9]+(?:[-–— ][a-z0-9]+)*/g) || [];
  // A boundary must surround the entire identifier. SL-2040 is not SL-204.
  const escaped = value
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[-–— ]/g, "[-–— ]?");
  return (
    !!tokens.length &&
    new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(quote)
  );
}
const months = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
/** Verify that the extracted cutoff is represented by the supplied callee turn.
 * Accept explicit ISO or English month/day/year + numeric time + named timezone.
 * Never silently convert unrecognized words into a confirmed financial fact.
 */
export function cutoffSupported(
  iso: string,
  quote: string,
  timezone: string,
): boolean {
  const match = iso.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match || !Number.isFinite(Date.parse(iso))) return false;
  const [, y, m, d, h, min, sec] = match;
  if (
    Number(m) < 1 ||
    Number(m) > 12 ||
    Number(d) < 1 ||
    Number(h) > 23 ||
    Number(min) > 59 ||
    Number(sec || 0) > 59
  )
    return false;
  if (
    new Date(`${y}-${m}-${d}T00:00:00Z`).toISOString().slice(0, 10) !==
    `${y}-${m}-${d}`
  )
    return false;
  if (normalize(quote).includes(normalize(iso))) return true;
  if (Number(sec || 0) !== 0) return false;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h23",
      timeZoneName: "long",
    }).formatToParts(new Date(iso));
  } catch {
    return false;
  }
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value || "";
  // Extracted local date/time must agree with the configured supplier timezone.
  if (
    Number(part("year")) !== Number(y) ||
    Number(part("month")) !== Number(m) ||
    Number(part("day")) !== Number(d) ||
    Number(part("hour")) !== Number(h) ||
    Number(part("minute")) !== Number(min)
  )
    return false;
  const q = normalize(quote);
  const month = months[Number(m) - 1];
  const dateRx = new RegExp(
    `\\b(?:${month}|${month.slice(0, 3)}\\.?)\\s+${Number(d)}(?:st|nd|rd|th)?[,]?\\s+${y}\\b|\\b${y}-${m}-${d}\\b`,
    "i",
  );
  const h12 = Number(h) % 12 || 12;
  const ampm = Number(h) < 12 ? "a\\.?m\\.?" : "p\\.?m\\.?";
  const timeRx = new RegExp(
    `\\b${h12}(?::${min})?\\s*${ampm}(?=$|[^a-z])|\\b${h}:${min}\\b`,
    "i",
  );
  // Omitting minutes is valid only for the top of the hour.
  const timeExact =
    Number(min) === 0
      ? timeRx.test(q)
      : new RegExp(
          `\\b${h12}:${min}\\s*${ampm}(?=$|[^a-z])|\\b${h}:${min}\\b`,
          "i",
        ).test(q);
  const longZone = normalize(part("timeZoneName"));
  const shortZone =
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    })
      .formatToParts(new Date(iso))
      .find((p) => p.type === "timeZoneName")
      ?.value.toLowerCase() || "";
  const zoneSupported =
    (!!longZone && q.includes(longZone)) ||
    (!!shortZone &&
      new RegExp(
        `\\b${shortZone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i",
      ).test(q));
  return dateRx.test(q) && timeExact && zoneSupported;
}

export function positiveBillingQuote(quote: string): boolean {
  if (
    !positiveCutoff.test(quote) ||
    uncertain.test(quote) ||
    continuesBilling.test(quote) ||
    quote.includes("?")
  )
    return false;
  if (
    /\bno\b/i.test(quote) &&
    !/\bno (?:further|more) (?:rental )?charges?\s+(?:will )?(?:accrue|apply)\b/i.test(
      quote,
    )
  )
    return false;
  return true;
}

const collectionBoundary =
  /\b(?:pickup|pick[ -]?up|collection|collect(?:ed|ing)?|truck|driver|delivery)\b/i;
export function cutoffClauseSupported(
  iso: string,
  quote: string,
  timezone: string,
): boolean {
  const clauses = quote.split(/(?<=[.!?])\s+|;\s*/);
  return clauses.some((sentence) => {
    const scope = sentence.split(collectionBoundary)[0];
    if (!positiveCutoff.test(scope)) return false;
    const times =
      scope.match(
        /\b\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?\b|\b\d{1,2}:\d{2}(?::\d{2})?\b/gi,
      ) || [];
    if (times.length !== 1 && !scope.includes(iso)) return false;
    return cutoffSupported(iso, scope, timezone);
  });
}
export function offRentReferenceSupported(
  quote: string,
  reference: string,
): boolean {
  if (!reference || uncertain.test(quote) || quote.includes("?")) return false;
  return quote.split(/(?<=[.!?])\s+|;\s*/).some((sentence) => {
    const scope = sentence.split(collectionBoundary)[0];
    return (
      /\boff[ -]?(?:rent|hire)\b/i.test(scope) &&
      containsIdentifier(scope, reference)
    );
  });
}

/** Keep collection facts independent of provider labels and paraphrased dates. */
export function pickupSupported(
  quote: string,
  status: string,
  window: string,
): boolean {
  if (
    uncertain.test(quote) ||
    /\b(no|cancell?ed|rescheduled|postponed)\b/i.test(quote) ||
    quote.includes("?")
  )
    return false;
  if (status === "scheduled")
    return (
      !!window.trim() &&
      quote
        .split(
          /(?<=[.!?])\s+|;\s*|,\s*(?:and\s+)?(?=(?:our|office|billing|the office)\b)/i,
        )
        .some((clause) => {
          const scheduled = clause.match(
            /\b(?:collection|pick[ -]?up)\s+(?:(?:is|has been)\s+)?(?:scheduled|booked|confirmed|arranged)\b(.*)/i,
          );
          return (
            !!scheduled && normalize(scheduled[1]).includes(normalize(window))
          );
        })
    );
  if (status === "requested")
    return /\b(?:collection|pick[ -]?up)\s+(?:(?:is|was|has been)\s+)?requested\b/i.test(
      quote,
    );
  if (status === "collected")
    return /\b(?:asset|equipment|machine|unit|it)\s+(?:(?:has been|was|is|already)\s+)+(?:physically\s+)?(?:collected|picked up)\b|\b(?:collection|pick[ -]?up)\s+(?:is|has been)\s+completed\b/i.test(
      quote,
    );
  return false;
}
