import type { FieldType } from '../types.ts';
import { classesFor, extractEntities } from './entities.ts';

/**
 * Signal C — corroborating specific.
 * The answer volunteers a specific entity that was NOT requested: a stock
 * count, a warehouse name, a part number, an invoice reference, an exact
 * date. People who just looked at a system tend to leak what they saw.
 *
 * This is the model-assisted slot: a model may replace the default heuristic
 * below by returning SPANS via CorroborationProvider. It must never return a
 * grade — the rule table in grade.ts owns the grade. The default provider is
 * this deterministic entity heuristic, so tests need no network.
 */
export interface CorroborationSpan {
  cls: string;
  text: string;
}

export type CorroborationProvider = (args: {
  answerText: string;
  expects: FieldType;
}) => CorroborationSpan[];

export interface CorroborationResult {
  fired: boolean;
  spans: CorroborationSpan[];
}

export const heuristicCorroboration: CorroborationProvider = ({ answerText, expects }) => {
  if (expects === 'text') return [];
  const asked = new Set<string>(classesFor(expects));
  return extractEntities(answerText)
    .filter((e) => !asked.has(e.cls))
    .map((e) => ({ cls: e.cls, text: e.text }));
};

export function detectCorroboration(
  answerText: string,
  expects: FieldType,
  provider: CorroborationProvider = heuristicCorroboration
): CorroborationResult {
  const spans = provider({ answerText, expects });
  return { fired: spans.length > 0, spans };
}
