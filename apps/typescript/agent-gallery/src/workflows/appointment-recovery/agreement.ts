import type { Agreement } from "./outcome";
import type { ReplacementWindow } from "./types";

/**
 * Reads what a completed call actually agreed to.
 *
 * CALL-E exposes no custom extraction schema, so the workflow goal instructs the
 * agent to state the result plainly and this reader recovers it from the call's
 * own summary and transcript. Both are untrusted external data: this module only
 * pattern-matches them and never treats their contents as instructions.
 *
 * The reader is deliberately conservative. Every non-null result requires
 * positive evidence, and anything ambiguous returns null so the call classifies
 * as `uncertain` and reaches a human. Reporting "we could not tell" is correct
 * behavior here, not a failure.
 */

export interface AgreementReading {
  agreement: Agreement;
  matchedWindowIndex: number | null;
  smsRequested: boolean | null;
  evidence: string[];
}

interface Utterance {
  speaker: string;
  text: string;
}

const NEGATOR = /\b(?:can'?t|cannot|couldn'?t|won'?t|unable|not|isn'?t|aren'?t|wasn'?t|no longer|never)\b/;

const ACCEPTANCE = /\b(?:booked|book you|confirmed|confirm(?:ing)? (?:you|your|that|the)|scheduled you|locked in|all set|see you (?:on|at)|you'?re (?:down|set) for)\b/;
const REFUSAL = /\b(?:not interested|no thank|don'?t want|do not want|rather not|not looking to|won'?t be (?:rebooking|booking)|cancel (?:it|the appointment)|leave it)\b/;
const UNAVAILABLE = /\b(?:isn'?t one of the (?:available|approved)|not one of the (?:available|approved)|outside (?:the|those|our) (?:available |approved )?windows?|(?:that time|it) (?:is|'s) not available)\b/;
const SMS = /\b(?:sms|text (?:message|confirmation)|text you)\b/;

/**
 * An acceptance that keeps the slot the customer already had.
 *
 * Naming the original time is the stronger signal and is checked separately;
 * this catches the agent that agrees without repeating the time back.
 */
const ORIGINAL =
  /\b(?:original|existing|already (?:booked|scheduled|have)|keep (?:it|that|the|your)|as (?:planned|scheduled)|same (?:time|slot|appointment))\b/;

/** Split "[00:00:12] BOT: text" lines into utterances, joining runs by one speaker. */
export function parseTranscript(transcript: string): Utterance[] {
  const utterances: Utterance[] = [];
  for (const rawLine of transcript.split("\n")) {
    const match = rawLine.match(/^\s*(?:\[[^\]]*\]\s*)?([A-Za-z]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const speaker = match[1].toUpperCase();
    const text = match[2].trim();
    if (!text) continue;
    const previous = utterances[utterances.length - 1];
    // The agent splits one sentence across several lines, which would otherwise
    // separate a negation from the clause it negates.
    if (previous && previous.speaker === speaker) {
      previous.text = `${previous.text} ${text}`;
    } else {
      utterances.push({ speaker, text });
    }
  }
  return utterances;
}

/** Every sentence matching the pattern with no negation preceding the match. */
function allMatchesUnnegated(text: string, pattern: RegExp): string[] {
  const matched: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const found = sentence.match(pattern);
    if (!found) continue;
    const before = sentence.slice(0, found.index ?? 0);
    if (NEGATOR.test(before)) continue;
    matched.push(sentence.trim());
  }
  return matched;
}

/** First sentence matching the pattern with no negation preceding the match. */
function matchesUnnegated(text: string, pattern: RegExp): string | null {
  return allMatchesUnnegated(text, pattern)[0] ?? null;
}

function matchesAnywhere(text: string, pattern: RegExp): string | null {
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (pattern.test(sentence)) return sentence.trim();
  }
  return null;
}

/**
 * When a time is stated, in the terms the operator meant.
 *
 * A `datetime-local` value carries no offset: it is already the business's own
 * wall clock, so its digits are read directly. Re-rendering it through a
 * timezone would move the appointment by the gap between the operator's browser
 * and the business, which is how a 10 AM window became a 10 PM one to match
 * against. A value that does carry an offset is a real instant, so that one is
 * rendered into the business timezone.
 */
