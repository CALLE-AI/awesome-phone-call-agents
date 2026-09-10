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
 *   escalation    "safeguarding" unless the parent confirmed they already knew their
 *                 child was absent and the call came away with a day the child returns.
 *                 Both halves are needed: a parent telling this recipe their daughter
 *                 boarded the school bus and never arrived is a confirmation, and it is
 *                 not a closeable record. It is not a fourth resolution. Making it one would mean
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

/**
 * The same subset of the absence schema the Python surface validates against.
 *
 * The two surfaces used to disagree here by omission. `dispatch/validation.problems()`
 * re-checks the shape of every result before anything is done with it, because a CALL-E
 * webhook is unsigned and a result that drives a real decision should not be trusted on
 * the strength of one hop. This recipe had no equivalent, so a result carrying a value
 * outside the enum came back `resolved` here and `undetermined` there: the same call, and
 * the verdict that closes the record is the one with no check behind it.
 *
 * Only what the Python subset implements is implemented here: required present and not
 * null, declared type, enum membership. Nothing else. A checker that quietly ignores the
 * rule it does not understand is worse than no checker, so this is a full copy of a small
 * thing rather than a partial copy of a large one.
 */
const RESULT_SCHEMA = {
  required: ["reason_category", "expected_return"],
  properties: {
    reason_category: {
      type: "string",
      enum: ["illness", "medical_appointment", "family_emergency",
        "religious_observance", "transport", "other", "unknown"],
    },
    expected_return: {
      type: "string",
      enum: ["today", "tomorrow", "later_this_week", "longer", "unknown"],
    },
    parent_confirmed_aware: { type: "string", enum: ["yes", "no", "unknown"] },
    free_text_note: { type: "string" },
  },
};

/** Required by the absence schema. Only these count towards uninformative. */
const REQUIRED_FIELDS = RESULT_SCHEMA.required;

/**
 * Every reason `result` does not satisfy the schema above. An empty list means valid.
 */
function schemaProblems(result) {
  if (!isObject(result)) {
    return [`expected an object, got ${result === null ? "null" : typeof result}`];
  }
  const found = [];
  for (const name of RESULT_SCHEMA.required) {
    if (!Object.prototype.hasOwnProperty.call(result, name)) {
      found.push(`missing required field '${name}'`);
    } else if (result[name] === null) {
      found.push(`required field '${name}' is null`);
    }
  }
  for (const [name, rule] of Object.entries(RESULT_SCHEMA.properties)) {
    const value = result[name];
    if (value === undefined || value === null) {
      continue;
    }
    if (rule.type === "string" && typeof value !== "string") {
      const got = Array.isArray(value) ? "array" : typeof value;
      found.push(`'${name}' should be string, got ${got}`);
      continue;
    }
    if (Array.isArray(rule.enum) && !rule.enum.includes(value)) {
      found.push(`'${name}' is ${JSON.stringify(value)}, not one of ${rule.enum.join(", ")}`);
    }
  }
  return found;
}

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
 * The API carries `structured_result` in two places: once per recipient, and once on the
 * task. A real single-recipient call to production came back with the per-recipient field
 * null and the task-level field fully populated, so code that reads only the recipient
 * concludes the call produced nothing and routes a finished conversation to a person. That
 * is a false negative and it is indistinguishable from a genuine failure, which makes it
 * the worst kind.
 *
 * The fallback is restricted to a call with exactly one recipient. On a fan-out the
 * task-level result belongs to no particular person, and guessing which one it describes
 * trades a false negative for a false attribution: one family's answer filed against
 * another family's child, which is a data-protection incident rather than a bug.
 *
 * `dispatch/scheduler.py:_result_for` is the same rule in Python and has been since the
 * call that found it. This surface did not have it, so the two classifiers disagreed on a
 * shape that has actually occurred: PYTHON said resolved and needed nobody, JavaScript
 * said undetermined and put it on a desk. `tests/test_classifier_parity.py` had no fixture
 * of that shape, and its coverage check selected fixtures by which verdicts they produced
 * rather than by what went into them, so a missing input shape could not show up as a gap.
 */
