import { readFileSync } from 'node:fs';
import { LexiconSchema, type Lexicon } from './types.ts';

/**
 * The lexicon is a swappable JSON file. `en.json` is the validated default;
 * any other language file ships unvalidated (its `validated` flag says so).
 */
export function loadLexicon(language = 'en'): Lexicon {
  const url = new URL(`./lexicon/${language}.json`, import.meta.url);
  return LexiconSchema.parse(JSON.parse(readFileSync(url, 'utf8')));
}

/**
 * Case-insensitive whole-word phrase match. "hold on" must not fire on
 * "holding", so every token is boundary-anchored.
 */
export function phraseRegex(phrase: string): RegExp {
  const escaped = phrase
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

/** Returns the matched phrases (not just a boolean) so grades can cite them. */
export function matchPhrases(text: string, phrases: string[]): string[] {
  return phrases.filter((p) => phraseRegex(p).test(text));
}
