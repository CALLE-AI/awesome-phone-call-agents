// src/parser/confirmation.ts — correction-cue + affirmative-turn detection (PRD §6.5).
// Shared by parseTranscript. Deterministic string matching only.

/** Self-correction cues (PRD §4.3 / §6.5). First match per turn wins. */
export const CORRECTION_CUE_RE =
  /\b(no wait|scratch that|actually|make it|sorry,? i meant|let'?s do .+ instead|change that to)\b/i;

export function findCorrectionCue(text: string): { cue: string; index: number } | null {
  const m = CORRECTION_CUE_RE.exec(text);
  if (!m) return null;
  return { cue: m[1]!.toLowerCase(), index: m.index };
}

const AFFIRMATIVE_RE =
  /\b(yes|yep|yeah|yup|that works|works for me|that'?s right|correct|confirmed|sounds good|see you then|perfect|great,? see you)\b/i;

/** A user turn that affirms — but not one that opens with a negation or a correction. */
export function isAffirmative(text: string): boolean {
  if (/^\s*(no|nope|not|nah)\b/i.test(text)) return false;
  if (findCorrectionCue(text)) return false;
  return AFFIRMATIVE_RE.test(text);
}

const INTERROGATIVE_START_RE =
  /^\s*(is|are|can|could|would|will|do|does|did|what|when|which|how|any chance|got anything)\b/i;

/** A turn that asks rather than asserts — its datetimes are mentions, not targets. */
export function isInterrogative(text: string): boolean {
  return /\?\s*$/.test(text.trim()) || INTERROGATIVE_START_RE.test(text);
}
