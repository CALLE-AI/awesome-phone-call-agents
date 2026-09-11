/**
 * Local reading of the transcript.
 *
 * The structured result carries the answers, because that is what an extraction
 * contract is for. This module reads the things a structured result must never be
 * the only source of: whether a person was actually there, whether that person
 * told the caller to go away, whether anything the callee said supports a claimed
 * answer and whether anybody agreed to or refused the arrangement.
 *
 * Every one of those is anchored to what the caller had just put to the callee. A
 * sentence is evidence for the thing it was answering and for nothing else, which is
 * what stops a yes to one question standing in for an agreement and a no to another
 * standing in for a refusal of the errand. What the caller put to them is read clause
 * by clause, because a question mark at the end of a turn belongs to the thing it was
 * asked about and not to everything else in that turn.
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
 *
 * Matching one of these is not enough on its own. The same words refuse a question
 * ("we do not take that plan") as easily as they refuse the arrangement, so
 * `refusalEvidence` decides what a matching turn was actually answering.
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
  return {
    userTurnCount: userTurns.length,
    machineAnswered,
    declinedAutomated: declineTurn !== undefined,
    reachedPerson: userTurns.length > 0 && !machineAnswered,
    botText,
    declineQuote: declineTurn?.text ?? "",
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

/** How much of a question a caller turn has to carry before it counts as asked. */
const QUESTION_ASKED = 0.7;

