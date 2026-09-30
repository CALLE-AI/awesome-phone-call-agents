// AI-disclosure check. The task template tells CALL-E to disclose that an assistant is
// calling on someone's behalf; this checks whether that actually happened, grounded in
// the agent's own transcript turns, so the card can show it as evidence rather than
// assert it. Regulatory hook: EU AI Act Art. 50 (AI interaction disclosure) and the
// CALL-E ToS ban on impersonation.

import type { TranscriptTurn } from "./types";

export interface DisclosureCheck {
  /** true when an agent turn discloses it is an assistant/AI calling on someone's behalf. */
  disclosed: boolean;
  /** The agent turn that carries the disclosure, when found. */
  turn?: TranscriptTurn;
}

const DISCLOSURE_PATTERNS: RegExp[] = [
  /\bassistant\b/i,
  /\bon (?:a |the |your |their |his |her |my )?(?:customer'?s |person'?s |client'?s |patient'?s |resident'?s |their )?behalf\b/i,
  /\b(?:an? )?(?:AI|A\.I\.|automated|virtual) (?:assistant|agent|caller|system)\b/i,
  /\bcalling for (?:a|the) (?:customer|client|person|patient|resident)\b/i,
];

/** Find the first agent ("bot") turn that discloses the call is made by an assistant on someone's behalf. */
export function findDisclosure(transcript: TranscriptTurn[]): DisclosureCheck {
  for (const turn of transcript) {
    if (turn.speaker !== "bot") continue;
    if (DISCLOSURE_PATTERNS.some((re) => re.test(turn.text))) {
      return { disclosed: true, turn };
    }
  }
  return { disclosed: false };
}
