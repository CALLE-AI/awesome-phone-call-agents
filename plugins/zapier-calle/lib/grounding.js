// Checks that an extracted answer is anchored in something the recipient
// actually said.
//
// lib/result-quality.js closed the gap between "a result is present" and "a
// result contains an answer". This closes the next one: an answer that reads
// as a real answer but was never spoken. Every other check in this
// integration reads what the extraction model *concluded*; none of them can
// tell a conclusion drawn from the call apart from one drawn from thin air,
// because both arrive as the same well-formed JSON. A confident
// `{"budget": "over 50k"}` for a call where nobody mentioned money passes
// every existing gate.
//
// The convention is opt-in and lives in the caller's own result_schema: a
// field named `<field>_quote` claims to hold the verbatim line that
// establishes `<field>`. That claim is then verified against the transcript
// rather than trusted, which is the same move lib/reconcile.js makes on
// webhook bodies - a self-reported fact is evidence of nothing until
// something authoritative agrees with it.
//
// A schema with no `_quote` fields is not checked at all, exactly as an
// absent Do Not Call List means suppression is not enforced. Nobody's
// existing Zap changes behavior by upgrading.
//
// NOTE: Matching is normalized substring containment, not semantic
// comparison. Its ceiling has two ends. A model that paraphrases honestly
// ("said they could attend" for "yeah I can make it") is reported as
// ungrounded, which costs a human review rather than a wrong answer. And a
// very short quote ("yes") can match by coincidence, so grounding is weakest
// exactly where the answer is shortest. The upgrade path is asking CALL-E for
// per-field evidence offsets - `transcript_turns` already carries
// `offset_seconds`, so a `<field>_quote_offset` would let this compare
// positions instead of text, and would make a coincidental match impossible.

import { transcriptTurns, normalizeSpeech } from './transcript.js';
import { isEmptyValue, isUnknownValue } from './result-quality.js';

const QUOTE_SUFFIX = '_quote';

// Matches lib/result-quality.js. A structured_result is parsed JSON, so it
// cannot contain a cycle; this only bounds absurdly deep nesting.
const MAX_DEPTH = 20;
const MAX_REPORTED_PATHS = 3;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function joinPath(prefix, key) {
  return prefix ? `${prefix}.${key}` : key;
}

// Only what the recipient said can ground a claim about what the recipient
// answered. The bot's turns are collected separately rather than discarded,
// because a quote that matches only the agent's own script is a specific and
// worth-naming failure: the model cited the question as evidence for the
// answer.
function speech(recipients) {
  const turns = transcriptTurns(recipients).filter((turn) => typeof turn.text === 'string');
  const join = (speaker) =>
    normalizeSpeech(
      turns
        .filter((turn) => turn.speaker === speaker)
        .map((turn) => turn.text)
        .join('   '),
    );
  return { user: join('user'), bot: join('bot'), turnCount: turns.length };
}

function walk(value, transcript, prefix, depth, ungrounded) {
  if (depth > MAX_DEPTH || !isPlainObject(value)) return 0;

  let checked = 0;
  for (const [key, quote] of Object.entries(value)) {
    if (isPlainObject(quote)) {
      checked += walk(quote, transcript, joinPath(prefix, key), depth + 1, ungrounded);
      continue;
    }
    if (!key.endsWith(QUOTE_SUFFIX) || key === QUOTE_SUFFIX) continue;

    const subject = key.slice(0, -QUOTE_SUFFIX.length);
    const path = joinPath(prefix, subject);

    // No claim, nothing to ground. A field the call could not establish is
    // already handled by lib/result-quality.js, and demanding evidence for a
    // non-answer would report the same call twice for the same reason.
    if (Object.hasOwn(value, subject)) {
      const answer = value[subject];
      if (isEmptyValue(answer) || isUnknownValue(answer)) continue;
    }

    checked += 1;

    if (typeof quote !== 'string' || isEmptyValue(quote) || isUnknownValue(quote)) {
      ungrounded.push({ path, why: 'no_quote' });
      continue;
    }
    if (transcript.turnCount === 0) {
      ungrounded.push({ path, why: 'no_transcript' });
      continue;
    }

    const normalized = normalizeSpeech(quote);
    if (normalized === '') {
      ungrounded.push({ path, why: 'no_quote' });
    } else if (transcript.user.includes(normalized)) {
      continue;
    } else if (transcript.bot.includes(normalized)) {
      ungrounded.push({ path, why: 'bot_only' });
    } else {
      ungrounded.push({ path, why: 'not_found' });
    }
  }
  return checked;
}

