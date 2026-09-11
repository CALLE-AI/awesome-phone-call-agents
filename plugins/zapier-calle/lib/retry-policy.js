// Stateless retry-frequency guard, third sibling of lib/calling-window.js and
// lib/suppression.js.
//
// Repeatedly redialling someone who did not answer is the single easiest way
// to turn a useful automation into harassment, and it is the failure mode a
// retry loop in a Zap produces by default - Zapier will happily run the same
// action every time a trigger fires. 47 CFR 64.1200 caps telephone
// solicitations to a residential number, and several state analogues are
// stricter; the defaults here (2 per day, 4 hours apart) are the conservative
// end of common practice rather than a single citable federal number, so they
// are inputs rather than constants.
//
// A Zapier action has no durable storage, so this cannot count attempts by
// itself. The caller supplies the history - from the same spreadsheet row or
// CRM record the Zap is already reading - exactly as they supply the Do Not
// Call List. Inventing storage that does not exist would be worse than being
// honest that there is none.

import { toFiniteNumber } from './coerce.js';

const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;

const notSupplied = () => ({
  enforced: false,
  allowed: true,
  reason: 'No previous attempt history supplied; retry policy not enforced.',
  attemptsInLastDay: 0,
  hoursSinceLastAttempt: null,
});

// Fail closed the same way suppression does: for a guard whose job is to
// refuse, an unreadable input must refuse. A history that cannot be parsed is
// indistinguishable from a history showing the number was just called.
const unreadable = (reason) => ({
  enforced: true,
  allowed: false,
  reason,
  attemptsInLastDay: null,
  hoursSinceLastAttempt: null,
});

function parseTimestamps(previousAttempts) {
  const entries = previousAttempts
    .split(/[,;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const timestamps = [];
  for (const entry of entries) {
    const parsed = Date.parse(entry);
    if (Number.isNaN(parsed)) return { timestamps: null, badEntry: entry };
    timestamps.push(parsed);
  }
  return { timestamps, badEntry: null };
}

export function checkRetryPolicy({
  previousAttempts,
  maxAttemptsPerDay = 2,
  minHoursBetweenAttempts = 4,
  now = new Date(),
} = {}) {
  try {
    if (previousAttempts === undefined || previousAttempts === null) return notSupplied();
    if (typeof previousAttempts !== 'string') {
      return unreadable('Previous attempt history could not be read as text; refusing to dial.');
    }
    if (!previousAttempts.trim()) return notSupplied();

    if (
      !Number.isFinite(maxAttemptsPerDay) ||
      maxAttemptsPerDay < 1 ||
      !Number.isFinite(minHoursBetweenAttempts) ||
      minHoursBetweenAttempts < 0
    ) {
      return unreadable(
        `Retry policy limits are invalid (maxAttemptsPerDay=${maxAttemptsPerDay}, ` +
          `minHoursBetweenAttempts=${minHoursBetweenAttempts}); refusing to dial.`,
      );
    }

    const { timestamps, badEntry } = parseTimestamps(previousAttempts);
    if (!timestamps) {
      return unreadable(
        `Previous attempt history contains an unparseable timestamp ("${badEntry.slice(0, 60)}"); ` +
          'refusing to dial. Use ISO 8601, for example 2026-08-05T14:30:00Z.',
      );
    }
    if (timestamps.length === 0) return notSupplied();

    const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
    if (!Number.isFinite(nowMs)) {
      return unreadable('Current time could not be determined; refusing to dial.');
    }

    // A future-dated attempt means the history is wrong or the clock is, and
    // either way the count cannot be trusted.
    if (timestamps.some((timestamp) => timestamp > nowMs)) {
      return unreadable(
        'Previous attempt history contains a timestamp in the future; refusing to dial.',
      );
    }

    const attemptsInLastDay = timestamps.filter(
      (timestamp) => nowMs - timestamp < MS_PER_DAY,
    ).length;
    const mostRecent = Math.max(...timestamps);
    const hoursSinceLastAttempt = (nowMs - mostRecent) / MS_PER_HOUR;

    if (attemptsInLastDay >= maxAttemptsPerDay) {
      return {
        enforced: true,
        allowed: false,
        reason: `Already attempted ${attemptsInLastDay} time${attemptsInLastDay === 1 ? '' : 's'} in the last 24 hours, which meets the limit of ${maxAttemptsPerDay} per day.`,
        attemptsInLastDay,
        hoursSinceLastAttempt,
      };
    }

    if (hoursSinceLastAttempt < minHoursBetweenAttempts) {
      return {
        enforced: true,
        allowed: false,
        reason: `Last attempt was ${hoursSinceLastAttempt.toFixed(1)} hours ago, less than the required ${minHoursBetweenAttempts} hours between attempts.`,
        attemptsInLastDay,
        hoursSinceLastAttempt,
      };
    }

    return {
      enforced: true,
      allowed: true,
      reason: `${attemptsInLastDay} attempt${attemptsInLastDay === 1 ? '' : 's'} in the last 24 hours and ${hoursSinceLastAttempt.toFixed(1)} hours since the last one; within the retry policy.`,
      attemptsInLastDay,
      hoursSinceLastAttempt,
    };
  } catch {
    return unreadable('Retry policy could not be evaluated; refusing to dial.');
  }
}

// Shared by both create actions so the three retry_* input fields are coerced
// identically, mirroring callingWindowOptionsFromInput.
export function retryPolicyOptionsFromInput(inputData) {
  return {
    previousAttempts: inputData.previous_attempts,
    maxAttemptsPerDay: toFiniteNumber(inputData.retry_max_attempts_per_day, 2),
    minHoursBetweenAttempts: toFiniteNumber(inputData.retry_min_hours_between_attempts, 4),
  };
}
