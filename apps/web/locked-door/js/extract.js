/**
 * GROUNDED EXTRACTION.
 *
 * The rule this whole product rests on:
 *
 *      A field may hold a value ONLY IF a character span of the transcript
 *      supports it. No span, no value. The value is `unknown`.
 *
 * `assertGrounded` enforces it at construction time and `assertPublishable`
 * enforces it again at the publication gate, so an ungrounded value cannot
 * reach the directory even if a later refactor forgets the rule.
 *
 * The extractor is deterministic and rule-based. It sees only transcript text —
 * it has no access to ground truth. Ambiguous and hedged speech is *supposed*
 * to fall through to `unknown`; that is the safety behaviour, not a bug.
 */

import { QUESTION_TEXT } from './dialogue.js';

export const REVIEW_THRESHOLD = 0.62;

const HEDGE_MARKERS = [
  'i think', 'pretty sure', 'as far as i know', 'it should be', 'last i heard',
  "don't quote me", 'not certain', 'double-check', 'i believe',
];

const NUM_WORD = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** Ordered rules per field. First match wins. */
const RULES = {
  open_now: [
    [/\b(?:we(?:'re| are)\s+(?:currently\s+)?closed|we(?:'re| are)\s+not\s+open|not\s+open\s+right\s+now|we(?:'re| are)\s+not\s+open\s+right\s+now)\b/i, false],
    [/\bnot\s+today\b/i, false],
    [/\b(?:we(?:'re| are)\s+open|open\s+and\s+(?:taking|accepting))\b/i, true],
  ],
  pet_policy: [
    [/\bno\s+pets\b|\bdon't\s+allow\s+any\s+animals\b|\bno\s+animals\b/i, 'no_pets'],
    [/\bcrated?\b|\bin\s+a\s+carrier\b/i, 'crated_pets_only'],
    [/\bservice\s+animals\s+only\b/i, 'service_animals_only'],
    [/\bpets\s+are\s+(?:allowed|welcome)\b|\bpets\s+welcome\b/i, 'pets_allowed'],
  ],
  accessibility: [
    [/\bnot\s+(?:wheelchair\s+)?accessible\b/i, 'not_accessible'],
    [/\bramp\b/i, 'ramp_only'],
    [/\b(?:wheelchair\s+accessible|fully\s+accessible)\b/i, 'fully_accessible'],
  ],
  intake_requirements: [
    [/\breferral\b/i, 'referral_required'],
    [/\bid\b[^.]{0,60}\bnot\s+required\b|\bnobody\s+is\s+turned\s+away\b/i, 'id_requested_not_required'],
    [/\bno\s+id\s+required\b|\bdon't\s+need\s+any\s+id\b/i, 'no_id_required'],
    [/\bphoto\s+id\s+is\s+required\b|\bneed\s+a\s+photo\s+id\b/i, 'photo_id_required'],
  ],
  capacity_status: [
    [/\bnear\s+capacity\b|\bclose\s+to\s+full\b/i, 'near_capacity'],
    [/\bat\s+capacity\b|\bwe(?:'re| are)\s+full\b/i, 'at_capacity'],
    [/\bspace\s+available\b|\bplenty\s+of\s+room\b/i, 'space_available'],
  ],
};

/** Hours needs numeric parsing rather than a lookup, so it gets its own matcher. */
/**
 * Spoken hours. Two things make this harder than a regex over "9am-5pm":
 * people say the meridiem in words ("seven in the morning until nine in the
 * evening"), and they often omit it entirely ("we're open eight to eight").
 * A bare closing hour is read as PM, because a heat-relief site that opens at 8
 * and closes at 8 is not closing at breakfast — and getting that wrong is a
 * 12-hour error on the single most consequential field after open_now.
 */
function matchHours(text) {
  const tokenRe =
    /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|in the morning|in the evening|at night|tonight)?|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b\s*(a\.?m\.?|p\.?m\.?|in the morning|in the evening|at night)?/gi;
  const found = [];
  let m;
  while ((m = tokenRe.exec(text)) !== null) {
    const hour = m[1] ? parseInt(m[1], 10) : m[4] ? NUM_WORD[m[4].toLowerCase()] : null;
    if (!hour || hour > 12) continue;
    found.push({ hour, mer: normalizeMeridiem(m[3] ?? m[5]), start: m.index, end: m.index + m[0].length });
  }
  if (found.length < 2) return null;
  const a = found[0];
  const b = found[1];
  let open = a.hour;
  if (a.mer === 'pm' && open < 12) open += 12;
  let close = b.hour;
  if (b.mer === 'pm' && close < 12) close += 12;
  else if (b.mer === 'am') {
    /* explicitly stated as morning: leave it */
  } else if (close <= 12 && close + 12 > open) close += 12;
  if (close <= open) return null;
  const canonical = `${String(open).padStart(2, '0')}:00-${String(close).padStart(2, '0')}:00`;
  return { value: canonical, start: a.start, end: b.end, tokens: found.length };
}

function normalizeMeridiem(raw) {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/\./g, '');
  if (s === 'am' || s === 'in the morning') return 'am';
  if (s === 'pm' || s === 'in the evening' || s === 'at night' || s === 'tonight') return 'pm';
  return null;
}

function isHedged(text) {
  const lower = text.toLowerCase();
  return HEDGE_MARKERS.some((h) => lower.includes(h));
}

/**
 * Build a grounded extraction. Returns value `unknown` with span `null` whenever
 * no supporting span is found — never a guess.
 */
function ground(field, turn, matchInfo, opts) {
  if (!matchInfo) {
    return {
      field,
      value: 'unknown',
      span: null,
      quote: null,
      confidence: 0,
      hedged: false,
      channel: opts.channel,
      reason: opts.noMatchReason ?? 'no supporting span in transcript',
    };
  }
  const abs = { start: turn.textStart + matchInfo.start, end: turn.textStart + matchInfo.end };
  const hedged = isHedged(turn.text);
  let conf = 0.92;
  if (hedged) conf *= 0.62;
  if (opts.channel === 'voicemail_greeting') conf *= 0.6;
  if (opts.channel === 'ivr_transfer') conf *= 0.95;
  if (matchInfo.tokens && matchInfo.tokens > 3) conf *= 0.85; // several clock numbers -> murkier
  return {
    field,
    value: matchInfo.value,
    span: { turnIndex: turn.index, start: abs.start, end: abs.end },
    quote: turn.text.slice(matchInfo.start, matchInfo.end),
    contextQuote: turn.text,
    confidence: Math.max(0, Math.min(0.99, Number(conf.toFixed(3)))),
    hedged,
    channel: opts.channel,
    reason: hedged ? 'grounded, speaker hedged' : 'grounded in transcript span',
  };
}

/** THE HARD RULE. Throws rather than letting an ungrounded value exist. */
export function assertGrounded(ex) {
  if (ex.value !== 'unknown' && (!ex.span || typeof ex.span.start !== 'number')) {
    throw new Error(
      `CITATION_RULE_VIOLATION: field "${ex.field}" carries value ${JSON.stringify(ex.value)} with no transcript span.`,
    );
  }
  return ex;
}

function findMatch(field, text) {
  if (field === 'hours') return matchHours(text);
  const rules = RULES[field] ?? [];
  for (const [re, value] of rules) {
    const m = re.exec(text);
    if (m) return { value, start: m.index, end: m.index + m[0].length };
  }
  return null;
}

/**
 * Extract every asked field from one attempt's transcript.
 * Answers are scoped to the turns between the agent's question and the next
 * agent turn, so a stray phrase elsewhere in the call cannot be cited as an
 * answer to a question that was never asked.
 */
export function extractFromAttempt(attempt, questions) {
  return extractInner(attempt, questions).map((ex) => ({ ...ex, attemptIndex: attempt.attempt }));
}

function extractInner(attempt, questions) {
  const { turns } = attempt.transcript;
  const out = [];
  const channel = attempt.outcome === 'connected_via_ivr' ? 'ivr_transfer' : 'live_answer';

  /* ---- voicemail: the greeting itself can be evidence, at low confidence ---- */
  if (attempt.outcome === 'voicemail') {
    const greeting = turns.find((t) => t.speaker === 'staff');
    if (greeting) {
      const closed = /\bcurrently\s+closed\b|\bclosed\s+for\s+the\s+season\b/i.exec(greeting.text);
      if (closed) {
        out.push(
          assertGrounded(
            ground('open_now', greeting, { value: false, start: closed.index, end: closed.index + closed[0].length }, {
              channel: 'voicemail_greeting',
            }),
          ),
        );
      }
      const hrs = matchHours(greeting.text);
      if (hrs && questions.includes('hours')) {
        out.push(assertGrounded(ground('hours', greeting, hrs, { channel: 'voicemail_greeting' })));
      }
    }
    for (const f of questions) {
      if (!out.some((o) => o.field === f)) {
        out.push(
          assertGrounded(
            ground(f, null, null, { channel: 'voicemail', noMatchReason: 'voicemail — question never asked' }),
          ),
        );
      }
    }
    return out;
  }

  if (!attempt.connected) {
    return questions.map((f) =>
      assertGrounded(
        ground(f, null, null, { channel: attempt.outcome, noMatchReason: `call outcome: ${attempt.outcome}` }),
      ),
    );
  }

  for (const field of questions) {
    const qIdx = turns.findIndex((t) => t.speaker === 'agent' && t.text === QUESTION_TEXT[field]);
    if (qIdx < 0) {
      out.push(
        assertGrounded(ground(field, null, null, { channel, noMatchReason: 'question not reached before call ended' })),
      );
      continue;
    }
    let hit = null;
    for (let i = qIdx + 1; i < turns.length && turns[i].speaker !== 'agent'; i++) {
      if (turns[i].speaker !== 'staff') continue;
      const m = findMatch(field, turns[i].text);
      if (m) {
        hit = ground(field, turns[i], m, { channel });
        break;
      }
    }
    out.push(assertGrounded(hit ?? ground(field, null, null, { channel, noMatchReason: 'answer did not resolve to a typed value' })));
  }
  return out;
}

/**
 * Merge extractions across attempts for one facility. A later attempt that
 * grounds a field that earlier attempts left unknown wins; two grounded answers
 * that disagree with each other are demoted and sent to review.
 */
export function mergeAttempts(attemptExtractions) {
  const byField = new Map();
  for (const list of attemptExtractions) {
    for (const ex of list) {
      const prev = byField.get(ex.field);
      if (!prev || prev.value === 'unknown') {
        byField.set(ex.field, ex);
      } else if (ex.value !== 'unknown' && !valuesEqual(ex.value, prev.value)) {
        // Two attempts disagree. Keep the better-supported one -- a live human on
        // a callback outranks a recorded greeting that may be months old -- but
        // demote it hard and flag the conflict for a human either way.
        const [win, lose] = ex.confidence > prev.confidence ? [ex, prev] : [prev, ex];
        byField.set(ex.field, {
          ...win,
          confidence: win.confidence * 0.5,
          internalConflict: { otherValue: lose.value, otherQuote: lose.quote, otherChannel: lose.channel },
          reason: `attempts disagreed; kept ${win.channel} over ${lose.channel}`,
        });
      }
    }
  }
  return [...byField.values()].map(assertGrounded);
}

export function valuesEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

export { HEDGE_MARKERS };
