import type { FieldType } from '../types.ts';
import { extractEntities, parseCount } from './entities.ts';

/**
 * Signal G — round-number shape.
 * "a week", "five days", "a couple of days" read like estimates; "4 business
 * days" or "Thursday the 18th" read like schedule entries. A mild downgrade
 * that only bites when no corroborating specific (signal C) is present —
 * the rule table enforces that, not this detector.
 */
const ROUND_DAY_COUNTS = new Set([5, 10, 15, 20, 30]);

export interface RoundNumberResult {
  fired: boolean;
  span: string | null;
}

export function detectRoundNumber(answerText: string, expects: FieldType): RoundNumberResult {
  const entities = extractEntities(answerText);
  for (const e of entities) {
    if (e.cls === 'duration') {
      const lower = e.text.toLowerCase();
      if (lower.includes('business')) continue;
      const count = parseCount(e.text);
      if (count == null) continue;
      if (/couple of|few/.test(lower)) return { fired: true, span: e.text };
      if (/weeks?|months?/.test(lower) && count === 1) return { fired: true, span: e.text };
      if (/days?/.test(lower) && ROUND_DAY_COUNTS.has(count)) return { fired: true, span: e.text };
    }
    if (e.cls === 'price' && expects === 'price') {
      const amount = parseFloat(e.text.replace(/[^\d.]/g, ''));
      if (Number.isFinite(amount) && amount >= 1000 && amount % 1000 === 0) {
        return { fired: true, span: e.text };
      }
    }
  }
  return { fired: false, span: null };
}
