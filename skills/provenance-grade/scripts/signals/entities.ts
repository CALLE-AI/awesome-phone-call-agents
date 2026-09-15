import type { FieldType } from '../types.ts';

/**
 * Deterministic entity spotting shared by signals C, G, H and I.
 * This is a heuristic, not NER — see references/limitations.md.
 */
export type EntityClass =
  | 'weekday'
  | 'date'
  | 'duration'
  | 'price'
  | 'stock_count'
  | 'place'
  | 'part_number'
  | 'invoice_ref';

export interface Entity {
  cls: EntityClass;
  text: string;
  start: number;
  end: number;
}

const WORD_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  'couple of': 2, few: 3,
};

const NUMWORD =
  '(?:couple of|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|few|\\d+)';

const WEEKDAY_RE = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
const DATE_RE =
  /\b(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?the\s+\d{1,2}(?:st|nd|rd|th)\b/gi;
const DURATION_RE = new RegExp(
  `\\b(${NUMWORD})\\s+(business\\s+)?(days?|weeks?|months?|hours?)\\b`,
  'gi'
);
const PRICE_RE =
  /(?:₹|\brs\.?\s*|\binr\s*)\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s*(?:rupees?|rs|inr|paise|dollars?)\b/gi;
const STOCK_RE = new RegExp(
  `\\b(${NUMWORD})\\s+(units?|pieces?|pcs|boxes?|cartons?|nos)\\b`,
  'gi'
);
const INVOICE_RE = /\b(?:invoice|ref(?:erence)?|bill)\s*(?:no\.?|number|#)?\s*[A-Z]{1,5}[- ]?\d+\b|\bINV[- ]?\d+\b/gi;
// Case-sensitive on purpose: part numbers and place names are capitalised.
const PART_RE = /\b[A-Z]{2,5}[- ]\d{2,}\b/g;
const PLACE_RE = /\b(?:at|in|from)\s+(?:the\s+|our\s+)?([A-Z][a-z]{2,})\b/g;

const PLACE_BLOCKLIST = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'press', 'please', 'sorry', 'stock', 'order', 'total', 'fact', 'general',
  'yes', 'this', 'that', 'transit',
]);

// When spans overlap, the more specific class wins.
const CLASS_PRIORITY: EntityClass[] = [
  'invoice_ref', 'date', 'price', 'stock_count', 'duration',
  'weekday', 'part_number', 'place',
];

function collect(re: RegExp, text: string, cls: EntityClass): Entity[] {
  const out: Entity[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ cls, text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export function extractEntities(text: string): Entity[] {
  const raw: Entity[] = [
    ...collect(INVOICE_RE, text, 'invoice_ref'),
    ...collect(DATE_RE, text, 'date'),
    ...collect(PRICE_RE, text, 'price'),
    ...collect(STOCK_RE, text, 'stock_count'),
    ...collect(DURATION_RE, text, 'duration'),
    ...collect(WEEKDAY_RE, text, 'weekday'),
    ...collect(PART_RE, text, 'part_number'),
    ...collect(PLACE_RE, text, 'place').filter(
      (e) => !PLACE_BLOCKLIST.has(e.text.split(/\s+/).pop()!.toLowerCase())
    ),
  ];
  raw.sort(
    (x, y) => CLASS_PRIORITY.indexOf(x.cls) - CLASS_PRIORITY.indexOf(y.cls)
  );
  const kept: Entity[] = [];
  for (const e of raw) {
    if (!kept.some((k) => e.start < k.end && k.start < e.end)) kept.push(e);
  }
  return kept.sort((x, y) => x.start - y.start);
}

/** Entity classes that satisfy the *asked* type. Everything else is corroborating. */
export function classesFor(expects: FieldType): EntityClass[] {
  switch (expects) {
    case 'duration': return ['duration'];
    case 'weekday': return ['weekday', 'date'];
    case 'date': return ['date', 'weekday'];
    case 'price': return ['price'];
    case 'count': return ['stock_count'];
    case 'text': return [];
  }
}

export function parseCount(text: string): number | null {
  const m = text.toLowerCase().match(new RegExp(`^(${NUMWORD})`));
  if (!m) return null;
  const w = m[1];
  if (/^\d+$/.test(w)) return parseInt(w, 10);
  return WORD_NUM[w] ?? null;
}

/** Candidate values of the asked type found in the answer text. For signal I. */
export function valueCandidates(text: string, expects: FieldType): (string | number)[] {
  const entities = extractEntities(text);
  switch (expects) {
    case 'duration':
    case 'count': {
      const cls = expects === 'duration' ? 'duration' : 'stock_count';
      return entities
        .filter((e) => e.cls === cls)
        .map((e) => parseCount(e.text))
        .filter((n): n is number => n != null);
    }
    case 'price':
      return entities
        .filter((e) => e.cls === 'price')
        .map((e) => parseFloat(e.text.replace(/[^\d.]/g, '')))
        .filter((n) => Number.isFinite(n));
    case 'weekday':
    case 'date': {
      const days: string[] = [];
      for (const e of entities) {
        if (e.cls === 'weekday' || e.cls === 'date') {
          const m = e.text.match(WEEKDAY_RE);
          if (m) days.push(m[0].toLowerCase());
          WEEKDAY_RE.lastIndex = 0;
        }
      }
      return days;
    }
    case 'text':
      return [];
  }
}
