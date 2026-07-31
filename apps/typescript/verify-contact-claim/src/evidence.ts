/**
 * Reading what CALL-E sent back.
 *
 * The transcript is the evidence and the extracted result is corroboration, so
 * this module reads the callee turns itself. Three rules make that sound.
 *
 * Only callee turns count, so a sentence the caller read out can never be scored
 * as the answer. Somebody could otherwise write the answer into the claim file.
 *
 * An answer has to come after our question was asked. A sentence somewhere else in
 * the call is evidence about whatever was being discussed there, so an unanchored
 * "we never call about cards" is not an answer about this contact.
 *
 * A refusal to discuss the account wins over a yes or a no in the same turn. It is
 * a statement about the whole call rather than an answer to the question, and
 * reading the yes instead would turn a refusal into a confirmation. That is the one
 * direction that must never happen here.
 */

import type { ContactSignal, TranscriptReading, TranscriptTurn } from "./types.js";

/**
 * The statuses CALL-E ends a call on.
 *
 * This is the whole of `CallStatus` in the Developer API that ends a call:
 * `queued` and `in_progress` are the other two values it can hold. A no answer, a
 * busy line or a voicemail arrives as `failed` with a failure code rather than as a
 * status of its own, so those are read from the code further down and are
 * deliberately not in this set. Anything else means the call may still be talking,
 * so it can never answer the question.
 */
export const TERMINAL_CALL_STATUSES = new Set(["completed", "failed", "canceled"]);

export function isTerminalCallStatus(status: string): boolean {
  return TERMINAL_CALL_STATUSES.has(status.trim().toLowerCase());
}

/**
 * The provider's completion time in milliseconds, or null when it cannot be used.
 *
 * A JSON field arrives as whatever the provider sent, so this is the one place
 * that decides whether there is a usable timestamp at all. Missing, null, empty,
 * unparseable, non finite and the wrong type all come back null, and null fails
 * closed everywhere it is read: without the call's own clock a replay of a call
 * that finished hours ago cannot be told from an answer given just now.
 */
