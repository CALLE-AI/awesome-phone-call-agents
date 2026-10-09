import type { FieldType, Lexicon } from '../types.ts';
import { matchPhrases } from '../lexicon.ts';
import { valueCandidates } from './entities.ts';

/**
 * Signal I — self-correction.
 * A value stated then revised ("five days — actually, no wait, six").
 * Fires when a correction phrase co-occurs with two distinct candidate
 * values of the asked type. The final value is taken; the field is flagged
 * unstable and can never grade verified.
 */
export interface SelfCorrectionResult {
  fired: boolean;
  candidates: (string | number)[];
  finalValue: string | number | null;
}

export function detectSelfCorrection(
  answerText: string,
  expects: FieldType,
  lexicon: Lexicon
): SelfCorrectionResult {
  const candidates = valueCandidates(answerText, expects);
  const distinct = [...new Set(candidates)];
  const hasCorrectionPhrase = matchPhrases(answerText, lexicon.correction).length > 0;
  const fired = hasCorrectionPhrase && distinct.length >= 2;
  return {
    fired,
    candidates: distinct,
    finalValue: candidates.length > 0 ? candidates[candidates.length - 1] : null,
  };
}
