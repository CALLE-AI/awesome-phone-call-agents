import type { TranscriptTurn } from '../types.ts';

/**
 * Signal A — retrieval gap.
 * gap = answer.offset − question.offset − estimated speaking time of the question.
 * A gap above the threshold suggests the person went and looked something up.
 * Known weakness: offset_seconds is an integer marking turn START, so the gap
 * absorbs the previous turn's duration. That is why A alone never upgrades —
 * it only counts alongside C. See references/limitations.md.
 */
export const RETRIEVAL_GAP_THRESHOLD_SECONDS = 6;
export const SPEECH_WORDS_PER_SECOND = 2.5;

export function estSpeechSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words / SPEECH_WORDS_PER_SECOND;
}

export interface RetrievalGapResult {
  fired: boolean;
  gapSeconds: number | null;
}

export function detectRetrievalGap(
  turns: TranscriptTurn[],
  questionTurn: number | null,
  firstAnswerTurn: number
): RetrievalGapResult {
  if (questionTurn == null) return { fired: false, gapSeconds: null };
  const q = turns[questionTurn];
  const a = turns[firstAnswerTurn];
  if (!q || !a) return { fired: false, gapSeconds: null };
  const gap = a.offset_seconds - q.offset_seconds - estSpeechSeconds(q.text);
  const gapSeconds = Math.round(gap * 10) / 10;
  return { fired: gap > RETRIEVAL_GAP_THRESHOLD_SECONDS, gapSeconds };
}
