import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  isValidE164,
  maskPhone,
  isBlockedNumber,
  dedupeByPhone,
  businessNameKey,
} from '../phone.js';

describe('normalizePhone', () => {
  it('normalises a national number when given the country', () => {
    expect(normalizePhone('(415) 555-0132', 'US')?.e164).toBe('+14155550132');
  });

  it('normalises an already-international number without a country hint', () => {
    expect(normalizePhone('+353 1 555 0100')?.e164).toBe('+35315550100');
  });

  it('picks the first valid number when a listing crams several into one field', () => {
    const result = normalizePhone('+353 1 555 0100; +353 87 999 0000');
    expect(result?.e164).toBe('+35315550100');
  });

  it('returns null rather than guessing at an unusable value', () => {
    expect(normalizePhone('call us!')).toBeNull();
    expect(normalizePhone('12')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it('rejects a number that is the right shape but not a real number', () => {
    // Correct digit count for NANP, invalid area code.
    expect(normalizePhone('+1 111 111 1111')).toBeNull();
  });
});

describe('isValidE164', () => {
  it('accepts a real number and rejects malformed ones', () => {
    expect(isValidE164('+14155550132')).toBe(true);
    expect(isValidE164('4155550132')).toBe(false);
    expect(isValidE164('+0155550132')).toBe(false);
    expect(isValidE164(null)).toBe(false);
  });
});

describe('maskPhone', () => {
  it('keeps enough to recognise, not enough to dial', () => {
    expect(maskPhone('+14155550132')).toBe('+14***32');
    expect(maskPhone('123')).toBe('***');
    expect(maskPhone(null)).toBeNull();
  });
});

describe('isBlockedNumber', () => {
  it('blocks premium-rate and fictional ranges', () => {
    expect(isBlockedNumber('+19005550100')).toBe(true);
    expect(isBlockedNumber('+14155550100')).toBe(true); // 555-01xx fictional
    expect(isBlockedNumber('+14155551234')).toBe(false);
  });
});

describe('dedupeByPhone', () => {
  it('keeps one entry per number and drops entries with none', () => {
    const items = [
      { phoneE164: '+14155550132', name: 'a' },
      { phoneE164: '+14155550132', name: 'b' },
      { phoneE164: null, name: 'c' },
      { phoneE164: '+14155550199', name: 'd' },
    ];
    expect(dedupeByPhone(items).map((i) => i.name)).toEqual(['a', 'd']);
  });
});

describe('businessNameKey', () => {
  it('collapses legal suffixes and punctuation so sources match', () => {
    expect(businessNameKey('FixLab Ltd.')).toBe(businessNameKey('fixlab'));
    expect(businessNameKey('The Phone Clinic')).toBe(businessNameKey('Phone Clinic'));
  });
});
