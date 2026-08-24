// Detects a revocation of consent spoken during the call.
//
// The Do Not Call List input in lib/suppression.js only stops a number the
// caller already knew about. It cannot close the loop, because the moment a
// person actually says "stop calling me" is inside a transcript nobody reads.
// The FCC's revocation rule (effective April 2025) requires that a request to
// stop be honored when made through "any reasonable means" - which includes
// saying so on the call - and honored within 10 days. An integration that
// reports such a call as a confirmed business result, and lets a Zap advance
// the outreach sequence, is the automated version of ignoring it.
//
// NOTE: This is a phrase list over English text, not intent classification.
// Its ceiling is that it will miss a revocation phrased in any other language
// or in a form not listed here, and it can over-trigger on a conditional
// request ("don't call me before five"). Both failures are deliberate: a miss
// leaves the pre-existing behavior unchanged, and an over-trigger only routes
// the call to a human. Upgrade path is a schema field - ask CALL-E to extract
// `opt_out_requested` as an enum with an `unknown` member, which puts the
// judgment in the extraction model where it belongs, and keep this as the
// backstop for callers who did not add that field.
import { normalizeSpeech } from './transcript.js';

const OPT_OUT_PHRASES = [
  'stop calling',
  'stop contacting',
  'quit calling',
  'do not call me',
  'dont call me',
  'never call me',
  'no more calls',
  'take me off',
  'remove me from',
  'remove my number',
  'delete my number',
  'unsubscribe',
  'opt out',
  'opt me out',
];

const MAX_EXCERPT_LENGTH = 300;

const normalize = normalizeSpeech;

const NORMALIZED_PHRASES = OPT_OUT_PHRASES.map((phrase) => ({
  phrase,
  normalized: normalize(phrase),
}));

function truncate(text) {
  const value = String(text);
  return value.length > MAX_EXCERPT_LENGTH ? `${value.slice(0, MAX_EXCERPT_LENGTH)}...` : value;
}

const notRequested = () => ({
  requested: false,
  matchedPhrase: null,
  excerpt: null,
  offsetSeconds: null,
});

// Only `user` turns are scanned. The bot reads the caller's own script, which
// routinely contains the opt-out language required by state bot-disclosure
// laws ("say stop calling and we won't call again") - matching on that would
// mark every compliant call as a revocation.
export function detectOptOut(recipients) {
  try {
    const turns = (Array.isArray(recipients) ? recipients : [])
      .flatMap((recipient) => (recipient && recipient.attempts) || [])
      .flatMap((attempt) => (attempt && attempt.transcript_turns) || [])
      .filter((turn) => turn && turn.speaker === 'user' && typeof turn.text === 'string');

    for (const turn of turns) {
      const normalized = normalize(turn.text);
      const hit = NORMALIZED_PHRASES.find((entry) => normalized.includes(entry.normalized));
      if (hit) {
        return {
          requested: true,
          matchedPhrase: hit.phrase,
          excerpt: truncate(turn.text),
          offsetSeconds: typeof turn.offset_seconds === 'number' ? turn.offset_seconds : null,
        };
      }
    }
    return notRequested();
  } catch {
    // A malformed transcript is not evidence of a revocation. Failing closed
    // here would mean flagging every unreadable payload as an opt-out, which
    // would train users to ignore the flag - the opposite of safe.
    return notRequested();
  }
}

export const OPT_OUT_REASON =
  'The recipient asked not to be called again during this call. Honor the request before any ' +
  'further contact: the FCC revocation rule accepts a request made by any reasonable means and ' +
  'requires it to be honored within 10 days. Add this number to your Do Not Call List.';
