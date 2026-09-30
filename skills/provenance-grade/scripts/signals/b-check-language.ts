import type { Lexicon, TranscriptTurn } from '../types.ts';
import { matchPhrases } from '../lexicon.ts';

/**
 * Signal B — explicit check language.
 * "Hold on", "let me check", "one second" … in a user turn between the
 * question and the answer (inclusive of the answer turn, since people say
 * "let me check — yes, eleven units" in one breath).
 */
export interface CheckLanguageResult {
  fired: boolean;
  phrases: string[];
}

export function detectCheckLanguage(
  turns: TranscriptTurn[],
  questionTurn: number | null,
  lastAnswerTurn: number,
  lexicon: Lexicon
): CheckLanguageResult {
  if (questionTurn == null) return { fired: false, phrases: [] };
  const phrases: string[] = [];
  for (let i = questionTurn + 1; i <= lastAnswerTurn && i < turns.length; i++) {
    if (turns[i].speaker !== 'user') continue;
    phrases.push(...matchPhrases(turns[i].text, lexicon.check));
  }
  return { fired: phrases.length > 0, phrases };
}
