import type { FieldType } from '../types.ts';
import { classesFor, extractEntities } from './entities.ts';

/**
 * Signal H — answer alignment.
 * Does the answer turn contain the entity TYPE that was asked for? Asked a
 * price and got "we can ship it Tuesday" → misaligned → assumed, whatever
 * the extractor managed to pull out.
 *
 * Like C, this is a model-assist slot: an AlignmentProvider may replace the
 * heuristic by returning the matched span (or none). Spans only — the grade
 * stays with the rule table. Fields typed 'text' cannot be checked and are
 * treated as aligned.
 */
export interface AlignmentResult {
  aligned: boolean;
  matchedSpan: string | null;
}

export type AlignmentProvider = (args: {
  answerText: string;
  expects: FieldType;
}) => AlignmentResult;

export const heuristicAlignment: AlignmentProvider = ({ answerText, expects }) => {
  if (expects === 'text') return { aligned: true, matchedSpan: null };
  const asked = new Set<string>(classesFor(expects));
  const match = extractEntities(answerText).find((e) => asked.has(e.cls));
  return { aligned: match != null, matchedSpan: match?.text ?? null };
};

export function detectAlignment(
  answerText: string,
  expects: FieldType,
  provider: AlignmentProvider = heuristicAlignment
): AlignmentResult {
  return provider({ answerText, expects });
}
