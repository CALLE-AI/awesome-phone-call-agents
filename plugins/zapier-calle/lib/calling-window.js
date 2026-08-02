// Fail-closed calling-window guard. Per docs/design-principles.md Principle 3
// and 4, a timezone must never be guessed from the phone number, country
// code, locale, or IP - it must be supplied explicitly as an IANA name.
// Supplying it is therefore the opt-in: no timezone means no enforcement,
// and an unusable timezone (invalid, or a raw UTC offset that cannot handle
// daylight saving) must never fall through to allowing a call.

// Matches raw UTC-offset forms such as "+07:00", "-5", "UTC+7", "GMT-05:00".
// A real IANA name always contains only letters, digits, "/", "_", and "-"
// with at least one leading letter, so this pattern cannot false-positive on
// one - "Etc/GMT+7" for example does not match because of the leading "Etc/".
const RAW_OFFSET_RE = /^(UTC|GMT)?\s*[+-]\d{1,2}(:\d{2})?$/i;

function isRawUtcOffset(timezone) {
  return RAW_OFFSET_RE.test(timezone);
}

function isValidTimeZone(timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function hasValidHourBounds(earliestHour, latestHour) {
  return (
    Number.isInteger(earliestHour) &&
    Number.isInteger(latestHour) &&
    earliestHour >= 0 &&
    earliestHour <= 23 &&
    latestHour >= 0 &&
    latestHour <= 23 &&
    earliestHour < latestHour
  );
}

// Returns the local hour (0-23) and short weekday (e.g. "Sun") for `date` in
// `timezone`. Some environments report midnight as hour 24 rather than 0
// under hour12: false; that is normalized here.
function localParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  const hourPart = parts.find((part) => part.type === 'hour');
  const weekdayPart = parts.find((part) => part.type === 'weekday');
  const rawHour = Number(hourPart && hourPart.value);
  const localHour = rawHour === 24 ? 0 : rawHour;
  return { localHour, localWeekday: weekdayPart && weekdayPart.value };
}

const notEnforced = () => ({
  enforced: false,
  allowed: true,
  reason: 'No calling-window timezone supplied; window not enforced.',
  localHour: null,
  localWeekday: null,
});

const blockedClosed = (reason) => ({
  enforced: true,
  allowed: false,
  reason,
  localHour: null,
  localWeekday: null,
});

export function checkCallingWindow(options = {}) {
  const {
    timezone,
    earliestHour = 8,
    latestHour = 21,
    blockSunday = false,
    now = new Date(),
  } = options;

  const tz = typeof timezone === 'string' ? timezone.trim() : '';
  if (!tz) return notEnforced();

  if (isRawUtcOffset(tz)) {
    return blockedClosed(
      `Calling-window timezone "${tz}" looks like a raw UTC offset, not an IANA name such as ` +
        `America/New_York. Raw offsets do not handle daylight saving and are rejected.`,
    );
  }

  if (!isValidTimeZone(tz)) {
    return blockedClosed(`Calling-window timezone "${tz}" is not a recognized IANA timezone name.`);
  }

  if (!hasValidHourBounds(earliestHour, latestHour)) {
    return blockedClosed(
      `Calling-window hours must be integers 0-23 with earliestHour < latestHour ` +
        `(got earliestHour=${earliestHour}, latestHour=${latestHour}).`,
    );
  }

  const { localHour, localWeekday } = localParts(now, tz);

  if (blockSunday && localWeekday === 'Sun') {
    return {
      enforced: true,
      allowed: false,
      reason: `Calling window blocks Sunday calls in the recipient's local timezone (${tz}).`,
      localHour,
      localWeekday,
    };
  }

  const allowed = earliestHour <= localHour && localHour < latestHour;
  return {
    enforced: true,
    allowed,
    reason: allowed
      ? `Local time ${localHour}:00 in ${tz} is inside the allowed calling window (${earliestHour}:00-${latestHour}:00).`
      : `Local time ${localHour}:00 in ${tz} is outside the allowed calling window (${earliestHour}:00-${latestHour}:00).`,
    localHour,
    localWeekday,
  };
}

function toHour(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return typeof value === 'number' ? value : Number(value);
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return Boolean(value);
}

// Shared by both create actions so the four calling_window_* input fields
// are parsed identically wherever they are read, rather than each action
// re-implementing its own coercion of the raw Zapier input strings.
export function callingWindowOptionsFromInput(inputData) {
  return {
    timezone: inputData.calling_window_timezone,
    earliestHour: toHour(inputData.calling_window_earliest_hour, 8),
    latestHour: toHour(inputData.calling_window_latest_hour, 21),
    blockSunday: toBool(inputData.calling_window_block_sunday, false),
  };
}
