/**
 * Local reading of the call transcript.
 *
 * The gate decides from the recipient turns itself instead of trusting a
 * summary. Two rules make that sound. Only `user` turns count, so a phrase the
 * caller read out can never be scored as if the person said it. Refusal wins
 * over approval, so "do not approve" is a rejection even though the word
 * approve is in it.
 */

import { containsCode, containsPhrase, spokenDigits } from "./secret.js";
import type { Binding, Decision, TranscriptReading, TranscriptTurn } from "./types.js";

const REJECT_PATTERNS: RegExp[] = [
  /\b(?:do not|don'?t|never)\s+(?:\w+\s+){0,3}(?:approve|deploy|release|ship|proceed|go ahead)\b/i,
  /\breject(?:ed|ing)?\b/i,
  /\bden(?:y|ied)\b/i,
  /\bdecline[ds]?\b/i,
  /\bcancel(?:led|ed)?\b/i,
  /\bstop\b/i,
  /\bhold (?:off|it|on that)\b/i,
  /\bnot approved?\b/i,
  /\babort\b/i,
  /\bno,? (?:do not|don'?t|not now|thanks)\b/i,
];

const APPROVE_PATTERNS: RegExp[] = [
  /\bapprove[ds]?\b/i,
  /\bapproval\b/i,
  /\bauthori[sz]e[d]?\b/i,
  /\bgo ahead\b/i,
  /\bship it\b/i,
  /\bproceed\b/i,
  /\bconfirm(?:ed)?\b/i,
  /\byes\b/i,
];

/** Turns that suggest the line was answered by a machine, not a person. */
const MACHINE_PATTERNS: RegExp[] = [
  /\bleave a (?:message|voicemail)\b/i,
  /\bat the tone\b/i,
  /\bis not available\b/i,
  /\bpress \d\b/i,
  /\bmailbox\b/i,
];

export function decisionFromLine(line: string): Decision {
  for (const pattern of REJECT_PATTERNS) {
    if (pattern.test(line)) {
      return "reject";
    }
  }
  for (const pattern of APPROVE_PATTERNS) {
    if (pattern.test(line)) {
      return "approve";
    }
  }
  return "unknown";
}

/** Decision re-read from recorded excerpt lines. Rejection still wins. */
export function decisionFromLines(lines: string[]): Decision {
  let decision: Decision = "unknown";
  for (const line of lines) {
    const lineDecision = decisionFromLine(line);
    if (lineDecision === "reject") {
      return "reject";
    }
    if (lineDecision === "approve") {
      decision = "approve";
    }
  }
  return decision;
}

/** A voicemail greeting or an IVR menu reaches us as recipient turns. */
export function looksLikeMachine(turns: TranscriptTurn[]): boolean {
  return turns.some(
    (turn) =>
      turn.speaker === "user" && MACHINE_PATTERNS.some((pattern) => pattern.test(turn.text)),
  );
}

/**
 * Read the recipient turns for a secret and a decision.
 *
 * The last decision signal wins, because a person often thinks out loud before
 * committing. A rejection anywhere in the call is kept, because a person who
 * said stop should not be talked past.
 */
export function readTranscript(
  turns: TranscriptTurn[],
  options: { binding: Binding; code: string; phrase: string[] },
): TranscriptReading {
  const userTurns = turns.filter((turn) => turn.speaker === "user");
  const excerpt: string[] = [];
  let secretSpoken = false;
  let spoken: string | null = null;
  let decisionSignal: Decision = "unknown";
  let rejected = false;

  for (const turn of userTurns) {
    const matchedSecret =
      options.binding === "code_from_request"
        ? containsCode(turn.text, options.code)
        : containsPhrase(turn.text, options.phrase);
    const lineDecision = decisionFromLine(turn.text);

    if (matchedSecret) {
      secretSpoken = true;
      const digits = spokenDigits(turn.text);
      if (digits.length > 0) {
        spoken = digits;
      }
    }
    if (lineDecision === "reject") {
      rejected = true;
    }
    if (matchedSecret || lineDecision !== "unknown") {
      excerpt.push(turn.text);
      if (lineDecision !== "unknown") {
        decisionSignal = lineDecision;
      }
    }
  }

  if (rejected) {
    decisionSignal = "reject";
  }

  return {
    secretSpoken,
    spokenDigits: spoken,
    decisionSignal,
    userTurnCount: userTurns.length,
    excerpt,
  };
}
