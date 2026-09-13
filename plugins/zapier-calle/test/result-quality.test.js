import { describe, it, expect } from 'vitest';
import {
  findUnusableFields,
  describeUnusableFields,
  checkConfidenceScore,
  toMinConfidenceScore,
  DEFAULT_MIN_CONFIDENCE_SCORE,
} from '../lib/result-quality.js';

describe('findUnusableFields', () => {
  describe('with a schema', () => {
    const schema = {
      type: 'object',
      required: ['qualified', 'budget'],
      properties: { qualified: {}, budget: {}, notes: {} },
    };

    it('reports nothing when every required field carries an answer', () => {
      expect(findUnusableFields({ qualified: 'yes', budget: 5000 }, schema)).toEqual([]);
    });

    it('reports a required field that was never returned', () => {
      expect(findUnusableFields({ qualified: 'yes' }, schema)).toEqual([
        { path: 'budget', why: 'missing' },
      ]);
    });

    it('reports each unknown-like token the linter tells authors to add', () => {
      for (const token of ['unknown', 'unclear', 'not_stated', 'undetermined']) {
        const unusable = findUnusableFields({ qualified: token, budget: 1 }, schema);
        expect(unusable).toEqual([{ path: 'qualified', why: 'unknown' }]);
      }
    });

    it('matches unknown tokens regardless of case or padding', () => {
      expect(findUnusableFields({ qualified: '  UNKNOWN  ', budget: 1 }, schema))
        .toEqual([{ path: 'qualified', why: 'unknown' }]);
    });

    it('ignores an optional field that came back unusable', () => {
      expect(findUnusableFields({ qualified: 'yes', budget: 1, notes: 'unknown' }, schema))
        .toEqual([]);
    });

    it('descends into nested required objects', () => {
      const nested = {
        type: 'object',
        required: ['appointment'],
        properties: {
          appointment: { type: 'object', required: ['date', 'time'], properties: {} },
        },
      };
      expect(findUnusableFields({ appointment: { date: '2026-09-01', time: null } }, nested))
        .toEqual([{ path: 'appointment.time', why: 'empty' }]);
    });

    it('reports the parent rather than descending when the parent itself is empty', () => {
      const nested = {
        type: 'object',
        required: ['appointment'],
        properties: { appointment: { type: 'object', required: ['time'] } },
      };
      expect(findUnusableFields({ appointment: {} }, nested))
        .toEqual([{ path: 'appointment', why: 'empty' }]);
    });

    it('treats a non-object result as every required field missing', () => {
      expect(findUnusableFields(null, schema).map((entry) => entry.path))
        .toEqual(['qualified', 'budget']);
    });
  });

  describe('without a schema', () => {
    it('flags unknown and empty values it can see', () => {
      expect(findUnusableFields({ a: 'unknown', b: null, c: 'yes' })).toEqual([
        { path: 'a', why: 'unknown' },
        { path: 'b', why: 'empty' },
      ]);
    });

    it('cannot detect a missing field, because nothing declares one', () => {
      expect(findUnusableFields({ a: 'yes' })).toEqual([]);
    });

    it('descends into nested objects', () => {
      expect(findUnusableFields({ outer: { inner: 'unclear' } }))
        .toEqual([{ path: 'outer.inner', why: 'unknown' }]);
    });
  });

  it('treats false and 0 as answers rather than as empty', () => {
    expect(findUnusableFields({ attending: false, count: 0 })).toEqual([]);
  });

  it('returns an unusable marker instead of throwing on a hostile result', () => {
    const hostile = {};
    Object.defineProperty(hostile, 'boom', {
      get() { throw new Error('boom'); },
      enumerable: true,
    });
    expect(() => findUnusableFields(hostile)).not.toThrow();
    expect(findUnusableFields(hostile).length).toBeGreaterThan(0);
  });

  it('stops descending at the depth cap instead of recursing forever', () => {
    let deep = { value: 'unknown' };
    for (let i = 0; i < 40; i += 1) deep = { nested: deep };
    expect(() => findUnusableFields(deep)).not.toThrow();
  });
});

describe('describeUnusableFields', () => {
  it('names at most three fields and counts the rest', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((path) => ({ path, why: 'unknown' }));
    const text = describeUnusableFields(many);
    expect(text.startsWith('a ')).toBe(true);
    expect(text).toContain('and 2 more fields');
    expect(text).not.toContain('d came');
    expect(text).not.toContain('e came');
  });

  it('uses the singular when exactly one field is unnamed', () => {
    const four = ['a', 'b', 'c', 'd'].map((path) => ({ path, why: 'missing' }));
    expect(describeUnusableFields(four)).toContain('and 1 more field');
  });
});

describe('checkConfidenceScore', () => {
  it('accepts a score at or above the floor', () => {
    expect(checkConfidenceScore({ score: 0.6 }, 0.6).ok).toBe(true);
    expect(checkConfidenceScore({ score: 1 }, 0.6).ok).toBe(true);
  });

  it('rejects a score below the floor', () => {
    const result = checkConfidenceScore({ score: 0.59 }, 0.6);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('0.59');
  });

  it('rejects a missing or non-numeric score while the floor is active', () => {
    expect(checkConfidenceScore({}, 0.6).ok).toBe(false);
    expect(checkConfidenceScore(null, 0.6).ok).toBe(false);
    expect(checkConfidenceScore({ score: '0.9' }, 0.6).ok).toBe(false);
    expect(checkConfidenceScore({ score: NaN }, 0.6).ok).toBe(false);
  });

  it('disables the check entirely at a floor of 0, including a missing score', () => {
    expect(checkConfidenceScore({}, 0).ok).toBe(true);
    expect(checkConfidenceScore({ score: 0 }, 0).ok).toBe(true);
  });
});

describe('toMinConfidenceScore', () => {
  it('defaults when nothing was supplied', () => {
    for (const value of [undefined, null, '']) {
      expect(toMinConfidenceScore(value)).toBe(DEFAULT_MIN_CONFIDENCE_SCORE);
    }
  });

  it('accepts an in-range number or numeric string', () => {
    expect(toMinConfidenceScore(0.8)).toBe(0.8);
    expect(toMinConfidenceScore(' 0.8 ')).toBe(0.8);
    expect(toMinConfidenceScore(0)).toBe(0);
  });

  // Fail closed: a typo must not silently switch the check off.
  it('falls back to the default rather than disabling on a bad value', () => {
    for (const value of ['abc', '-1', '2', {}, [], NaN, Infinity]) {
      expect(toMinConfidenceScore(value)).toBe(DEFAULT_MIN_CONFIDENCE_SCORE);
    }
  });
});
