import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../scripts/types.ts';
import { loadLexicon } from '../scripts/lexicon.ts';
import { detectRetrievalGap, estSpeechSeconds } from '../scripts/signals/a-retrieval-gap.ts';
import { detectCheckLanguage } from '../scripts/signals/b-check-language.ts';
import { detectCorroboration } from '../scripts/signals/c-corroboration.ts';
import { detectHedging } from '../scripts/signals/d-hedging.ts';
import { detectDeferral } from '../scripts/signals/e-deferral.ts';
import { detectReadback } from '../scripts/signals/f-readback.ts';
import { detectRoundNumber } from '../scripts/signals/g-round-number.ts';
import { detectAlignment } from '../scripts/signals/h-alignment.ts';
import { detectSelfCorrection } from '../scripts/signals/i-self-correction.ts';
import { extractEntities } from '../scripts/signals/entities.ts';

const lex = loadLexicon('en');

const turn = (speaker: 'bot' | 'user', text: string, offset_seconds: number): TranscriptTurn => ({
  speaker,
  text,
  offset_seconds,
});

describe('signal A — retrieval gap', () => {
  it('estimates speech time at 2.5 words per second', () => {
    expect(estSpeechSeconds('one two three four five')).toBe(2);
  });
  it('fires when the silence after the question exceeds 6 seconds', () => {
    const turns = [turn('bot', 'five words in this question', 10), turn('user', 'Tuesday.', 20)];
    const r = detectRetrievalGap(turns, 0, 1);
    expect(r.fired).toBe(true);
    expect(r.gapSeconds).toBe(8);
  });
  it('does not fire on an immediate answer', () => {
    const turns = [turn('bot', 'five words in this question', 10), turn('user', 'Tuesday.', 13)];
    expect(detectRetrievalGap(turns, 0, 1).fired).toBe(false);
  });
  it('never fires without a question turn', () => {
    expect(detectRetrievalGap([turn('user', 'hi', 0)], null, 0)).toEqual({
      fired: false,
      gapSeconds: null,
    });
  });
});

describe('signal B — check language', () => {
  it('fires on "let me check" between question and answer', () => {
    const turns = [
      turn('bot', 'what is the price?', 0),
      turn('user', 'Hold on, let me check.', 4),
      turn('user', 'It is 340 rupees.', 12),
    ];
    const r = detectCheckLanguage(turns, 0, 2, lex);
    expect(r.fired).toBe(true);
    expect(r.phrases).toContain('let me check');
  });
  it('"holding" does not trigger "hold on" (word boundaries)', () => {
    const turns = [turn('bot', 'which day?', 0), turn('user', 'We are holding eleven units.', 4)];
    expect(detectCheckLanguage(turns, 0, 1, lex).phrases).not.toContain('hold on');
  });
  it('ignores bot turns and turns outside the window', () => {
    const turns = [
      turn('user', 'let me check something first', 0),
      turn('bot', 'what is the price? one second', 4),
      turn('user', 'It is 340 rupees.', 8),
    ];
    expect(detectCheckLanguage(turns, 1, 2, lex).fired).toBe(false);
  });
});

describe('signal C — corroborating specific', () => {
  it('fires on an unrequested stock count and warehouse name', () => {
    const r = detectCorroboration(
      'It ships Tuesday. We are holding eleven units at the Bhiwandi warehouse.',
      'weekday'
    );
    expect(r.fired).toBe(true);
    const classes = r.spans.map((s) => s.cls);
    expect(classes).toContain('stock_count');
    expect(classes).toContain('place');
  });
  it('does not count the asked entity type as corroboration', () => {
    expect(detectCorroboration('Four business days.', 'duration').fired).toBe(false);
    expect(detectCorroboration('It is 1,180 rupees per box.', 'price').fired).toBe(false);
  });
  it('accepts an injected span provider but only for spans', () => {
    const r = detectCorroboration('anything', 'price', () => [{ cls: 'place', text: 'Bhiwandi' }]);
    expect(r.fired).toBe(true);
    expect(r.spans[0].text).toBe('Bhiwandi');
  });
});

