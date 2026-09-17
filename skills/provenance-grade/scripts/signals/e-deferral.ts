import type { Lexicon, TranscriptTurn } from '../types.ts';
import { matchPhrases } from '../lexicon.ts';

/**
 * Signal E — deferral.
 * "I'll have to confirm", "let me get back to you", "my colleague handles
 * that". A hard downgrade: the speaker told us they cannot stand behind the
 * value right now. Scans every user turn from the question through the answer.
 */
export interface DeferralResult {
  fired: boolean;
  phrases: string[];
}

export function detectDeferral(
  turns: TranscriptTurn[],
  questionTurn: number | null,
  lastAnswerTurn: number,
  lexicon: Lexicon
): DeferralResult {
  const from = questionTurn == null ? 0 : questionTurn + 1;
  const phrases: string[] = [];
  for (let i = from; i <= lastAnswerTurn && i < turns.length; i++) {
    if (turns[i].speaker !== 'user') continue;
    phrases.push(...matchPhrases(turns[i].text, lexicon.deferral));
  }
  return { fired: phrases.length > 0, phrases };
}