// `walk` above can only examine quotes the model actually returned, which
// means a model that simply omits one disables the check for that field: no
// `_quote` key, nothing counted, answer waved through. The check would then
// be weakest against precisely the result that had no evidence to offer.
//
// The schema is the fix, because it is the caller's own statement of what
// evidence they demanded, written before the call and not reachable by
// whatever came back from it. When one is supplied, every `<field>_quote` it
// declares is treated as owed. A quote in the schema and absent from the
// result is `no_quote`, exactly as a blank one is.
//
// Only a field carrying a real answer is asked for its evidence: an
// `unknown` answer has no claim to support, and a field the result never
// mentioned is lib/result-quality.js's business, not this module's.
function walkSchema(schemaNode, resultNode, transcript, prefix, depth, ungrounded) {
  if (depth > MAX_DEPTH || !isPlainObject(schemaNode)) return 0;
  const properties = schemaNode.properties;
  if (!isPlainObject(properties)) return 0;

  let checked = 0;
  for (const [key, propertySchema] of Object.entries(properties)) {
    const value = isPlainObject(resultNode) ? resultNode[key] : undefined;

    if (isPlainObject(propertySchema) && isPlainObject(propertySchema.properties)) {
      checked += walkSchema(propertySchema, value, transcript, joinPath(prefix, key), depth + 1, ungrounded);
      continue;
    }
    if (!key.endsWith(QUOTE_SUFFIX) || key === QUOTE_SUFFIX) continue;

    // Present quotes were already handled by `walk`; re-checking here would
    // report the same field twice.
    if (isPlainObject(resultNode) && Object.hasOwn(resultNode, key)) continue;

    const subject = key.slice(0, -QUOTE_SUFFIX.length);
    if (!isPlainObject(resultNode) || !Object.hasOwn(resultNode, subject)) continue;

    const answer = resultNode[subject];
    if (isEmptyValue(answer) || isUnknownValue(answer)) continue;

    checked += 1;
    ungrounded.push({ path: joinPath(prefix, subject), why: 'no_quote' });
  }
  return checked;
}

// Returns every claimed answer whose supporting quote could not be found in
// what the recipient said. `enforced: false` means neither the schema nor the
// result declared a `_quote` field, so nothing was asked of it.
//
// `resultSchema` is the parsed result_schema the call was placed with, when
// the caller had one. The two webhook-driven surfaces that classify a call
// placed elsewhere have none, and fall back to checking the quotes present in
// the result - see README.md, "Transcript grounding".
export function checkGrounding(structuredResult, recipients, resultSchema) {
  const ungrounded = [];
  try {
    const transcript = speech(recipients);
    let checked = walk(structuredResult, transcript, '', 0, ungrounded);
    checked += walkSchema(resultSchema, structuredResult, transcript, '', 0, ungrounded);
    return { enforced: checked > 0, checked, ungrounded };
  } catch {
    // A hostile object with a throwing getter must not escape as an
    // exception. An unverifiable claim is exactly what this module exists to
    // refuse, so it is reported as one rather than waved through.
    return {
      enforced: true,
      checked: 1,
      ungrounded: [{ path: '(unreadable)', why: 'not_found' }],
    };
  }
}

const WHY_TEXT = {
  no_quote: 'was answered without the supporting quote its schema asks for',
  no_transcript: 'cites a quote, but the call produced no transcript to check it against',
  bot_only: 'is supported only by a line the agent itself said, not by the recipient',
  not_found: 'cites a quote that does not appear in what the recipient said',
};

export function describeUngrounded(ungrounded) {
  const shown = ungrounded.slice(0, MAX_REPORTED_PATHS);
  const parts = shown.map((entry) => `${entry.path} ${WHY_TEXT[entry.why] || 'could not be grounded'}`);
  const remainder = ungrounded.length - shown.length;
  const tail = remainder > 0 ? `, and ${remainder} more field${remainder === 1 ? '' : 's'}` : '';
  return `${parts.join('; ')}${tail}`;
}
