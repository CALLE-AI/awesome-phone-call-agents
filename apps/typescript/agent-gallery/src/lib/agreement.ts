import type { Agreement } from "./outcome";
import type { ReplacementWindow } from "../types";

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

/** Identifying tokens for a window, rendered in the business timezone. */
function windowTokens(window: ReplacementWindow, timeZone: string): string[] {
  const start = new Date(window.start);
  if (Number.isNaN(start.getTime())) return [];
  const part = (options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(start).toLowerCase();
    } catch {
      return "";
    }
  };
  return [part({ weekday: "long" }), part({ month: "long" }), part({ day: "numeric" }), part({ hour: "numeric", hour12: true })].filter(Boolean);
}

function windowMatches(sentence: string, window: ReplacementWindow, timeZone: string): boolean {
  const [weekday, month, day, hour] = windowTokens(window, timeZone);
  if (!weekday || !hour) return false;
  const text = sentence.toLowerCase();
  const dayNamed = text.includes(weekday) || (text.includes(month) && new RegExp(`\\b${day}\\b`).test(text));
  const hourNamed = text.includes(hour) || text.includes(hour.replace(" ", ""));
  return dayNamed && hourNamed;
}

export function readAgreement(input: {
  summary: string | null;
  transcript: string | null;
  windows: ReplacementWindow[];
  timezone: string;
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

  // An acceptance that names no offered window may be the original slot, but it
  // may equally be an unparsed reschedule, so it is not read as either.
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
