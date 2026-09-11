import { describe, it, expect } from 'vitest';
import { checkSuppression } from '../lib/suppression.js';

const PHONE = '+15550123456';

describe('checkSuppression', () => {
  it('matches an exact E.164 entry', () => {
    const result = checkSuppression({ phone: PHONE, suppressionList: '+15550123456' });
    expect(result.enforced).toBe(true);
    expect(result.suppressed).toBe(true);
  });

  it('matches regardless of formatting', () => {
    for (const entry of ['+1 (555) 012-3456', '+15550123456', '15550123456']) {
      const result = checkSuppression({ phone: PHONE, suppressionList: entry });
      expect(result.suppressed).toBe(true);
    }
  });

  it('parses comma-separated entries', () => {
    const result = checkSuppression({
      phone: PHONE,
      suppressionList: '+15550199999, +15550123456, +15550100000',
    });
    expect(result.suppressed).toBe(true);
  });

  it('parses semicolon-separated entries', () => {
    const result = checkSuppression({
      phone: PHONE,
      suppressionList: '+15550199999; +15550123456; +15550100000',
    });
    expect(result.suppressed).toBe(true);
  });

  it('parses newline-separated entries', () => {
    const result = checkSuppression({
      phone: PHONE,
      suppressionList: '+15550199999\n+15550123456\n+15550100000',
    });
    expect(result.suppressed).toBe(true);
  });

  it('parses a mix of separators', () => {
    const result = checkSuppression({
      phone: PHONE,
      suppressionList: '+15550199999,\n+15550123456;+15550100000',
    });
    expect(result.suppressed).toBe(true);
  });

  it('is not enforced when the list is blank', () => {
    const result = checkSuppression({ phone: PHONE, suppressionList: '' });
    expect(result.enforced).toBe(false);
    expect(result.suppressed).toBe(false);
  });

  it('is not enforced when the list is undefined', () => {
    const result = checkSuppression({ phone: PHONE, suppressionList: undefined });
    expect(result.enforced).toBe(false);
    expect(result.suppressed).toBe(false);
  });

  it('is not enforced when the list is whitespace-only', () => {
    const result = checkSuppression({ phone: PHONE, suppressionList: '   \n  \t ' });
    expect(result.enforced).toBe(false);
    expect(result.suppressed).toBe(false);
  });

  it('is enforced but not suppressed when nothing matches', () => {
    const result = checkSuppression({ phone: PHONE, suppressionList: '+15550199999' });
    expect(result.enforced).toBe(true);
    expect(result.suppressed).toBe(false);
  });

  it('matches on a 7+ digit suffix in either direction', () => {
    // Entry is the national-format number (7 digits); target is E.164.
    const result = checkSuppression({ phone: '+15550123456', suppressionList: '5550123456' });
    expect(result.suppressed).toBe(true);

    // Target is the shorter, entry is the longer E.164 form.
    const short = checkSuppression({ phone: '5550123456', suppressionList: '+15550123456' });
    expect(short.suppressed).toBe(true);
  });

  it('does not let a 6-digit entry suppress an unrelated longer number', () => {
    const result = checkSuppression({ phone: '+15550123456', suppressionList: '012345' });
    expect(result.suppressed).toBe(false);
    expect(result.enforced).toBe(true);
  });

  it('fails closed as suppressed when the list is not a string', () => {
    for (const badList of [{}, [], ['+15550123456'], 42, true]) {
      const result = checkSuppression({ phone: PHONE, suppressionList: badList });
      expect(result.enforced).toBe(true);
      expect(result.suppressed).toBe(true);
      expect(result.reason).toMatch(/could not be read/i);
    }
  });

  it('never throws, whatever the input', () => {
    expect(() => checkSuppression({})).not.toThrow();
    expect(() => checkSuppression()).not.toThrow();
    expect(() => checkSuppression({ phone: null, suppressionList: null })).not.toThrow();
  });

  it('masks the matched entry and leaks no raw digits, across entry formats', () => {
    for (const entry of ['+15550123456', '15550123456', '+1 (555) 012-3456']) {
      const result = checkSuppression({ phone: PHONE, suppressionList: entry });
      expect(result.suppressed).toBe(true);
      expect(result.matchedEntry).not.toBe(entry);
      expect(JSON.stringify(result)).not.toContain('5550123456');
    }
  });
});
