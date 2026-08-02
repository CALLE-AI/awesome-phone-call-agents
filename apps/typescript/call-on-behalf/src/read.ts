/**
 * Local reading of the transcript.
 *
 * The structured result carries the answers, because that is what an extraction
 * contract is for. This module reads the things a structured result must never be
 * the only source of: whether a person was actually there, whether that person
 * told the caller to go away, whether anything the callee said supports a claimed
 * answer and whether anybody agreed to anything.
 *
 * A business declining to deal with an automated caller is a legitimate answer,
 * not an error to retry around. It is detected, reported and obeyed.
 *
 * The support checks are lexical. They compare the words in the extraction with
 * the words the callee used, so a paraphrase they cannot see comes back
 * unsupported and the report says the question was not answered. That is the
 * direction to be wrong in. The report should say less than the extraction
 * claimed, never more.
 */

import type { CommitmentMode, ErrandQuestion, TranscriptTurn } from "./types.js";

const MACHINE_PATTERNS: RegExp[] = [
  /\bleave a (?:message|voicemail)\b/i,
  /\bat the tone\b/i,
  /\bis not available\b/i,
  /\bpress \d\b/i,
  /\bmailbox\b/i,
  /\bour (?:office|clinic) is closed\b/i,
];

const DECLINE_AUTOMATED_PATTERNS: RegExp[] = [
  /\b(?:do not|don'?t|cannot|can'?t|won'?t)\s+(?:take|accept|deal with|talk to|speak (?:to|with))\s+(?:\w+\s+){0,3}(?:automated|robot|robots|recordings?|machines?|bots?|ai)\b/i,
  /\bno (?:robots|bots|automated callers?)\b/i,
  /\bhas? to (?:call|speak to us) (?:herself|himself|themselves|directly)\b/i,
  /\bneed to (?:speak|talk) (?:to|with) (?:the )?(?:patient|customer|client|person|her|him|them) (?:directly|in person|themselves)\b/i,
  /\bhave (?:her|him|them) call (?:us|me) (?:back )?(?:directly|themselves)\b/i,
  /\bwe only (?:speak|deal) with the (?:patient|customer|account holder)\b/i,
];

/**
 * A refusal of the errand itself, as opposed to a refusal to deal with a robot.
 * Deliberately narrow: the point is to find a turn that plainly will not do the
 * thing, so an extraction that reports a refusal nobody voiced comes back
 * unsupported. Missing a real refusal costs a softer report, inventing one costs
 * the person a fact about their own errand.
 */
const REFUSAL_PATTERNS: RegExp[] = [
  /\b(?:we|i)\s*(?:'?re| are| am)?\s*(?:not able|unable)\s+to\b/i,
  /\b(?:we|i)\s*(?:can'?t|cannot|won'?t)\s+(?:do|book|make|arrange|schedule|take|fit|offer|help with|accommodate)\b/i,
  /\b(?:we|i)\s+(?:do not|don'?t)\s+(?:do|book|offer|handle|arrange|take)\b/i,
  /\bthat(?:'?s| is) not something we\b/i,
  /\b(?:nothing|no (?:slots?|appointments?|openings?|availability|times?))\s+(?:is |are )?available\b/i,
  /\bwe(?:'?re| are)\s+(?:fully )?booked\b/i,
  /\bwe have (?:nothing|no availability)\b/i,
  /\byou(?:'?ll| will) (?:have to|need to) (?:go|call|try) (?:somewhere else|elsewhere|another)\b/i,
];

export interface TranscriptReading {
  userTurnCount: number;
  machineAnswered: boolean;
  declinedAutomated: boolean;
  reachedPerson: boolean;
  /** Everything the caller said, for the disclosure check. */
  botText: string;
  /** The turn where the callee declined, for the report. */
  declineQuote: string;
  /**
   * The turn where the callee refused the errand itself, empty when no turn
   * says so. A claimed refusal with nothing here is the extraction's alone.
   */
  refusalQuote: string;
}

export function readTranscript(turns: TranscriptTurn[]): TranscriptReading {
  const userTurns = turns.filter((turn) => turn.speaker === "user");
  const botText = turns
    .filter((turn) => turn.speaker === "bot")
    .map((turn) => turn.text)
    .join("\n");
  const machineAnswered = userTurns.some((turn) =>
    MACHINE_PATTERNS.some((pattern) => pattern.test(turn.text)),
  );
  const declineTurn = userTurns.find((turn) =>
    DECLINE_AUTOMATED_PATTERNS.some((pattern) => pattern.test(turn.text)),
  );
  const refusalTurn = userTurns.find((turn) =>
    REFUSAL_PATTERNS.some((pattern) => pattern.test(turn.text)),
  );
  return {
    userTurnCount: userTurns.length,
    machineAnswered,
    declinedAutomated: declineTurn !== undefined,
    reachedPerson: userTurns.length > 0 && !machineAnswered,
    botText,
    declineQuote: declineTurn?.text ?? "",
    refusalQuote: refusalTurn?.text ?? "",
  };
}

/** A yes or a no as the callee said it, in the order they said it. */
const AFFIRM =
  /\b(?:yes|yeah|yep|yup|certainly|absolutely|of course|correct|we do|we can|we accept|that is right|that's right)\b/i;
const DENY =
  /\b(?:no|nope|we do not|we don't|not at the moment|afraid not|unfortunately not|we cannot|we can't|we do not take|we don't take)\b/i;

/**
 * Words that carry no meaning of their own, so a claimed answer that only shares
 * these with a turn shares nothing.
 */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does", "for", "from", "had", "has",
  "have", "her", "here", "him", "his", "how", "i", "if", "in", "is", "it", "its", "me", "my", "no", "not", "of",
  "on", "or", "our", "she", "so", "that", "the", "their", "them", "then", "there", "they", "this", "to", "up",
  "us", "was", "we", "what", "when", "which", "who", "will", "with", "would", "yes", "you", "your", "ok", "okay",
  "just", "let", "like", "please", "sure", "take", "thanks", "thank", "well", "yeah",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 0 && !STOPWORDS.has(token));
}

/** How much of a claim a turn actually contains, from 0 to 1. */
function support(claim: string[], text: string): number {
  if (claim.length === 0) {
    return 0;
  }
  const words = new Set(tokens(text));
  return claim.filter((token) => words.has(token)).length / claim.length;
}

/** Which way the callee answered, reading the first marker they used. */
function polarity(text: string): "yes" | "no" | null {
  const yesAt = text.search(AFFIRM);
  const noAt = text.search(DENY);
  if (yesAt === -1 && noAt === -1) {
    return null;
  }
  if (noAt === -1) {
    return "yes";
  }
  if (yesAt === -1) {
    return "no";
  }
  return yesAt < noAt ? "yes" : "no";
}

/** The last turn where the caller asked this question. -1 when it never did. */
function askedAt(question: string, turns: TranscriptTurn[]): number {
  const wanted = tokens(question);
  let found = -1;
  for (const [index, turn] of turns.entries()) {
    if (turn.speaker === "bot" && support(wanted, turn.text) >= 0.7) {
      found = index;
    }
  }
  return found;
}

/** How many callee turns after a question can still be the answer to it. */
const ANSWER_WINDOW = 2;

/**
 * The callee turn that supports a claimed answer. Empty when the transcript does
 * not support it.
 *
 * Every answer is anchored to its question. The caller must have asked it. The
 * evidence must come from the callee turns right after it, because a sentence
 * somewhere else in the call is evidence for whatever was being discussed there. A
 * yes or a no needs the same anchor and reads the polarity the callee used.
 * Everything else needs its own words in one of those turns.
 */
export function supportingTurn(question: ErrandQuestion, claimed: string, turns: TranscriptTurn[]): string {
  const answer = claimed.trim();
  if (answer.length === 0) {
    return "";
  }
  const anchor = askedAt(question.text, turns);
  if (anchor === -1) {
    return "";
  }
  const after = turns
    .filter((turn, index) => turn.speaker === "user" && index > anchor)
    .slice(0, ANSWER_WINDOW);

  if (question.answer === "yes_no") {
    const wanted = /^y/i.test(answer) ? "yes" : /^n/i.test(answer) ? "no" : null;
    if (wanted === null) {
      return "";
    }
    const reply = after.find((turn) => polarity(turn.text) === wanted);
    return reply?.text ?? "";
  }

  const claim = tokens(answer);
  return after.find((turn) => support(claim, turn.text) >= 0.6)?.text ?? "";
}

/** Booking language. Somebody holding a slot says so. */
const ACCEPTED_PATTERNS: RegExp[] = [
  /\b(?:i|we)(?:'ll|'ve| will| can| could| have)?\s+(?:hold|held|book|booked|schedule|scheduled|reserve|reserved|pencil(?:l?ed)?|put)\b/i,
  /\b(?:that is|that's|it is|it's|you are|you're|she is|she's|he is|he's|they are|they're)\s+(?:booked|confirmed|reserved|scheduled|set|done|all set)\b/i,
  /\b(?:booked|confirmed|reserved|scheduled)\s+(?:her|him|them|you|it|that)\b/i,
  /\b(?:reference|confirmation)(?: number| code)?\s+(?:is\s+)?\S+/i,
  /\bwe(?:'ll| will) see (?:her|him|them|you)\b/i,
  /\bsee (?:her|him|them|you) (?:then|on|at)\b/i,
];

/** Confirming what already exists is agreement to nothing new, so it reads different. */
const CONFIRMED_PATTERNS: RegExp[] = [
  /\bstill (?:on|booked|scheduled|confirmed|there)\b/i,
  /\b(?:that is|that's|it is|it's) (?:right|correct)\b/i,
  /\byes,? (?:she|he|they|you) (?:are|is) (?:booked|down|scheduled|confirmed)\b/i,
];

const HOUR_WORDS = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];
const ONE_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEEN_WORDS = [
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TEN_WORDS = ["", "", "twenty", "thirty", "forty", "fifty"];

/** How a transcript says the minutes past an hour. */
function minuteWords(minute: number): string[] {
  if (minute < 10) {
    return [`oh ${ONE_WORDS[minute]}`, `zero ${ONE_WORDS[minute]}`];
  }
  if (minute < 20) {
    return [TEEN_WORDS[minute - 10]!];
  }
  const tens = TEN_WORDS[Math.floor(minute / 10)]!;
  const ones = minute % 10;
  return ones === 0 ? [tens] : [`${tens} ${ONE_WORDS[ones]}`];
}

/** A spoken phrase as a pattern, allowing for punctuation between its words. */
function phrase(words: string, tail = ""): RegExp {
  return new RegExp(`\\b${words.split(" ").join("[^a-z0-9]{1,3}")}\\b${tail}`, "i");
}

/** So "nine forty" does not match somebody saying nine forty five. */
const NOT_ANOTHER_NUMBER = `(?![^a-z0-9]{1,3}(?:${ONE_WORDS.slice(1).join("|")}))`;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december";
const ORDINAL_ONES = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"];
const ORDINAL_TEENS = [
  "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth",
  "nineteenth",
];
const ORDINAL_TENS: Record<number, string> = { 10: "tenth", 20: "twentieth", 30: "thirtieth" };

/** How a transcript says a day of the month, as a word. */
function dayWord(day: number): string {
  if (day < 10) {
    return ORDINAL_ONES[day]!;
  }
  if (day < 20) {
    return ORDINAL_TEENS[day - 10]!;
  }
  if (day % 10 === 0) {
    return ORDINAL_TENS[day] ?? "";
  }
  return `${TEN_WORDS[Math.floor(day / 10)]!} ${ORDINAL_ONES[day % 10]!}`;
}

/**
 * Which days of the month the text names, if any.
 *
 * A bare number is not a day: "nine forty" written as `9:40` is a time. So a digit
 * counts only where the sentence marks it as a date, which is an ordinal suffix, the
 * word "the" in front of it or a month name beside it. Ordinal words are a date on
 * their own.
 */
function daysNamed(text: string): Set<number> {
  const days = new Set<number>();
  const dated = new RegExp(`\\b(?:(\\d{1,2})(?:st|nd|rd|th)|the (\\d{1,2})\\b|(?:${MONTHS})\\s+(\\d{1,2})\\b)`, "gi");
  for (const match of text.matchAll(dated)) {
    const found = Number(match[1] ?? match[2] ?? match[3]);
    if (found >= 1 && found <= 31) {
      days.add(found);
    }
  }
  for (let day = 1; day <= 31; day += 1) {
    const word = dayWord(day);
    if (word.length > 0 && phrase(word).test(text)) {
      days.add(day);
    }
  }
  return days;
}

/** Which weekdays the text names, if any. */
function weekdaysNamed(text: string): Set<string> {
  return new Set(WEEKDAYS.filter((weekday) => new RegExp(`\\b${weekday}\\b`, "i").test(text)));
}

/**
 * Whether a turn names this datetime.
 *
 * The extraction hands back ISO 8601 when it could work the time out, so that is
 * compared as the wall clock it was written with, in the forms a transcript actually
 * carries: `9:40`, "nine forty", "half past nine", "ten o'clock".
 *
 * The day is not required, because a callee who has already said "Thursday" says the
 * time alone after that. It is checked when the turn names one: a turn that names a
 * different day or a different weekday from the claimed date is not naming this
 * datetime, whatever the clock says. Two authorized days at the same time of day is
 * otherwise a way to report the wrong one.
 *
 * A form this does not know reads as not named, so the report says `unconfirmed`.
 * That is the direction to be wrong in.
 */
export function mentionsDatetime(text: string, datetime: string): boolean {
  const value = datetime.trim();
  if (value.length === 0) {
    return false;
  }
  const clock = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (clock === null) {
    // Free text from the extraction, so it is compared by its own words.
    return support(tokens(value), text) >= 0.6;
  }
  const date = clock[1]!;
  const hour = Number(clock[2]);
  const minute = Number(clock[3]);
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const word = HOUR_WORDS[hour % 12]!;
  const padded = String(minute).padStart(2, "0");
  const patterns: RegExp[] = [new RegExp(`\\b0?${hour12}[:.]${padded}\\b`), new RegExp(`\\b${hour}[:.]${padded}\\b`)];
  if (minute === 0) {
    for (const spoken of [word, String(hour12)]) {
      patterns.push(phrase(`${spoken} o clock`), phrase(`at ${spoken}`), phrase(`${spoken} am`), phrase(`${spoken} pm`));
    }
  } else {
    for (const spoken of [word, String(hour12)]) {
      for (const minuteWord of minuteWords(minute)) {
        patterns.push(phrase(`${spoken} ${minuteWord}`, NOT_ANOTHER_NUMBER));
      }
      if (minute === 15) {
        patterns.push(phrase(`quarter past ${spoken}`));
      }
      if (minute === 30) {
        patterns.push(phrase(`half past ${spoken}`));
      }
    }
    if (minute === 45) {
      patterns.push(phrase(`quarter to ${HOUR_WORDS[(hour + 1) % 12]}`), phrase(`quarter to ${(hour12 % 12) + 1}`));
    }
  }
  if (!patterns.some((pattern) => pattern.test(text))) {
    return false;
  }
  const days = daysNamed(text);
  if (days.size > 0 && !days.has(Number(date.slice(8, 10)))) {
    return false;
  }
  const weekdays = weekdaysNamed(text);
  // Midday on the written date, so the weekday is the one the file wrote and not
  // whatever an offset would shift it to.
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
  return weekdays.size === 0 || weekdays.has(weekday);
}

/**
 * Whether a turn names this confirmation code.
 *
 * A reference number is read out digit by digit, so "four four seven one" is how
 * `4471` arrives. The literal form counts too, with or without separators. Anything
 * else reads as not named, so the report drops the code rather than printing one
 * nobody said.
 */
export function mentionsCode(text: string, code: string): boolean {
  const wanted = code.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (wanted.length < 2) {
    return false;
  }
  if (text.toLowerCase().replace(/[^a-z0-9]/g, "").includes(wanted)) {
    return true;
  }
  if (!/^\d+$/.test(wanted)) {
    return false;
  }
  const digits = wanted.split("").map((digit) => ONE_WORDS[Number(digit)]!);
  return (
    phrase(digits.join(" ")).test(text) ||
    phrase(digits.map((digit) => (digit === "zero" ? "oh" : digit)).join(" ")).test(text)
  );
}

export interface AgreementEvidence {
  /** The callee turn that agrees to what the extraction claims. Empty when none does. */
  quote: string;
  /** Where that turn is, so anything else claimed about the agreement can be checked there. */
  index: number;
  /**
   * Booking language in the call that is not evidence for the claim, either because
   * the caller never raised an arrangement or because it is about another time. It
   * goes in the report so a person is not told nothing happened when something did.
   */
  otherQuote: string;
}

/**
 * What the transcript shows about an agreement. An extraction saying `accepted` is
 * not an agreement on its own.
 *
 * Two bindings, because booking language on its own proves nothing. The agreement
 * has to come after the caller raised the arrangement. When the extraction
 * claims a datetime that datetime has to be named around the agreement itself: in
 * the turn, in the caller's proposal before it or in the read back after it. An
 * unrelated yes plus a plausible time is not a booking.
 *
 * Booking language that fails either binding is still worth saying out loud, so it
 * comes back as `otherQuote` and the report quotes it as what was said instead.
 */
export function agreementEvidence(
  turns: TranscriptTurn[],
  commitment: CommitmentMode,
  offered = "",
): AgreementEvidence {
  const patterns =
    commitment === "confirm_existing" ? [...ACCEPTED_PATTERNS, ...CONFIRMED_PATTERNS] : ACCEPTED_PATTERNS;
  const booking = turns.filter(
    (turn) => turn.speaker === "user" && patterns.some((pattern) => pattern.test(turn.text)),
  );
  const prompt = commitmentPromptAt(turns, offered);
  if (prompt === -1) {
    return { quote: "", index: -1, otherQuote: booking[0]?.text ?? "" };
  }
  let otherQuote = booking[0]?.text ?? "";
  for (const [index, turn] of turns.entries()) {
    if (index <= prompt || turn.speaker !== "user") {
      continue;
    }
    if (!patterns.some((pattern) => pattern.test(turn.text))) {
      continue;
    }
    if (offered.length > 0 && !namedAround(turns, index, offered)) {
      otherQuote = turn.text;
      continue;
    }
    return { quote: turn.text, index, otherQuote: "" };
  }
  return { quote: "", index: -1, otherQuote };
}

/** Caller language that raises an arrangement, which is what an agreement answers. */
const COMMITMENT_PROMPT =
  /\b(?:book|books|booked|booking|hold|holding|reserve|reserving|reserved|schedule|scheduled|scheduling|reschedule|pencil|slot|slots|appointment|appointments|availability|confirm|confirming)\b/i;

/** Where the caller raised the arrangement. -1 when it never did. */
function commitmentPromptAt(turns: TranscriptTurn[], offered: string): number {
  for (const [index, turn] of turns.entries()) {
    if (turn.speaker !== "bot") {
      continue;
    }
    // Proposing the time is raising the arrangement as much as the word book is.
    if (COMMITMENT_PROMPT.test(turn.text) || mentionsDatetime(turn.text, offered)) {
      return index;
    }
  }
  return -1;
}

/** How far either side of the agreement the time may have been said. */
const NEIGHBOURING_TURNS = 1;

function nearby(turns: TranscriptTurn[], index: number): TranscriptTurn[] {
  return turns.slice(Math.max(index - NEIGHBOURING_TURNS, 0), index + NEIGHBOURING_TURNS + 1);
}

function namedAround(turns: TranscriptTurn[], index: number, offered: string): boolean {
  return nearby(turns, index).some((turn) => mentionsDatetime(turn.text, offered));
}

/**
 * Whether the confirmation code was said around the agreement.
 *
 * A reference number is part of the same claim as the booking, so it is held to the
 * same standard. A code the extraction produced and nobody read out is dropped.
 */
export function codeNamedAround(turns: TranscriptTurn[], index: number, code: string): boolean {
  if (index < 0 || code.trim().length === 0) {
    return false;
  }
  return nearby(turns, index).some((turn) => mentionsCode(turn.text, code));
}
