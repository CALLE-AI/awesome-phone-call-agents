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
 * Classify one recipient of one call.
 *
 * Returns { resolution, reason, attempts, providerCallId, needsAHuman }.
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
      needsAHuman: true,
    };
  }

  if (isUninformative(result)) {
    return {
      resolution: "undetermined",
      reason: "every required field came back unknown, so nothing was learned",
      attempts,
      providerCallId,
      needsAHuman: true,
    };
  }

  return {
    resolution: "resolved",
    reason: "schema-valid answer received",
    attempts,
    providerCallId,
    needsAHuman: false,
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

  for (const row of Array.isArray(rows) ? rows : []) {
    const resolution = row && row.resolution;
    if (!Object.prototype.hasOwnProperty.call(counts, resolution)) {
      continue;
    }
    counts[resolution] += 1;
    const attempts = Number.isInteger(row.attempts) ? row.attempts : 0;
    attemptsBilled += attempts;
    if (resolution === "resolved") {
      attemptsResolved += attempts;
    }
    if (row.needsAHuman) {
      queue.push({ id: row.id, reason: row.reason });
    }
  }

  const attempted = counts.resolved + counts.undetermined + counts.failed;
  return {
    counts,
    attempted,
    attemptsBilled,
    attemptsResolved,
    attemptsOpen: attemptsBilled - attemptsResolved,
    resolutionRate: attempted === 0 ? null : counts.resolved / attempted,
    queue,
  };
}

export const RULES = { UNINFORMATIVE, REQUIRED_FIELDS };
