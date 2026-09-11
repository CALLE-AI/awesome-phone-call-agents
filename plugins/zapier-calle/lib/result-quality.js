// Judges whether an extracted structured_result is actually usable, rather
// than merely present. lib/disposition.js used to accept any object with at
// least one key, which meant `{"qualified": "unknown"}` classified as
// `confirmed` - the exact outcome this integration exists to refuse.
//
// The unknown-token list is deliberately identical to the one the sibling
// contribution skills/calle-script-advisor enforces when it lints a result
// schema. That linter tells authors to add an `unknown` enum member for calls
// that cannot produce evidence, per CALL-E's own documented guidance
// ("Prefer string enums over booleans for business decisions that may be
// unclear, and include an `unknown` enum value when the call may not provide
// enough evidence" - CreateCallRequest.result_schema). Advising authors to
// emit `unknown` and then treating it as a success downstream would make the
// two halves of this contribution contradict each other. Keep the two lists
// in sync.
import { toFiniteNumber } from './coerce.js';

const UNKNOWN_VALUE_TOKENS = new Set(['unknown', 'unclear', 'not_stated', 'undetermined']);

// Matches lib/result-schema.js. A structured_result is parsed JSON, so it
// cannot contain a cycle; this only bounds absurdly deep nesting.
const MAX_DEPTH = 20;
const MAX_REPORTED_PATHS = 3;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// "Empty" means CALL-E returned the field but put nothing usable in it. A
// literal `false` and a literal `0` are real extracted answers and must not
// be treated as absent - the whole point of a boolean field is that one of
// its two values is falsy.
export function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

export function isUnknownValue(value) {
  return typeof value === 'string' && UNKNOWN_VALUE_TOKENS.has(value.trim().toLowerCase());
}

function joinPath(prefix, key) {
  return prefix ? `${prefix}.${key}` : key;
}

// Schema-guided walk: only the fields the caller declared `required` are
// checked, at every level of nesting the schema declares. A field the caller
// did not require coming back `unknown` is not a defect - they said it was
// optional.
function walkRequired(schema, value, prefix, depth, unusable) {
  if (depth > MAX_DEPTH || !isPlainObject(schema)) return;

  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties = isPlainObject(schema.properties) ? schema.properties : {};

  for (const key of required) {
    if (typeof key !== 'string') continue;
    const path = joinPath(prefix, key);
    const present = isPlainObject(value) && Object.hasOwn(value, key);
    const item = present ? value[key] : undefined;

    if (!present) {
      unusable.push({ path, why: 'missing' });
    } else if (isEmptyValue(item)) {
      unusable.push({ path, why: 'empty' });
    } else if (isUnknownValue(item)) {
      unusable.push({ path, why: 'unknown' });
    } else if (isPlainObject(item)) {
      walkRequired(properties[key], item, path, depth + 1, unusable);
    }
  }
}

// Schemaless walk: used by the Call Completed trigger and Find Call Result,
// which see a finished call without ever seeing the result_schema it was
// placed with. Nothing here can detect a *missing* field - there is no
// declaration to compare against - so it reports only fields that are present
// and unusable.
function walkAll(value, prefix, depth, unusable) {
  if (depth > MAX_DEPTH || !isPlainObject(value)) return;

  for (const [key, item] of Object.entries(value)) {
    const path = joinPath(prefix, key);
    if (isUnknownValue(item)) {
      unusable.push({ path, why: 'unknown' });
    } else if (isEmptyValue(item)) {
      unusable.push({ path, why: 'empty' });
    } else if (isPlainObject(item)) {
      walkAll(item, path, depth + 1, unusable);
    }
  }
}

// Returns every field that cannot be acted on, each tagged with why. An empty
// array means the result is safe to treat as an answer.
export function findUnusableFields(structuredResult, schema) {
  const unusable = [];
  try {
    if (isPlainObject(schema)) {
      walkRequired(schema, structuredResult, '', 0, unusable);
    } else {
      walkAll(structuredResult, '', 0, unusable);
    }
  } catch {
    // A hostile object with a throwing getter must not escape as an
    // exception; an unreadable result is by definition not actionable.
    return [{ path: '(unreadable)', why: 'unknown' }];
  }
  return unusable;
}

const WHY_TEXT = {
  missing: 'was not returned',
  empty: 'came back empty',
  unknown: 'came back as an unknown-like value',
};

export function describeUnusableFields(unusable) {
  const shown = unusable.slice(0, MAX_REPORTED_PATHS);
  const parts = shown.map((entry) => `${entry.path} ${WHY_TEXT[entry.why] || 'was not usable'}`);
  const remainder = unusable.length - shown.length;
  const tail = remainder > 0 ? `, and ${remainder} more field${remainder === 1 ? '' : 's'}` : '';
  return `${parts.join('; ')}${tail}`;
}

export const DEFAULT_MIN_CONFIDENCE_SCORE = 0.6;

// CALL-E's CompletionConfidence schema declares `score` as required and
// bounded 0-1, while `label` is documented only as free text ("for example
// low, medium, or high"). Checking the label alone therefore trusts the
// looser of the two fields: a `high` label carrying a 0.05 score used to
// classify as confirmed. Enforcement is on by default because a score is
// always supposed to be there; a caller who wants the old label-only
// behavior sets the threshold to 0.
export function checkConfidenceScore(confidence, minScore) {
  // A floor of 0 disables the check outright rather than merely admitting
  // every score: "accept the confidence label alone" has to also accept a
  // payload that carried no score, or the opt-out would not be an opt-out.
  if (minScore === null || minScore === undefined || minScore <= 0) {
    const rawScore = confidence && confidence.score;
    return { ok: true, score: typeof rawScore === 'number' ? rawScore : null };
  }

  const score = confidence && confidence.score;
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return {
      ok: false,
      score: null,
      reason: 'Completion confidence carried no numeric score, which CALL-E always supplies for a terminal result.',
    };
  }
  if (score < minScore) {
    return {
      ok: false,
      score,
      reason: `Completion confidence score ${score} is below the required minimum of ${minScore}.`,
    };
  }
  return { ok: true, score };
}

// Fail closed: an unparseable threshold leaves enforcement on at the default
// rather than silently disabling the check. Only an explicit, in-range number
// (including 0, which turns the check off deliberately) is honored.
export function toMinConfidenceScore(value, fallback = DEFAULT_MIN_CONFIDENCE_SCORE) {
  const parsed = toFiniteNumber(value, fallback);
  if (parsed < 0 || parsed > 1) return fallback;
  return parsed;
}
