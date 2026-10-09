import type { Lexicon } from '../types.ts';
import { matchPhrases } from '../lexicon.ts';

/**
 * Signal D — hedging lexicon.
 * "should be", "I think", "probably", "around" … in the answer turn(s).
 * Any hit drops the field to assumed. English-centric by construction;
 * the lexicon file is swappable (see scripts/lexicon/).
 */
export interface HedgingResult {
  fired: boolean;
  terms: string[];
}

export function detectHedging(answerText: string, lexicon: Lexicon): HedgingResult {
  const terms = matchPhrases(answerText, lexicon.hedge);
  return { fired: terms.length > 0, terms };
}