export function completionTime(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (text.length === 0) {
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** An institution declining to discuss somebody else's account. A full answer. */
const REFUSE_PATTERNS: RegExp[] = [
  /\b(?:can'?t|cannot|can not|could not|couldn'?t|won'?t|will not|do not|don'?t|not able to|unable to|not allowed to|not permitted to|not going to)\s+(?:\w+\s+){0,4}(?:confirm|discuss|disclose|share|say|tell|comment|verify|give out|go into)\b/i,
  /\bnot at liberty\b/i,
  /\bI am not (?:able|allowed|permitted)\b/i,
  /\bdata protection\b/i,
  /\bprivacy (?:policy|rules|reasons|act)\b/i,
  /\bconfidentialit/i,
  /\bagainst (?:our |company )?policy\b/i,
  /\bonly (?:speak|discuss|deal) with the (?:account holder|customer|member|cardholder)\b/i,
  /\b(?:the )?(?:account holder|customer|member) (?:has to|must|needs to|would need to|will have to) (?:call|contact|speak)\b/i,
  /\bwith a third part(?:y|ies)\b/i,
];

/** The institution saying the contact was not theirs. */
const DENY_PATTERNS: RegExp[] = [
  /\bno record\b/i,
  /\bnothing (?:on|in) (?:the|our|his|her|their) (?:file|record|records|system|notes|account)\b/i,
  /\bnothing (?:from|on) (?:us|here|our (?:side|end))\b/i,
  /\bnothing (?:here|showing|logged)\b/i,
  /\bwe (?:did not|didn'?t|have not|haven'?t) (?:call|called|contact|contacted|ring|rang|text|texted|message|messaged|reach|reached|leave|left)\b/i,
  /\bnobody (?:here|from (?:here|us|this office)) (?:called|contacted|rang|texted)\b/i,
  /\bthat (?:was|is) not us\b/i,
  /\bnot (?:from|one of) us\b/i,
  /\bno (?:calls?|contact|messages?|texts?|voicemails?) (?:to|for|on)\b/i,
  /\b(?:can'?t|cannot|do not|don'?t|could not|couldn'?t) see (?:any|a|anything)\b/i,
  /\bnot that I can see\b/i,
  /\bno,? (?:we|nobody|nothing|there|not|none)\b/i,
  /^\s*(?:no|nope|negative)\b\W*$/i,
  /\b(?:we|they) would never\b/i,
  /\bnever (?:call|called|contact|contacted|ask)\b/i,
  /\bsounds like a scam\b/i,
];

/** The institution saying the contact was theirs. */
const CONFIRM_PATTERNS: RegExp[] = [
  /\byes\b/i,
  /\bwe did\b(?!\s*not)/i,
  /\bwe (?:called|contacted|rang|texted|messaged|left)\b/i,
  /\bthat (?:was|is) us\b/i,
  /\bit (?:was|is) us\b/i,
  /\bI can see (?:a|the|one) (?:call|contact|note|message)\b/i,
  /\bthere (?:is|was) a (?:call|contact|note|message)\b/i,
  /\b(?:shows|showing) a (?:call|contact|note)\b/i,
  /\bwe do have\b/i,
];

/** Turns that say the line was answered by a machine rather than by a person. */
const MACHINE_PATTERNS: RegExp[] = [
  /\bleave a (?:message|voicemail)\b/i,
  /\bat the tone\b/i,
  /\bis not available\b/i,
  /\bpress \d\b/i,
  /\bmailbox\b/i,
  /\bour (?:office|branch|line) is closed\b/i,
  /\ball (?:of )?our (?:agents|advisers|representatives) are busy\b/i,
];

function earliest(text: string, patterns: RegExp[]): number {
  let found = -1;
  for (const pattern of patterns) {
    const at = text.search(pattern);
    if (at !== -1 && (found === -1 || at < found)) {
      found = at;
    }
  }
  return found;
}

/**
 * What one callee turn says about the contact.
 *
 * A refusal wins wherever it appears in the turn. Between a yes and a no the
 * earliest marker wins, because that is what they answered and the rest of the
 * sentence is usually hedging.
 */
export function signalFromLine(line: string): ContactSignal {
  if (earliest(line, REFUSE_PATTERNS) !== -1) {
    return "refused";
  }
  const denied = earliest(line, DENY_PATTERNS);
  const confirmed = earliest(line, CONFIRM_PATTERNS);
  if (denied === -1 && confirmed === -1) {
    return "unclear";
  }
  if (confirmed === -1) {
    return "denied";
  }
  if (denied === -1) {
    return "confirmed";
  }
  return denied <= confirmed ? "denied" : "confirmed";
}

/** The first line that carries a signal. Used live and again by record verification. */
export function signalFromLines(lines: string[]): ContactSignal {
  for (const line of lines) {
    const signal = signalFromLine(line);
    if (signal !== "unclear") {
      return signal;
    }
  }
  return "unclear";
}

export function looksLikeMachine(turns: TranscriptTurn[]): boolean {
  return turns.some(
    (turn) => turn.speaker === "user" && MACHINE_PATTERNS.some((pattern) => pattern.test(turn.text)),
  );
}

/** Words that carry no meaning of their own, so sharing them shares nothing. */
const STOPWORDS = new Set([
  "a", "about", "an", "and", "any", "anyone", "anybody", "are", "as", "at", "be", "been", "but", "by", "can",
  "did", "do", "does", "for", "from", "had", "has", "have", "her", "here", "him", "his", "how", "i", "if",
  "in", "is", "it", "its", "last", "let", "like", "me", "my", "no", "not", "of", "on", "or", "our", "please",
  "she", "so", "sure", "that", "the", "their", "them", "then", "there", "they", "this", "to", "up", "us",
  "was", "we", "well", "what", "when", "which", "who", "will", "with", "would", "yes", "you", "your",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 0 && !STOPWORDS.has(token));
}

/** How much of the question a turn actually contains, from 0 to 1. */
function support(wanted: string[], text: string): number {
  if (wanted.length === 0) {
    return 0;
  }
  const words = new Set(tokens(text));
  return wanted.filter((token) => words.has(token)).length / wanted.length;
}

/**
 * How much of the question a caller turn has to carry to count as asking it.
 *
 * A paraphrase the reader cannot recognise comes back as never asked, which leaves
 * the outcome at `unreachable` with `ended_before_question`. That is the direction
 * to be wrong in: it says less than the call did rather than more.
 */
export const QUESTION_SUPPORT = 0.7;

/** How many callee turns after the question can still be the answer to it. */
export const ANSWER_WINDOW = 3;

/** The last caller turn that asked the question. -1 when it never did. */
export function askedAt(question: string, turns: TranscriptTurn[]): number {
  const wanted = tokens(question);
  let found = -1;
  for (const [index, turn] of turns.entries()) {
    if (turn.speaker === "bot" && support(wanted, turn.text) >= QUESTION_SUPPORT) {
      found = index;
    }
  }
  return found;
}

export function readTranscript(turns: TranscriptTurn[], question: string): TranscriptReading {
  const calleeTurns = turns.filter((turn) => turn.speaker === "user");
  const anchor = askedAt(question, turns);
  const excerpt =
    anchor === -1
      ? []
      : turns
          .filter((turn, index) => turn.speaker === "user" && index > anchor)
          .slice(0, ANSWER_WINDOW)
          .map((turn) => turn.text);
  let signal: ContactSignal = "unclear";
  let supportingTurn = "";
  for (const line of excerpt) {
    const found = signalFromLine(line);
    if (found !== "unclear") {
      signal = found;
      supportingTurn = line;
      break;
    }
  }
  return {
    calleeTurnCount: calleeTurns.length,
    // A person who mentions a menu option is still a person, so a machine is only
    // a machine when nothing in the call answered the question either.
    machineAnswered: looksLikeMachine(turns) && signal === "unclear",
    questionAsked: anchor !== -1,
    signal,
    supportingTurn,
    excerpt,
  };
}