interface Clock {
  weekday: string;
  month: string;
  day: number;
  hour24: number;
  minute: number;
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

function clockOf(value: string, timeZone: string): Clock | null {
  let year: number;
  let monthNumber: number;
  let day: number;
  let hour24: number;
  let minute: number;

  const wall = WALL_CLOCK.exec(value ?? "");
  if (wall) {
    [year, monthNumber, day, hour24, minute] = wall.slice(1, 6).map(Number);
  } else {
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return null;
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(instant);
      const value_ = (type: string) => Number(parts.find((part) => part.type === type)?.value);
      year = value_("year");
      monthNumber = value_("month");
      day = value_("day");
      hour24 = value_("hour") % 24;
      minute = value_("minute");
    } catch {
      return null;
    }
    if ([year, monthNumber, day, hour24, minute].some(Number.isNaN)) return null;
  }

  // Named from a UTC date built out of those same digits, so the weekday cannot
  // drift by a day the way a zone conversion can.
  const date = new Date(Date.UTC(year, monthNumber - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  const name = (options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" })
        .format(date)
        .toLowerCase();
    } catch {
      return "";
    }
  };
  const weekday = name({ weekday: "long" });
  const month = name({ month: "long" });
  if (!weekday || !month) return null;
  return { weekday, month, day, hour24, minute };
}

const WORD_HOURS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const MONTH_NAMES =
  "january|february|march|april|may|june|july|august|september|october|november|december";

/**
 * A time as a person actually says it.
 *
 * Agents say "10:00 AM" far more often than "10 AM", and also "10am", "10.00",
 * "ten in the morning", "10 o'clock" and "14:00". Matching on one rendered
 * spelling missed all but one of those and sent correctly handled calls to
 * human review.
 */
interface SpokenTime {
  hour: number;
  minute: number | null;
  meridiem: "am" | "pm" | null;
}

const SPOKEN_TIME = new RegExp(
  String.raw`(\bat\s+)?\b(\d{1,2}|${Object.keys(WORD_HOURS).join("|")})` +
    String.raw`(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?|o'?clock)?` +
    String.raw`(?:\s+in\s+the\s+(morning|afternoon|evening))?` +
    String.raw`(\s+(?:${MONTH_NAMES}))?`,
  "gi",
);

function spokenTimesIn(sentence: string): SpokenTime[] {
  const found: SpokenTime[] = [];
  for (const match of sentence.toLowerCase().matchAll(SPOKEN_TIME)) {
    const [, at, rawHour, rawMinute, suffix, partOfDay, followedByMonth] = match;
    // "Friday 7 August" is a date. Only a number that announces itself as a
    // time — by minutes, a meridiem, "o'clock", or a leading "at" — is one.
    if (followedByMonth) continue;
    if (!rawMinute && !suffix && !partOfDay && !at) continue;

    const hour = WORD_HOURS[rawHour] ?? Number(rawHour);
    if (!Number.isFinite(hour) || hour > 24) continue;

    const marker = suffix?.replace(/\./g, "");
    let meridiem: "am" | "pm" | null = null;
    if (marker === "am" || marker === "pm") meridiem = marker;
    else if (partOfDay === "morning") meridiem = "am";
    else if (partOfDay === "afternoon" || partOfDay === "evening") meridiem = "pm";

    found.push({ hour, minute: rawMinute === undefined ? null : Number(rawMinute), meridiem });
  }
  return found;
}

function spokenMatches(spoken: SpokenTime, clock: Clock): boolean {
  // A stated minute must agree: "10:30" is not the 10:00 window.
  if (spoken.minute !== null && spoken.minute !== clock.minute) return false;
  if (spoken.meridiem) {
    const hour24 = spoken.meridiem === "pm" ? (spoken.hour % 12) + 12 : spoken.hour % 12;
    return hour24 === clock.hour24;
  }
  if (spoken.hour > 12) return spoken.hour === clock.hour24;
  // With no meridiem stated, the hour hand alone has to agree.
  return spoken.hour % 12 === clock.hour24 % 12;
}

/** True when a sentence names both the day and the time of a given clock. */
function mentionsClock(sentence: string, clock: Clock): boolean {
  const text = sentence.toLowerCase();
  const dayNamed =
    text.includes(clock.weekday) ||
    (text.includes(clock.month) && new RegExp(`\\b${clock.day}\\b`).test(text));
  if (!dayNamed) return false;
  return spokenTimesIn(sentence).some((spoken) => spokenMatches(spoken, clock));
}

function windowMatches(sentence: string, window: ReplacementWindow, timeZone: string): boolean {
  const clock = clockOf(window.start, timeZone);
  return clock ? mentionsClock(sentence, clock) : false;
}

export function readAgreement(input: {
  summary: string | null;
  transcript: string | null;
  windows: ReplacementWindow[];
  timezone: string;
  /** The slot the customer already had, so keeping it can be recognized. */
  originalTime?: string | null;
}): AgreementReading {
  const evidence: string[] = [];
  const utterances = input.transcript ? parseTranscript(input.transcript) : [];
  const agentSaid = utterances.filter((u) => u.speaker === "BOT").map((u) => u.text);
  const everything = [...agentSaid, input.summary ?? ""].filter(Boolean);

  // An agent commonly signals agreement and names the slot in separate
  // sentences ("You're all set. I've confirmed you for Saturday at 3 PM"), so
  // every accepting sentence is considered, not only the first.
  const accepting: string[] = [];
  for (const text of agentSaid) accepting.push(...allMatchesUnnegated(text, ACCEPTANCE));

  let acceptance: string | null = accepting[0] ?? null;
  let matchedWindowIndex: number | null = null;
  for (const sentence of accepting) {
    const index = input.windows.findIndex((w) => windowMatches(sentence, w, input.timezone));
    if (index !== -1) {
      acceptance = sentence;
      matchedWindowIndex = index;
      break;
    }
  }

  let refusal: string | null = null;
  for (const text of everything) {
    refusal = matchesUnnegated(text, REFUSAL) ?? refusal;
  }

  let unavailable: string | null = null;
  for (const text of everything) {
    unavailable = matchesAnywhere(text, UNAVAILABLE) ?? unavailable;
  }

  let smsRequested: boolean | null = null;
  for (const text of everything) {
    if (matchesUnnegated(text, SMS)) {
      smsRequested = true;
      break;
    }
  }

  // Conflicting signals are ambiguous, and ambiguity must reach a human.
  if (refusal && acceptance) {
    return {
      agreement: null,
      matchedWindowIndex: null,
      smsRequested,
      evidence: [refusal, acceptance],
    };
  }

  if (refusal) {
    evidence.push(refusal);
    return { agreement: "refused", matchedWindowIndex: null, smsRequested, evidence };
  }

  if (acceptance && matchedWindowIndex !== null) {
    evidence.push(acceptance);
    return { agreement: "accepted_window", matchedWindowIndex, smsRequested, evidence };
  }

  // An acceptance that keeps the existing slot, either by naming the original
  // time back or by saying plainly that nothing moved. Without this the
  // `confirmed` outcome was unreachable from a real call, so a customer who
  // simply kept their appointment was reported as `uncertain`.
  if (acceptance) {
    const originalClock = input.originalTime ? clockOf(input.originalTime, input.timezone) : null;
    const keepsOriginal =
      ORIGINAL.test(acceptance) || (originalClock !== null && mentionsClock(acceptance, originalClock));
    if (keepsOriginal) {
      evidence.push(acceptance);
      return { agreement: "confirmed_original", matchedWindowIndex: null, smsRequested, evidence };
    }
  }

  // Any other acceptance names no time this workflow offered or already held,
  // so it stays inconclusive rather than being guessed at.
  if (acceptance) {
    evidence.push(acceptance);
    return { agreement: null, matchedWindowIndex: null, smsRequested, evidence };
  }

  if (unavailable) {
    evidence.push(unavailable);
    return { agreement: "no_valid_window", matchedWindowIndex: null, smsRequested, evidence };
  }

  return { agreement: null, matchedWindowIndex: null, smsRequested, evidence };
}