function recipientResult(recipient, call) {
  if (!isObject(recipient)) {
    return null;
  }
  const own = recipient.structured_result;
  if (own !== null && own !== undefined) {
    return isObject(own) ? own : null;
  }
  if (!isObject(call)) {
    return null;
  }
  const recipients = Array.isArray(call.recipients) ? call.recipients : null;
  if (recipients === null || recipients.length !== 1) {
    return null;
  }
  const task = call.structured_result;
  return isObject(task) ? task : null;
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
 * `expected_return` values a school office can act on.
 *
 * The other two members of the enum are not dates: `longer` is a direction of travel, and
 * `unknown` is the call failing to establish one.
 */
const RETURN_IS_A_DATE = new Set(["today", "tomorrow", "later_this_week"]);

/**
 * The categories that carry no account of where a child is.
 *
 * `transport` is what the platform returned for a parent describing the school bus their
 * daughter boarded at 7:30 and never got off, `other` is what it returned for a parent
 * describing a son who cycled off with friends and did not arrive, and `unknown` is the
 * model declining to guess.
 */
const REASON_EXPLAINS_NOTHING = new Set(["transport", "other", "unknown"]);

function lower(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Is this answer safe to close without a person seeing it?
 *
 * Fails closed, and reads three fields rather than one. Anything that is not an explicit
 * "yes" on `parent_confirmed_aware`, including a missing field, an "unknown", or a value
 * nobody anticipated, escalates. So does a confirmed absence with no return date, and an
 * absence whose category explains nothing and whose return was never named.
 *
 * The second half of that is not defensive tidying. On 2026-09-11 two live calls reached
 * a parent who learned from the call that a child who had left for school was not in
 * class, said exactly that, and asked the office to check the classroom. The platform read
 * the parent accounting for the child's morning as an account of the absence and returned
 * `parent_confirmed_aware: "yes"` with `reason_category` of `transport` and of `other`.
 * A rule that reads only the confirmation closes both, and this recipe closed both.
 * `expected_return` came back `unknown` on each, because there is no answer to "when is
 * she back" for a child nobody can find.
 *
 * The cost of escalating a call that did not need it is a phone call. The cost of the
 * other mistake is a child nobody looked for, so the two errors are not worth trading
 * against each other.
 */
export function safeguardingEscalation(result) {
  if (!isObject(result)) {
    return "safeguarding";
  }
  if (lower(result.parent_confirmed_aware) !== "yes") {
    return "safeguarding";
  }
  const back = lower(result.expected_return);
  if (!RETURN_IS_A_DATE.has(back) && back !== "longer") {
    // No return date at all: `unknown`, absent, a non-string, or a word this schema does
    // not define. This is the branch both missing-child calls take.
    return "safeguarding";
  }
  const reason = lower(result.reason_category) || "unknown";
  if (REASON_EXPLAINS_NOTHING.has(reason) && !RETURN_IS_A_DATE.has(back)) {
    // `longer` is enough for an illness, because "in bed for a fortnight, probably back
    // Monday" is an account of where the child is. It is not enough for a category that
    // explains nothing.
    return "safeguarding";
  }
  return "none";
}

/**
 * Classify one recipient of one call.
 *
 * `call` is optional and is the whole call object, needed only to reach a task-level
 * `structured_result` on a single-recipient call. Omitting it is safe and reads the
 * recipient alone; passing it is what makes this agree with the Python classifier on a
 * shape production has produced.
 *
 * Returns { resolution, reason, attempts, providerCallId, escalation, needsAHuman }.
 */
export function classifyRecipient(recipient, call) {
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

  const result = recipientResult(recipient, call);

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

  // Asked once, here, so that every branch holding a result gets the same answer.
  //
  // This branch used to hardcode `escalation: "none"`, and that was the one place the two
  // shipped classifiers disagreed about the rule the whole entry is built around. A call
  // where every required field came back unknown is a call where nobody confirmed they
  // knew a child was absent, which is exactly what the safeguarding flag is for. Python
  // attached it; this did not. The row still reached a human either way, so nothing was
  // dropped. What was lost is the flag: the row did not sort to the top of the queue and
  // was not counted in the "N of these are safeguarding, answer within 30 minutes" figure
  // the argument rests on. A malformed or empty answer that says the serious thing is not
  // less serious for being malformed.
  const escalation = safeguardingEscalation(result);

  const invalid = schemaProblems(result);
  if (invalid.length > 0) {
    return {
      resolution: "undetermined",
      reason: `result did not satisfy the schema: ${invalid.join("; ")}`,
      attempts,
      providerCallId,
      escalation,
      needsAHuman: true,
    };
  }

  if (isUninformative(result)) {
    return {
      resolution: "undetermined",
      reason: "every required field came back unknown, so nothing was learned",
      attempts,
      providerCallId,
      escalation,
      needsAHuman: true,
    };
  }

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
  let escalatedUnresolved = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const resolution = row && row.resolution;
    if (!Object.prototype.hasOwnProperty.call(counts, resolution)) {
      continue;
    }
    counts[resolution] += 1;
    const isEscalated = row.escalation === "safeguarding";
    // Two counts, because `closed` below subtracts one of them from `resolved`.
    //
    // Every escalating row used to land in `escalated`, and until the classifier started
    // flagging the all-unknown branch every escalating row happened to be resolved, so
    // the subtraction balanced by luck. It stops balancing the moment an undetermined row
    // carries the flag: `closed` goes below zero, the resolution rate goes negative, and
    // a report says a wave of calls un-closed cases that were never open.
    if (isEscalated && resolution === "resolved") {
      escalated += 1;
    } else if (isEscalated) {
      escalatedUnresolved += 1;
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
    // Flagged on a call that produced nothing usable. Not subtracted from anything,
    // because it was never counted as resolved in the first place.
    escalatedUnresolved,
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
