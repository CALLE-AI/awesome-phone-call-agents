import type { Lexicon, TranscriptTurn } from '../types.ts';
import { matchPhrases } from '../lexicon.ts';

/**
 * Signal F — read-back compliance.
 * After the answer, the bot reads the value back ("Just to confirm, that is
 * 4,500 rupees per unit?"). Complied means the person repeated the value
 * itself, not just said "yeah". A bare acknowledgement is refusal: it costs
 * nothing to say and confirms nothing.
 */
export interface ReadbackResult {
  requested: boolean;
  complied: boolean;
  requestTurn: number | null;
}

/** Digits keep only digits (commas stripped); strings compare as whole words. */
function valueAppearsIn(text: string, value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'number') {
    return text.replace(/,/g, '').includes(String(value));
  }
  const escaped = String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (escaped.length === 0) return false;
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

export function detectReadback(
  turns: TranscriptTurn[],
  lastAnswerTurn: number,
  value: unknown,
  lexicon: Lexicon
): ReadbackResult {
  let requestTurn: number | null = null;
  for (let i = lastAnswerTurn + 1; i < turns.length; i++) {
    if (turns[i].speaker !== 'bot') continue;
    const hasPhrase = matchPhrases(turns[i].text, lexicon.readback_request).length > 0;
    if (hasPhrase || valueAppearsIn(turns[i].text, value)) {
      requestTurn = i;
      break;
    }
  }
  if (requestTurn == null) return { requested: false, complied: false, requestTurn: null };
  for (let i = requestTurn + 1; i < turns.length; i++) {
    if (turns[i].speaker !== 'user') continue;
    if (valueAppearsIn(turns[i].text, value)) {
      return { requested: true, complied: true, requestTurn };
    }
  }
  return { requested: true, complied: false, requestTurn };
}