/** The last turn where the caller asked this question. -1 when it never did. */
function askedAt(question: string, turns: TranscriptTurn[]): number {
  const wanted = tokens(question);
  let found = -1;
  for (const [index, turn] of turns.entries()) {
    if (turn.speaker === "bot" && support(wanted, turn.text) >= QUESTION_ASKED) {
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
 * has to come after the caller raised the arrangement. When the extraction claims a
 * datetime that datetime has to have been named by the time the callee spoke: in
 * their own turn or in the caller's proposal before it. An unrelated yes plus a
 * plausible time is not a booking. A time the caller only put to them afterwards
 * is a proposal they have not answered.
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
    if (offered.length > 0 && !namedBefore(turns, index, offered)) {
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

/**
 * Caller clauses that put a question or a request to the callee, rather than tell them
 * something. The question mark is not required on its own, because a transcript of
 * speech does not always carry one and an asked question is still an asked question
 * without it, so the modal, auxiliary and request shapes a call script uses count too.
 *
 * These are interrogative and request forms only. A first-person purpose statement
 * ("I am calling to book an appointment", "I would like to book an appointment") is
 * not one of them: it tells the callee why the caller rang and asks them nothing, so
 * it is not the caller putting the arrangement to them. A statement like that raises
 * the arrangement only when it also names the offered time, which is the proposal arm
 * in `clauseRaises`, not an ask.
 *
 * They are matched against one clause rather than a whole turn, because a question
 * mark at the end of a turn belongs to the thing it was asked about and to nothing
 * else in that turn.
 */
const ASK_FORMS: RegExp[] = [
  /\?/,
  /\b(?:can|could|would|will|shall|may)\s+(?:you|we|i|she|he|they)\b/i,
  /\b(?:do|does|is|are|have|has)\s+(?:you|she|he|they|there)\b/i,
  /\b(?:please|any chance)\b/i,
];

/**
 * The clauses of a caller turn, in the order they were said.
 *
 * A turn is not one thing put to the callee. "I am calling to book an appointment. Do
 * you accept Aetna?" says why the caller rang and then asks about insurance. The
 * question mark belongs to the insurance question alone. Classifying a turn whole let a
 * request form anywhere in it license booking words anywhere else, so a no to the
 * insurance question came back as a refused appointment in a call where no slot had
 * been put to anybody.
 *
 * The split is where one thing said ends and the next begins: a sentence end, a
 * semicolon, a colon, a comma, a dash or a line break. A comma is in there because a
 * transcript of speech splices two utterances with one as often as it writes a full
 * stop. The half carrying the question mark is then the whole turn's only ask. A
 * coordinator counts as a break when a fresh question opens right after it, as in "do
 * you accept Aetna and can we book Thursday?", because that is a second thing put to
 * them inside one sentence.
 *
 * The cost is a request whose booking word sits on the far side of a comma from its
 * question form. "About the appointment, could you do Thursday?" is two clauses and
 * neither is both halves, so it anchors nothing and the commitment reads
 * `unconfirmed`. That is the direction to be wrong in. A turn that names the time the
 * extraction reported still anchors on the proposal arm whatever its punctuation.
 */
const CLAUSE_BREAK =
  /(?<=[.!?])\s+|[;:,\r\n]+|\s+[-\u2013\u2014]{1,2}\s+|\s+(?:and|or|but|so|then)\s+(?=(?:can|could|would|will|shall|may|do|does|did|is|are|was|were|have|has|had)\s+(?:you|we|i|she|he|they|there)\b)/i;

function clausesOf(text: string): string[] {
  return text
    .split(CLAUSE_BREAK)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

/**
 * Whether one clause puts the arrangement to the callee.
 *
 * Two halves and both of them inside this clause, which is what binds the request form
 * to the booking words rather than to whatever else the turn happened to say. The
 * clause has to be about the arrangement, which is booking language or the time the
 * extraction reported. It also has to put that to them, which is one of two things and
 * not a third:
 *
 * - a genuine request: booking language in a question or request form, "could you hold
 *   Thursday at nine forty?"
 * - a concrete proposal: a clause that names the offered time itself, "Thursday the
 *   thirteenth at nine forty would suit her", which is a time they can say yes to
 *   whether or not it is phrased as a question.
 *
 * A declarative that only carries a booking word is neither, even when it also names
 * some unrelated day. "Our appointment desk is open Monday", told between a question
 * and its answer, asks nothing and offers no slot, so it must not make that answer a
 * reply to the arrangement. That is why the proposal half is the offered time rather
 * than any weekday: a bare weekday in a statement proposes nothing to answer.
 *
 * The proposal arm asks the whole turn as well as the clause, so the day check inside
 * `mentionsDatetime` still sees every day the turn named. Reading a clause alone would
 * take "Wednesday, at nine forty" for Thursday at nine forty, because the half holding
 * the clock names no day at all.
 */
function clauseRaises(clause: string, text: string, offered: string): boolean {
  if (mentionsDatetime(clause, offered) && mentionsDatetime(text, offered)) {
    return true;
  }
  return COMMITMENT_PROMPT.test(clause) && ASK_FORMS.some((form) => form.test(clause));
}

/**
 * Which clause of a caller turn last put the arrangement to the callee. -1 when none
 * of them did.
 *
 * Where it happened matters as much as whether it did, because a turn can raise the
 * arrangement and then ask something else. What a callee answers is the last thing said
 * to them.
 */
function arrangementAt(text: string, offered: string): number {
  const clauses = clausesOf(text);
  for (let at = clauses.length - 1; at >= 0; at -= 1) {
    if (clauseRaises(clauses[at]!, text, offered)) {
      return at;
    }
  }
  return -1;
}

/**
 * Which clause of a caller turn last asked one of the errand's questions. -1 when none
 * of them did.
 *
 * A question whose words run across a clause break is still asked and it ends where
 * the turn ends, so it counts as the last thing said. Without that, a question the
 * split happens to cut in half would go missing and hand the turn back to the
 * arrangement, which is the reading this whole rule exists to stop.
 */
function questionAt(text: string, questions: ErrandQuestion[]): number {
  const asked = (part: string): boolean =>
    questions.some((question) => support(tokens(question.text), part) >= QUESTION_ASKED);
  const clauses = clausesOf(text);
  for (let at = clauses.length - 1; at >= 0; at -= 1) {
    if (asked(clauses[at]!)) {
      return at;
    }
  }
  return asked(text) ? clauses.length - 1 : -1;
}

/**
 * Whether a caller turn puts the arrangement to the callee anywhere in it.
 *
 * All three bindings run through here, the agreement, the refusal and the
 * confirmation code that belongs to the agreement, so the rule cannot hold on one
 * side and not another.
 *
 * It is deliberately lexical and it fails closed. A real ask this misses leaves the
 * evidence unbound, so the commitment reads unconfirmed and the report says less
 * than the extraction claimed.
 */
function raisesArrangement(text: string, offered: string): boolean {
  return arrangementAt(text, offered) >= 0;
}

/** Where the caller raised the arrangement. -1 when it never did. */
function commitmentPromptAt(turns: TranscriptTurn[], offered: string): number {
  for (const [index, turn] of turns.entries()) {
    if (turn.speaker === "bot" && raisesArrangement(turn.text, offered)) {
      return index;
    }
  }
  return -1;
}

/** What the caller last put to the callee, which is what their next turn answers. */
type LastAsk = "commitment" | "question" | null;

/**
 * What the caller had last put to the callee before this turn.
 *
 * A turn answers the most recent thing asked of it, so this is what decides which
 * claim a callee turn is evidence for. Statements are skipped: the caller reading
 * out a date of birth does not change the subject, so a callee who refuses after
 * that is still refusing whatever was last asked. A statement that names the
 * arrangement is skipped for the same reason, because mentioning an appointment is
 * not asking for one and the last real ask still stands.
 *
 * Inside a turn it is the last clause that counts, for the same reason it is the last
 * turn. "Could you hold Thursday at nine forty? Do you accept Aetna?" raises the
 * arrangement and then asks something else, so the no that follows is a no to the
 * insurance question and the report must not read it as a refused booking.
 *
 * A clause that is both counts as the arrangement, which is the usual case: "what is
 * the earliest appointment you have" is a question on the errand's list and the
 * arrangement being put to them at the same time.
 */
function lastAskBefore(
  turns: TranscriptTurn[],
  index: number,
  offered: string,
  questions: ErrandQuestion[],
): LastAsk {
  for (let at = index - 1; at >= 0; at -= 1) {
    const turn = turns[at]!;
    if (turn.speaker !== "bot") {
      continue;
    }
    const arrangement = arrangementAt(turn.text, offered);
    const question = questionAt(turn.text, questions);
    if (question > arrangement) {
      return "question";
    }
    if (arrangement >= 0) {
      return "commitment";
    }
  }
  return null;
}

export interface RefusalEvidence {
  /** The callee turn that refuses the arrangement. Empty when no turn does. */
  quote: string;
  index: number;
  /**
   * A refusal the callee voiced about something else, most often an answer to one of
   * the questions or a no to another time. It is not evidence about the arrangement
   * the extraction reported and it goes in the report so a person is not told nothing
   * was said when something was.
   */
  otherQuote: string;
}

/**
 * What the transcript shows about a refusal of the arrangement. An extraction saying
 * `declined_by_callee` is not a refusal on its own.
 *
 * Two bindings, the same two an agreement is held to, because it is the same size of
 * claim about the errand. Refusal words prove nothing by themselves: "no, we do not
 * take that plan" is a refusal of a question and it says nothing about the booking,
 * which may have been accepted in the same call. So the turn has to be answering the
 * arrangement rather than a question. The caller also has to have raised an
 * arrangement at all. Then, when the extraction reports a datetime, that datetime has
 * to have been named by the time the callee spoke: in their own turn or in the
 * caller's proposal before it. Two times proposed on one call is otherwise a way for a
 * no to one of them to be reported as a no to the other, in either order.
 *
 * With no datetime reported there is nothing to bind to, so the prompt anchor stands
 * alone. That is the same asymmetry the agreement side has.
 *
 * A refusal aimed at something else, another time included, still comes back as
 * `otherQuote`, so the report can quote what was actually turned down. A refused
 * arrangement that cannot be matched to the reported one fails closed: no evidence,
 * so the commitment reads `unconfirmed` rather than turned down.
 */
export function refusalEvidence(
  turns: TranscriptTurn[],
  offered = "",
  questions: ErrandQuestion[] = [],
): RefusalEvidence {
  let otherQuote = "";
  if (commitmentPromptAt(turns, offered) === -1) {
    // The caller never raised an arrangement, so nothing here can be a refusal of one.
    const loose = turns.find(
      (turn) => turn.speaker === "user" && REFUSAL_PATTERNS.some((pattern) => pattern.test(turn.text)),
    );
    return { quote: "", index: -1, otherQuote: loose?.text ?? "" };
  }
  for (const [index, turn] of turns.entries()) {
    if (turn.speaker !== "user" || !REFUSAL_PATTERNS.some((pattern) => pattern.test(turn.text))) {
      continue;
    }
    if (lastAskBefore(turns, index, offered, questions) !== "commitment") {
      if (otherQuote.length === 0) {
        otherQuote = turn.text;
      }
      continue;
    }
    if (offered.length > 0 && !namedBefore(turns, index, offered)) {
      // A no to another time is not a no to this one. A no given before the caller
      // had put this time to them is not about it either. The same binding the
      // agreement side uses, so a call where two slots were discussed cannot report
      // the refusal of one as the refusal of the other in either order.
      if (otherQuote.length === 0) {
        otherQuote = turn.text;
      }
      continue;
    }
    return { quote: turn.text, index, otherQuote: "" };
  }
  return { quote: "", index: -1, otherQuote };
}

/** How far back from a turn the caller's proposal may be. */
const PRECEDING_TURNS = 1;

/**
 * The turn itself and the caller's turn before it.
 *
 * Those are the only two places the thing a turn was answering can have been said,
 * which is the rule the rest of this module already runs on. Nothing after the turn
 * is in here: a turn cannot be an answer to something nobody had said yet.
 *
 * This used to reach one turn forward as well, on the grounds that the caller reads
 * the time back once it is settled and that read back is sometimes the first precise
 * form of it in the call. A read back and a fresh proposal are the same shape from one
 * turn away, so that reach let a later turn decide what an earlier one had meant. The
 * caller offers Wednesday, the callee refuses, the caller then offers Thursday. The
 * refusal of Wednesday passed as evidence about Thursday, which the callee had not
 * answered yet. Two arrangements in one call did the same thing to a reference number.
 *
 * The cost is a call where the only precise form of the time is in the caller's read
 * back. That now reads as not named, so the commitment comes back unconfirmed and the
 * report says less than the extraction claimed, which is the direction to be wrong in.
 */
function upTo(turns: TranscriptTurn[], index: number): TranscriptTurn[] {
  return turns.slice(Math.max(index - PRECEDING_TURNS, 0), index + 1);
}

function namedBefore(turns: TranscriptTurn[], index: number, offered: string): boolean {
  return upTo(turns, index).some((turn) => mentionsDatetime(turn.text, offered));
}

/**
 * Whether the confirmation code was said at the agreement or in the turn it answered.
 *
 * A reference number is part of the same claim as the booking, so it is held to the
 * same standard and bound the same way. Two bookings in one call is otherwise a way
 * for the second reference to be printed against the first appointment. A code the
 * callee only reads out in a later turn is dropped, so the report gives no number
 * rather than the wrong one.
 */
export function codeNamedBefore(turns: TranscriptTurn[], index: number, code: string): boolean {
  if (index < 0 || code.trim().length === 0) {
    return false;
  }
  return upTo(turns, index).some((turn) => mentionsCode(turn.text, code));
}
