/**
 * Local reading of what people actually said.
 *
 * Availability comes back as a list, which an extraction model handles well, so
 * the structured result leads and this reader cross-checks it. A commitment is a
 * yes or a no, which is exactly where a summary can flatten a hesitation, so for
 * confirm calls this reader leads instead.
 *
 * Only `user` turns are read. A list of options the caller read out must never be
 * scored as the person choosing them and a confirmation has to come after the
 * confirmation question, so a greeting cannot be read as agreement to a time the
 * person has not heard yet.
 */

import type { Slot, TranscriptTurn } from "./types.js";

const MACHINE_PATTERNS: RegExp[] = [
  /\bleave a (?:message|voicemail)\b/i,
  /\bat the tone\b/i,
  /\bis not available\b/i,
  /\bpress \d\b/i,
  /\bmailbox\b/i,
];

const NEGATIVE_MARKERS: RegExp[] = [
  /\bnot\b/i,
  /\bno\b/i,
  /\bcan'?t\b/i,
  /\bcannot\b/i,
  /\bwon'?t\b/i,
  /\bdoesn'?t\b/i,
  /\bunable\b/i,
  /\bbusy\b/i,
  /\bbad\b/i,
  /\bimpossible\b/i,
];

const NONE_PATTERNS: RegExp[] = [
  /\bnone of (?:those|them|these)\b/i,
  /\bnone work\b/i,
  /\bnothing works\b/i,
  /\bneither\b/i,
  /\bno good\b/i,
  /\bnot any of\b/i,
];

const CONFIRM_PATTERNS: RegExp[] = [
  /\bconfirm(?:ed|ing)?\b/i,
  /\bthat works\b/i,
  /\bbook it\b/i,
  /\bsee you then\b/i,
  /\bagreed\b/i,
  /\byes\b/i,
  /\bsounds good\b/i,
  /\block it in\b/i,
];

const DECLINE_PATTERNS: RegExp[] = [
  /\bcan'?t (?:do|make)\b/i,
  /\bcannot (?:do|make)\b/i,
  /\bwon'?t work\b/i,
  /\bno longer\b/i,
  /\bsomething came up\b/i,
  /\bcancel\b/i,
  /\breschedule\b/i,
  /\bnot anymore\b/i,
  /\bdecline\b/i,
  /\bno\b/i,
];

/**
 * The confirmation question the confirm script reads out. A yes only counts when
 * it comes after one of these, so an early "yes, speaking" is not a commitment.
 */
const CONFIRM_QUESTION_PATTERNS: RegExp[] = [
  /\bcan i confirm that time\b/i,
  /\bplease say confirm\b/i,
  /\bsay confirm or say no\b/i,
];

const ACK_PATTERNS: RegExp[] = [
  /\bok(?:ay)?\b/i,
  /\bunderstood\b/i,
  /\bgot it\b/i,
  /\bthanks?\b/i,
  /\bthank you\b/i,
  /\bno problem\b/i,
  /\bfine\b/i,
  /\bnoted\b/i,
];

const OPTION_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
};

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
};

export function looksLikeMachine(turns: TranscriptTurn[]): boolean {
  return turns.some(
    (turn) => turn.speaker === "user" && MACHINE_PATTERNS.some((pattern) => pattern.test(turn.text)),
  );
}

function userTurns(turns: TranscriptTurn[]): TranscriptTurn[] {
  return turns.filter((turn) => turn.speaker === "user");
}

