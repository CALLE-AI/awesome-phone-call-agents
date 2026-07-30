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

/**
 * The callee turn that supports a claimed answer. Empty when the transcript does
 * not support it.
 *
 * A yes or a no is only evidence when the caller asked that question and the
 * callee answered it, so those are bound to the two turns after the question.
 * Everything else is bound by its own words.
 */
export function supportingTurn(question: ErrandQuestion, claimed: string, turns: TranscriptTurn[]): string {
  const answer = claimed.trim();
  if (answer.length === 0) {
    return "";
  }
  const anchor = askedAt(question.text, turns);
  const after = turns.filter((turn, index) => turn.speaker === "user" && index > anchor);

  if (question.answer === "yes_no") {
    if (anchor === -1) {
      return "";
    }
    const wanted = /^y/i.test(answer) ? "yes" : /^n/i.test(answer) ? "no" : null;
    if (wanted === null) {
      return "";
    }
    const reply = after.slice(0, 2).find((turn) => polarity(turn.text) === wanted);
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

/**
 * The callee turn that shows something was agreed. Empty when the transcript does
 * not show it. An extraction saying `accepted` is not an agreement on its own.
 */
export function agreementTurn(turns: TranscriptTurn[], commitment: CommitmentMode): string {
  const patterns =
    commitment === "confirm_existing" ? [...ACCEPTED_PATTERNS, ...CONFIRMED_PATTERNS] : ACCEPTED_PATTERNS;
  const turn = turns.find(
    (candidate) => candidate.speaker === "user" && patterns.some((pattern) => pattern.test(candidate.text)),
  );
  return turn?.text ?? "";
}
