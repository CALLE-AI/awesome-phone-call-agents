/**
 * The callback gate.
 *
 * A callback is a door the person cannot open. So the caller never accepts one
 * and never leaves a number. Instead it asks the single question that converts
 * an inbound obligation into an outbound one:
 *
 *   "I can't take a call back — when should I call you instead?"
 *
 * A window is only ever *agreed* when a callee turn names it, after the caller
 * raised it. Anything else is `window_unconfirmed` and the chain pauses for a
 * human. The caller proposing a time and nobody objecting is not agreement.
 */

import type { AgreedWindow, Turn } from './types';

const CALLBACK_OFFER =
  /\b(call|ring|phone|get back to|reach out to|come back to)\s+(you|him|her|them)\b|\bwe'?ll\s+be\s+in\s+touch\b|\bsomeone\s+will\s+(call|ring|phone)\b|\bhave\s+(?:someone|them|him|her)\s+(call|ring|phone)\b/i;

const NUMBER_REQUEST =
  /\b(what(?:'s| is)?\s+(?:the\s+)?(?:your\s+)?(?:best\s+)?(?:phone\s+|contact\s+|mobile\s+|cell\s+)?number|can\s+I\s+(?:take|get|have)\s+(?:a|your|his|her|their)\s+(?:number|contact|details)|leave\s+(?:me\s+)?(?:a|your)\s+number|number\s+to\s+reach|on\s+what\s+number)\b/i;

const CALLER_DECLINES =
  /\b(can'?t|cannot|unable to|won'?t be able to|not able to)\s+(take|receive|accept|answer|get)\b|\bno\s+number\b|\bnot\s+able\s+to\s+answer\b|\bI'?m\s+not\s+able\s+to\s+take\s+(?:a\s+)?call/i;

const CALLER_ASKS_WINDOW =
  /\bwhen\s+(?:should|shall|can|could|would)\s+I\s+(?:call|ring|phone)\b|\bwhat\s+time\s+(?:should|shall|can|could)\s+I\s+(?:call|ring|phone)\b|\bgood\s+time\s+(?:for\s+me\s+)?to\s+(?:call|ring|phone)\b|\bcall\s+you\s+back\s+(?:at|when)\b/i;

const CALLEE_REFUSES_TO_SCHEDULE =
  /\b(?:can'?t|cannot|won'?t|unable to)\s+(?:say|tell|give|predict|commit|promise)\b|\bno\s+way\s+(?:of|to)\s+know(?:ing)?\b|\bdepends\b.*\bwhen\b|\bit'?s\s+impossible\s+to\s+say\b/i;

export interface TurnMatch {
  matched: boolean;
  turn: Turn | null;
  index: number;
}

function firstMatch(
  turns: Turn[],
  speaker: Turn['speaker'],
  pattern: RegExp,
  fromIndex = 0,
): TurnMatch {
  for (let i = fromIndex; i < turns.length; i += 1) {
    const turn = turns[i];
    if (turn.speaker === speaker && pattern.test(turn.text)) {
      return { matched: true, turn, index: i };
    }
  }
  return { matched: false, turn: null, index: -1 };
}

/** Did the callee offer to ring the person back? */
export function detectCallbackOffer(turns: Turn[]): TurnMatch {
  return firstMatch(turns, 'callee', CALLBACK_OFFER);
}

/** Did the callee ask for a number to reach the person on? */
export function detectNumberRequest(turns: Turn[]): TurnMatch {
  return firstMatch(turns, 'callee', NUMBER_REQUEST);
}

/** Did the callee say they cannot commit to any time? */
export function detectScheduleRefusal(turns: Turn[], fromIndex = 0): TurnMatch {
  return firstMatch(turns, 'callee', CALLEE_REFUSES_TO_SCHEDULE, fromIndex);
}

/**
 * Did the caller actually run the gate — decline the callback *and* ask for a
 * window? Both halves are required. Declining without asking leaves the errand
 * dead; asking without declining invites the callback anyway.
 */
export function callerRanGate(turns: Turn[]): {
  declined: boolean;
  askedForWindow: boolean;
  index: number;
} {
  const declined = firstMatch(turns, 'caller', CALLER_DECLINES);
  const asked = firstMatch(turns, 'caller', CALLER_ASKS_WINDOW);
  return {
    declined: declined.matched,
    askedForWindow: asked.matched,
    index: asked.index,
  };
}

// --- window parsing -------------------------------------------------------

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const PARTS_OF_DAY: Record<string, [number, number]> = {
  morning: [9, 12],
  afternoon: [13, 17],
  evening: [17, 20],
};

function atUtc(base: Date, dayOffset: number, hour: number): Date {
  return new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate() + dayOffset,
      hour,
      0,
      0,
      0,
    ),
  );
}

