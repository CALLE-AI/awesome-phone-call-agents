/**
 * Decide what one CALL-E call actually achieved. Three outcomes, not two.
 *
 * This is the only interesting logic in the recipe and it is kept in its own file so it
 * can be tested with `node --test` before it is pasted into a workflow node. The copy
 * inside `absence-wave.workflow.json` is generated from this file, and
 * `classify.test.mjs` fails if the two ever drift apart.
 *
 * The rule it implements, and why each branch exists:
 *
 *   resolved      A result came back and at least one required field says something.
 *   undetermined  A conversation happened and produced nothing usable. Two shapes:
 *                 `structured_result` is null, or every required field is uninformative.
 *   failed        Nobody was reached on any number.
 *
 * A second, independent axis rides alongside those three:
 *
 *   escalation    "safeguarding" when the parent did not confirm they already knew their
 *                 child was absent. It is not a fourth resolution. Making it one would mean
 *                 a call could be counted in two buckets or in neither, and the three
 *                 outcomes above exist to be counted. A safeguarding call is still
 *                 `resolved`: the answer arrived and it was schema-valid. What changes is
 *                 that it is not closed automatically and a person owes it a callback.
 *
 * The middle outcome is the point. A pipeline with two buckets has to file
 * "the call connected but we learned nothing" somewhere, and filing it with the
 * successes is how a dashboard reports full coverage for a child nobody heard about.
 *
 * Both `undetermined` shapes were found by placing real calls, not by reading the API
 * docs. The second one is the subtle one: CALL-E returns a schema-valid result with every
 * required field set to "unknown" when the person says "I cannot talk now". That is a
 * correct response to an honest enum and it is worth nothing.
 */

/** Values that mean the question was asked and not answered. */
const UNINFORMATIVE = new Set(["unknown"]);

/** Required by the absence schema. Only these count towards uninformative. */
const REQUIRED_FIELDS = ["reason_category", "expected_return"];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Every required field uninformative means nothing was learned.
 *
 * `all`, not `any`. One field answered is still an answer, and treating a single unknown
 * as failure would push resolved cases back onto a person's desk for no reason.
 */
function isUninformative(result) {
  if (!isObject(result) || REQUIRED_FIELDS.length === 0) {
    return false;
  }
  return REQUIRED_FIELDS.every((name) => {
    const value = result[name];
    return typeof value === "string" && UNINFORMATIVE.has(value.trim().toLowerCase());
  });
}

/**
 * Pull the structured result for one recipient.
 *
 * Deliberately never falls back to a task-level `structured_result`. On a fan-out call
 * that fallback files one family's answer against another family's child, which is a
 * data-protection incident rather than a bug. If this recipient has no result of its own,
 * it has no result.
 */
function recipientResult(recipient) {
  if (!isObject(recipient)) {
    return null;
  }
  const result = recipient.structured_result;
  return isObject(result) ? result : null;
}

/**
 * The last attempt is the one that decides the call.
 *
 * A student with two guardian numbers may fail on the first and connect on the second.
 * Reading the first attempt would cite the id of the attempt that did not connect and
 * report a reached family as unreachable.
 */
function lastAttempt(recipient) {
  const attempts = isObject(recipient) && Array.isArray(recipient.attempts)
    ? recipient.attempts
    : [];
  return attempts.length > 0 ? attempts[attempts.length - 1] : null;
}

function attemptCount(recipient) {
  return isObject(recipient) && Array.isArray(recipient.attempts)
    ? recipient.attempts.length
    : 0;
}

/**
 * Minutes a school has to return a safeguarding call before the window is missed.
 *
 * Not a legal figure. It is the number this recipe prints so the queue carries a deadline
 * instead of an adjective, and a school with a different policy should change it here.
 */
export const SAFEGUARDING_CALLBACK_MINUTES = 30;

/**
 * Did the parent confirm they already knew their child was not in school?
 *
 * Fails closed. Anything that is not an explicit "yes", including a missing field, an
 * "unknown", or a value nobody anticipated, escalates. The cost of escalating a call that
 * did not need it is a phone call. The cost of the other mistake is a child nobody looked
 * for, so the two errors are not worth trading against each other.
 */
