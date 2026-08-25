// Pre-dial gates. Everything here runs locally, before any request reaches CALL-E,
// because a call cannot be un-placed. A gate that ran after dialing would be
// documentation, not a control.

import { isE164 } from './mask.mjs';

// Line types that are never dialed. There is no override flag for this list: the
// failure mode - an automated survey occupying a crisis line - is not something an
// apology afterward repairs.
export const BLOCKED_LINE_TYPES = new Set([
  'emergency',
  'after_hours',
  'nurse_triage',
  'crisis',
  'answering_service',
  'on_call',
]);

// Substrings in a listing label that imply an urgent line even when line_type was
// never set. Unknown line types are dialable; unknown-but-suspicious are not.
const SUSPICIOUS_LABEL_RE =
  /\b(emergency|urgent|after[-\s]?hours|on[-\s]?call|triage|crisis|hotline|paging|answering)\b/i;

export const DEFAULT_WINDOW = { startHour: 9, endHour: 17, weekdaysOnly: true };

// Local wall-clock hour and weekday in the office's own timezone. Timezone comes
// from the listing and never from the area code - number portability makes
// area-code inference wrong often enough to place calls at the wrong local hour.
export function localTimeParts(timezone, now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour) % 24;
  const weekday = parts.weekday;
  return { hour, weekday, isWeekend: weekday === 'Sat' || weekday === 'Sun' };
}

export function checkCallingWindow(listing, { now = new Date(), window = DEFAULT_WINDOW } = {}) {
  if (!listing.timezone) {
    return { allowed: false, reason: 'no_timezone' };
  }
  let parts;
  try {
    parts = localTimeParts(listing.timezone, now);
  } catch {
    return { allowed: false, reason: 'bad_timezone' };
  }
  if (window.weekdaysOnly && parts.isWeekend) {
    return { allowed: false, reason: 'weekend', localHour: parts.hour };
  }
  if (parts.hour < window.startHour || parts.hour >= window.endHour) {
    return { allowed: false, reason: 'outside_business_hours', localHour: parts.hour };
  }
  return { allowed: true, localHour: parts.hour };
}

export function checkLineType(listing) {
  const lineType = String(listing.line_type || '').trim().toLowerCase();
  if (BLOCKED_LINE_TYPES.has(lineType)) {
    return { allowed: false, reason: `blocked_line_type:${lineType}` };
  }
  const label = `${listing.label || ''} ${listing.office_name || ''}`;
  if (SUSPICIOUS_LABEL_RE.test(label)) {
    return { allowed: false, reason: 'suspected_urgent_line' };
  }
  return { allowed: true };
}

export function checkSuppression(listing, suppressionList = []) {
  const phone = String(listing.phone || '').trim();
  const hit = suppressionList.some((entry) => String(entry).trim() === phone);
  return hit ? { allowed: false, reason: 'suppressed' } : { allowed: true };
}

// Group listings into one call per office. A practice with nine listed clinicians
// gets one call asking about nine names - calling the same front desk nine times is
// how automated callers get blocked, and it is avoidable with a grouping step.
export function groupByOffice(listings) {
  const offices = new Map();
  for (const listing of listings) {
    const phone = String(listing.phone || '').trim();
    const key = phone || `__no_phone__${listing.listing_id}`;
    if (!offices.has(key)) {
      offices.set(key, {
        office_key: key,
        phone,
        timezone: listing.timezone,
        region: listing.region,
        locale: listing.locale,
        line_type: listing.line_type,
        label: listing.label,
        office_name: listing.office_name,
        listings: [],
      });
    }
    offices.get(key).listings.push(listing);
  }
  return [...offices.values()];
}

// Returns { dialable, skipped, deferred }. Skipped is permanent; deferred means the
// office was fine but the clock was not, so it is worth another run later.
export function applyGates(offices, { suppressionList = [], now = new Date(), window = DEFAULT_WINDOW } = {}) {
  const dialable = [];
  const skipped = [];
  const deferred = [];

  for (const office of offices) {
    if (!isE164(office.phone)) {
      skipped.push({ office, reason: 'bad_number' });
      continue;
    }
    const lineType = checkLineType(office);
    if (!lineType.allowed) {
      skipped.push({ office, reason: lineType.reason });
      continue;
    }
    const suppression = checkSuppression(office, suppressionList);
    if (!suppression.allowed) {
      skipped.push({ office, reason: suppression.reason });
      continue;
    }
    const windowCheck = checkCallingWindow(office, { now, window });
    if (!windowCheck.allowed) {
      deferred.push({ office, reason: windowCheck.reason, localHour: windowCheck.localHour });
      continue;
    }
    dialable.push(office);
  }

  return { dialable, skipped, deferred };
}