function dayOffsetFor(text: string, now: Date): number | null {
  if (/\btoday\b|\bthis (morning|afternoon|evening)\b|\blater (today|on)\b/i.test(text)) {
    return 0;
  }
  if (/\btomorrow\b/i.test(text)) return 1;

  const weekdayMatch = text.match(
    /\b(?:(next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
  );
  if (weekdayMatch) {
    const wantsNext = Boolean(weekdayMatch[1]);
    const target = WEEKDAYS.indexOf(weekdayMatch[2].toLowerCase());
    const current = now.getUTCDay();
    let delta = (target - current + 7) % 7;
    if (delta === 0) delta = 7;
    if (wantsNext && delta < 7) delta += 7;
    return delta;
  }

  return null;
}

const HOUR_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  noon: 12, midday: 12,
};

const HOUR_TOKEN =
  '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|noon|midday)';

/** People say "between ten and twelve" at least as often as "between 10 and 12". */
function hourValue(token: string): number | null {
  const word = HOUR_WORDS[token.toLowerCase()];
  if (word !== undefined) return word;
  const n = Number(token);
  return Number.isInteger(n) ? n : null;
}

function hourRangeFor(text: string): [number, number] | null {
  const between = text.match(
    new RegExp(
      `\\bbetween\\s+${HOUR_TOKEN}(?::(\\d{2}))?\\s*(am|pm)?\\s+(?:and|to)\\s+${HOUR_TOKEN}(?::(\\d{2}))?\\s*(am|pm)?`,
      'i',
    ),
  );
  if (between) {
    const rawStart = hourValue(between[1]);
    const rawEnd = hourValue(between[4]);
    if (rawStart !== null && rawEnd !== null) {
      const start = to24(rawStart, between[3] ?? between[6], rawEnd);
      const end = to24(rawEnd, between[6] ?? between[3], null);
      if (start !== null && end !== null && end > start) return [start, end];
    }
  }

  const after = text.match(
    new RegExp(`\\b(?:after|from)\\s+${HOUR_TOKEN}(?::(\\d{2}))?\\s*(am|pm)?`, 'i'),
  );
  if (after) {
    const raw = hourValue(after[1]);
    const start = raw === null ? null : to24(raw, after[3], null);
    if (start !== null) return [start, Math.min(start + 3, 20)];
  }

  const before = text.match(
    new RegExp(`\\bbefore\\s+${HOUR_TOKEN}(?::(\\d{2}))?\\s*(am|pm)?`, 'i'),
  );
  if (before) {
    const raw = hourValue(before[1]);
    const end = raw === null ? null : to24(raw, before[3], null);
    if (end !== null) return [Math.max(end - 3, 8), end];
  }

  const at = text.match(
    new RegExp(
      `\\b(?:at|around|about)\\s+${HOUR_TOKEN}(?::(\\d{2}))?\\s*(am|pm)?`,
      'i',
    ),
  );
  if (at) {
    const raw = hourValue(at[1]);
    const start = raw === null ? null : to24(raw, at[3], null);
    if (start !== null) return [start, Math.min(start + 1, 21)];
  }

  for (const [word, range] of Object.entries(PARTS_OF_DAY)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) return range;
  }

  return null;
}

/**
 * Resolve a bare hour to 24h. Without an am/pm marker, a working-hours reading
 * is assumed for 1–7, because "after two" on a business call is not 2am.
 */
function to24(hour: number, marker: string | undefined | null, pairedWith: number | null): number | null {
  if (hour < 1 || hour > 24) return null;
  const m = marker?.toLowerCase();
  if (m === 'am') return hour === 12 ? 0 : hour;
  if (m === 'pm') return hour === 12 ? 12 : hour + 12;
  if (hour >= 1 && hour <= 7) return hour + 12;
  if (pairedWith !== null && pairedWith <= 7 && hour <= 12) return hour;
  return hour;
}

function relativeHours(text: string): number | null {
  const inHours = text.match(/\bin\s+(?:about\s+|around\s+)?(?:(an|a)|(\d{1,2}))\s+hours?\b/i);
  if (inHours) return inHours[1] ? 1 : Number(inHours[2]);
  if (/\bin\s+(?:about\s+|around\s+)?half\s+an\s+hour\b/i.test(text)) return 1;
  return null;
}

export interface WindowParse {
  window: AgreedWindow;
  /** True when a callee turn named a time the caller can actually call into. */
  confirmed: boolean;
  reason: string;
}

/**
 * Extract the agreed window.
 *
 * Binding rules, in order:
 *  1. The caller must have raised the callback question first.
 *  2. The window must come from a *callee* turn after that point.
 *  3. That turn must name a time, not merely agree in the abstract. "Sure,
 *     that's fine" names nothing and confirms nothing.
 */
export function extractWindow(turns: Turn[], now: Date): WindowParse {
  const empty: AgreedWindow = { start: null, end: null, supporting_turn: null };

  const gate = callerRanGate(turns);
  if (!gate.askedForWindow) {
    return {
      window: empty,
      confirmed: false,
      reason: 'The caller never asked when to call back, so nothing was agreed.',
    };
  }

  for (let i = gate.index + 1; i < turns.length; i += 1) {
    const turn = turns[i];
    if (turn.speaker !== 'callee') continue;

    const hours = relativeHours(turn.text);
    if (hours !== null) {
      const start = new Date(now.getTime() + hours * 3600_000);
      const end = new Date(start.getTime() + 3600_000);
      return {
        window: {
          start: start.toISOString(),
          end: end.toISOString(),
          supporting_turn: turn.text,
        },
        confirmed: true,
        reason: 'A callee turn named a relative time.',
      };
    }

    const range = hourRangeFor(turn.text);
    if (range === null) continue;

    const offset = dayOffsetFor(turn.text, now) ?? 0;
    const start = atUtc(now, offset, range[0]);
    const end = atUtc(now, offset, range[1]);

    if (end <= start) continue;

    return {
      window: {
        start: start.toISOString(),
        end: end.toISOString(),
        supporting_turn: turn.text,
      },
      confirmed: true,
      reason: 'A callee turn named a time.',
    };
  }

  return {
    window: empty,
    confirmed: false,
    reason:
      'The caller asked, but no callee turn named a time. Agreement in the abstract is not a window.',
  };
}