describe('signal D — hedging', () => {
  it('fires on "should be" and "I think"', () => {
    expect(detectHedging('Should be Tuesday.', lex).fired).toBe(true);
    expect(detectHedging('I think around five days.', lex).terms).toContain('i think');
  });
  it('does not fire on a plain direct answer', () => {
    expect(detectHedging('Four business days.', lex).fired).toBe(false);
  });
});

describe('signal E — deferral', () => {
  it('fires on "let me get back to you"', () => {
    const turns = [
      turn('bot', 'warranty period?', 0),
      turn('user', 'Twelve months, but let me get back to you.', 4),
    ];
    expect(detectDeferral(turns, 0, 1, lex).fired).toBe(true);
  });
  it('fires on colleague hand-off', () => {
    const turns = [turn('bot', 'price?', 0), turn('user', 'My colleague handles pricing.', 4)];
    expect(detectDeferral(turns, 0, 1, lex).fired).toBe(true);
  });
});

describe('signal F — read-back compliance', () => {
  const base = [
    turn('bot', 'what is the rate?', 0),
    turn('user', 'It is 4,500 rupees per unit.', 5),
    turn('bot', 'Just to confirm, that is 4,500 rupees per unit?', 12),
  ];
  it('complied when the value is repeated (comma-insensitive)', () => {
    const turns = [...base, turn('user', 'Yes, 4,500 rupees, correct.', 17)];
    expect(detectReadback(turns, 1, 4500, lex)).toMatchObject({ requested: true, complied: true });
  });
  it('refused when the person only acknowledges', () => {
    const turns = [...base, turn('user', 'Yeah, yeah, that is what I said.', 17)];
    expect(detectReadback(turns, 1, 4500, lex)).toMatchObject({ requested: true, complied: false });
  });
  it('not requested when no bot read-back follows the answer', () => {
    const turns = base.slice(0, 2);
    expect(detectReadback(turns, 1, 4500, lex).requested).toBe(false);
  });
});

describe('signal G — round-number shape', () => {
  it('fires on "a week" and "five days"', () => {
    expect(detectRoundNumber('It takes a week.', 'duration').fired).toBe(true);
    expect(detectRoundNumber('Five days.', 'duration').fired).toBe(true);
  });
  it('does not fire on "4 business days" or a non-round count', () => {
    expect(detectRoundNumber('Four business days.', 'duration').fired).toBe(false);
    expect(detectRoundNumber('Six days.', 'duration').fired).toBe(false);
  });
});

describe('signal H — answer alignment', () => {
  it('misaligned when a price question gets a weekday answer', () => {
    expect(detectAlignment('We can ship it Tuesday itself.', 'price').aligned).toBe(false);
  });
  it('aligned when the asked type is present', () => {
    expect(detectAlignment('It is 1,180 rupees.', 'price').aligned).toBe(true);
    expect(detectAlignment('Tuesday tak ho jayega.', 'weekday').aligned).toBe(true);
  });
  it('text fields cannot be checked and pass', () => {
    expect(detectAlignment('anything at all', 'text').aligned).toBe(true);
  });
});

describe('signal I — self-correction', () => {
  it('fires on a revised value and takes the final one', () => {
    const r = detectSelfCorrection(
      'Five days. Actually, no wait, six days.',
      'duration',
      lex
    );
    expect(r.fired).toBe(true);
    expect(r.finalValue).toBe(6);
  });
  it('does not fire on a single stable value', () => {
    expect(detectSelfCorrection('Six days.', 'duration', lex).fired).toBe(false);
  });
  it('needs a correction phrase, not just two numbers', () => {
    const r = detectSelfCorrection('Five days to Pune, six days to Nashik.', 'duration', lex);
    expect(r.fired).toBe(false);
  });
});

describe('entity extraction', () => {
  it('classifies invoice refs over part numbers on overlap', () => {
    const classes = extractEntities('same as on invoice INV-2291').map((e) => e.cls);
    expect(classes).toContain('invoice_ref');
    expect(classes).not.toContain('part_number');
  });
  it('blocklists IVR words from place detection', () => {
    expect(extractEntities('Press 1 for sales. In Transit now.').some((e) => e.cls === 'place')).toBe(
      false
    );
  });
});
