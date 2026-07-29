/**
 * Local reading of the transcript.
 *
 * The structured result carries the answers, because that is what an extraction
 * contract is for. This module reads the two things a structured result should
 * never be the only source of: whether a person was actually there and whether
 * that person told the caller to go away.
 *
 * A business declining to deal with an automated caller is a legitimate answer,
 * not an error to retry around. It is detected, reported and obeyed.
 */

import type { TranscriptTurn } from "./types.js";

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