/** Clauses, because "two works but three does not" carries two opposite facts. */
function clauses(text: string): string[] {
  return text
    .split(/[,.;!?]|\band\b|\bbut\b|\bhowever\b|\bthough\b/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

/**
 * Option numbers in one clause.
 *
 * "Option two" and "the second one" are both clear. A bare number word is only
 * read as an option when the clause gives no stronger signal, so "the second
 * one" is option two and not options one and two.
 */
function optionsIn(clause: string, maxOption: number): number[] {
  const found = new Set<number>();
  let strong = false;

  for (const match of clause.matchAll(/\b(?:option|number|slot|choice)\s+(\d|one|two|three|four)\b/gi)) {
    const token = (match[1] ?? "").toLowerCase();
    const value = /^\d$/.test(token) ? Number(token) : (OPTION_WORDS[token] ?? 0);
    if (value >= 1 && value <= maxOption) {
      found.add(value);
      strong = true;
    }
  }
  for (const [word, value] of Object.entries(ORDINAL_WORDS)) {
    if (value <= maxOption && new RegExp(`\\b${word}\\b`, "i").test(clause)) {
      found.add(value);
      strong = true;
    }
  }
  for (const match of clause.matchAll(/\b(\d)\b/g)) {
    const value = Number(match[1]);
    if (value >= 1 && value <= maxOption) {
      found.add(value);
      strong = true;
    }
  }
  if (!strong) {
    for (const [word, value] of Object.entries(OPTION_WORDS)) {
      if (value <= maxOption && new RegExp(`\\b${word}\\b`, "i").test(clause)) {
        found.add(value);
      }
    }
  }
  return [...found].sort((left, right) => left - right);
}

function negative(clause: string): boolean {
  return NEGATIVE_MARKERS.some((pattern) => pattern.test(clause));
}

export interface GatherReading {
  heardOptions: number[];
  noneWork: boolean;
  userTurnCount: number;
  machineAnswered: boolean;
  excerpt: string[];
}

export function readGather(turns: TranscriptTurn[], slots: Slot[]): GatherReading {
  const maxOption = slots.length;
  const positive = new Set<number>();
  const negated = new Set<number>();
  const excerpt: string[] = [];
  let noneWork = false;

  for (const turn of userTurns(turns)) {
    let interesting = false;
    if (NONE_PATTERNS.some((pattern) => pattern.test(turn.text))) {
      noneWork = true;
      interesting = true;
    }
    for (const clause of clauses(turn.text)) {
      const options = optionsIn(clause, maxOption);
      if (options.length === 0) {
        continue;
      }
      interesting = true;
      for (const option of options) {
        if (negative(clause)) {
          negated.add(option);
        } else {
          positive.add(option);
        }
      }
    }
    if (interesting) {
      excerpt.push(turn.text);
    }
  }

  const heardOptions = [...positive].filter((option) => !negated.has(option)).sort((a, b) => a - b);
  return {
    heardOptions,
    noneWork: noneWork && heardOptions.length === 0,
    userTurnCount: userTurns(turns).length,
    machineAnswered: looksLikeMachine(turns),
    excerpt,
  };
}

export interface CommitReading {
  answer: "confirm" | "decline" | "unknown";
  /** Did the call read the confirmation question at all. */
  questionAsked: boolean;
  userTurnCount: number;
  machineAnswered: boolean;
  excerpt: string[];
}

/** Where the caller asked the confirmation question. -1 when it was never asked. */
function confirmQuestionAt(turns: TranscriptTurn[]): number {
  return turns.findIndex(
    (turn) =>
      turn.speaker !== "user" && CONFIRM_QUESTION_PATTERNS.some((pattern) => pattern.test(turn.text)),
  );
}

/**
 * A confirmation is bound to the question.
 *
 * Only a turn after the caller asked "can I confirm that time" can confirm it,
 * so "Yes, speaking" while the caller is still saying hello is not an agreement
 * to a time the person has not heard yet. A decline still counts wherever it
 * appears in the call: it can only stop a commitment, never create one.
 */
export function readConfirm(turns: TranscriptTurn[]): CommitReading {
  const questionAt = confirmQuestionAt(turns);
  const spoken = userTurns(turns);
  let answer: CommitReading["answer"] = "unknown";
  const excerpt: string[] = [];
  for (const [index, turn] of turns.entries()) {
    if (turn.speaker !== "user") {
      continue;
    }
    if (DECLINE_PATTERNS.some((pattern) => pattern.test(turn.text))) {
      excerpt.push(turn.text);
      return {
        answer: "decline",
        questionAsked: questionAt >= 0,
        userTurnCount: spoken.length,
        machineAnswered: looksLikeMachine(turns),
        excerpt,
      };
    }
    if (questionAt >= 0 && index > questionAt && CONFIRM_PATTERNS.some((pattern) => pattern.test(turn.text))) {
      answer = "confirm";
      excerpt.push(turn.text);
    }
  }
  return {
    answer,
    questionAsked: questionAt >= 0,
    userTurnCount: spoken.length,
    machineAnswered: looksLikeMachine(turns),
    excerpt,
  };
}

export function readRelease(turns: TranscriptTurn[]): CommitReading {
  const acknowledged = userTurns(turns).some((turn) =>
    ACK_PATTERNS.some((pattern) => pattern.test(turn.text)),
  );
  return {
    answer: acknowledged ? "confirm" : "unknown",
    questionAsked: false,
    userTurnCount: userTurns(turns).length,
    machineAnswered: looksLikeMachine(turns),
    excerpt: userTurns(turns).map((turn) => turn.text).slice(0, 2),
  };
}