export function safeguardingEscalation(result) {
  const confirmed = isObject(result) ? result.parent_confirmed_aware : undefined;
  return String(confirmed === undefined || confirmed === null ? "" : confirmed)
    .trim()
    .toLowerCase() === "yes"
    ? "none"
    : "safeguarding";
}

/**
 * Classify one recipient of one call.
 *
 * Returns { resolution, reason, attempts, providerCallId, escalation, needsAHuman }.
 */
export function classifyRecipient(recipient) {
  const attempts = attemptCount(recipient);
  const last = lastAttempt(recipient);
  const providerCallId = isObject(last) && typeof last.provider_call_id === "string"
    ? last.provider_call_id
    : null;

  const connected = isObject(recipient) && recipient.status === "completed";

  if (!connected) {
    return {
      resolution: "failed",
      reason: `nobody answered after trying ${attempts} number(s)`,
      attempts,
      providerCallId,
      escalation: "none",
      needsAHuman: true,
    };
  }

  const result = recipientResult(recipient);

  if (result === null) {
    return {
      resolution: "undetermined",
      reason: "the call completed but returned no structured result",
      attempts,
      providerCallId,
      escalation: "none",
      needsAHuman: true,
    };
  }

  if (isUninformative(result)) {
    return {
      resolution: "undetermined",
      reason: "every required field came back unknown, so nothing was learned",
      attempts,
      providerCallId,
      escalation: "none",
      needsAHuman: true,
    };
  }

  const escalation = safeguardingEscalation(result);

  return {
    resolution: "resolved",
    reason: escalation === "safeguarding"
      ? "schema-valid answer received, escalated as safeguarding and not closed automatically"
      : "schema-valid answer received",
    attempts,
    providerCallId,
    escalation,
    needsAHuman: escalation !== "none",
  };
}

/**
 * Mask a number for display. Never print a family's phone number into an execution log.
 */
export function maskNumber(value) {
  if (typeof value !== "string" || value.length < 4) {
    return "****";
  }
  return `${value.slice(0, 3)}${"*".repeat(Math.max(0, value.length - 6))}${value.slice(-3)}`;
}

/**
 * Roll a wave up into the three counts plus the queue that still needs a person.
 *
 * `skipped` is separate from `failed` on purpose: a row with no recorded consent was never
 * dialled, so counting it as a failure would report a call that never happened.
 */
export function summariseWave(rows) {
  const counts = { resolved: 0, undetermined: 0, failed: 0, skipped: 0 };
  const queue = [];
  let attemptsBilled = 0;
  let attemptsResolved = 0;
  let escalated = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const resolution = row && row.resolution;
    if (!Object.prototype.hasOwnProperty.call(counts, resolution)) {
      continue;
    }
    counts[resolution] += 1;
    const isEscalated = row.escalation === "safeguarding";
    if (isEscalated) {
      escalated += 1;
    }
    const attempts = Number.isInteger(row.attempts) ? row.attempts : 0;
    attemptsBilled += attempts;
    // An escalated call is resolved and is not closed, so its attempts are still somebody's
    // work. Counting them as saved would report a saving on the calls that cost the most.
    if (resolution === "resolved" && !isEscalated) {
      attemptsResolved += attempts;
    }
    if (row.needsAHuman) {
      queue.push({ id: row.id, reason: row.reason, escalation: row.escalation || "none" });
    }
  }

  // Safeguarding cases sort to the top of the queue. A list where the urgent row is third
  // is a list that gets worked from the top.
  queue.sort((a, b) => (b.escalation === "safeguarding") - (a.escalation === "safeguarding"));

  const attempted = counts.resolved + counts.undetermined + counts.failed;
  // `closed` is the honest numerator. `resolved` counts every schema-valid answer, and an
  // escalated one is not finished with, so a rate computed from `resolved` would rise every
  // time the recipe found something serious.
  const closed = counts.resolved - escalated;
  return {
    counts,
    attempted,
    escalated,
    closed,
    safeguardingCallbackMinutes: SAFEGUARDING_CALLBACK_MINUTES,
    attemptsBilled,
    attemptsResolved,
    attemptsOpen: attemptsBilled - attemptsResolved,
    resolutionRate: attempted === 0 ? null : closed / attempted,
    queue,
  };
}

export const RULES = { UNINFORMATIVE, REQUIRED_FIELDS };
