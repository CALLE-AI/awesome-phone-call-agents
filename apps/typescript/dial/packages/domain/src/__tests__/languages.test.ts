import { describe, it, expect } from 'vitest';
import {
  primaryLanguageForCountry,
  languageOptions,
  describeLanguage,
  resolveLanguageAnswer,
  normalizeLanguageCode,
  englishNameOf,
  nativeNameOf,
} from '../languages.js';

/**
 * Choosing the language Dial speaks on a call.
 *
 * The data comes from ICU's likely-subtags rather than a table kept here, so
 * these tests pin the behaviour that matters -- the country's language is
 * offered first and marked -- without asserting a mapping that is not ours to
 * define.
 */

describe('primaryLanguageForCountry', () => {
  it('knows the language of the countries Dial has actually called', () => {
    expect(primaryLanguageForCountry('AE')).toBe('ar');
    expect(primaryLanguageForCountry('SA')).toBe('ar');
    expect(primaryLanguageForCountry('FR')).toBe('fr');
    expect(primaryLanguageForCountry('IE')).toBe('en');
    expect(primaryLanguageForCountry('FI')).toBe('fi');
  });

  it('accepts a lowercase or padded code', () => {
    expect(primaryLanguageForCountry('ae')).toBe('ar');
    expect(primaryLanguageForCountry('  Fr  ')).toBe('fr');
  });

  it('says nothing rather than guessing', () => {
    for (const value of [null, undefined, '', 'XXX', '1', 'United Arab Emirates']) {
      expect(primaryLanguageForCountry(value), String(value)).toBeNull();
    }
  });
});

describe('languageOptions', () => {
  it('puts the country’s language first and marks it', () => {
    const options = languageOptions('AE');
    expect(options[0]?.code).toBe('ar');
    expect(options[0]?.recommended).toBe(true);
    expect(options[0]?.englishName).toBe('Arabic');
    expect(options[0]?.nativeName).toBe('العربية');
  });

  it('always offers English as a way out', () => {
    expect(languageOptions('SA').map((o) => o.code)).toContain('en');
  });

  it('does not offer the same language twice', () => {
    // Ireland's language and the fallback are both English.
    const codes = languageOptions('IE', ['en', 'en-GB']).map((o) => o.code);
    expect(codes).toEqual([...new Set(codes)]);
    expect(codes[0]).toBe('en');
  });

  it('includes what the user chose last time, after the recommendation', () => {
    const codes = languageOptions('AE', ['fr']).map((o) => o.code);
    expect(codes[0]).toBe('ar');
    expect(codes).toContain('fr');
  });

  it('recommends nothing when the country is unknown', () => {
    // English is still offered, but never dressed up as a local recommendation.
    const options = languageOptions(null);
    expect(options.some((o) => o.recommended)).toBe(false);
    expect(options[0]?.code).toBe('en');
  });
});

describe('describeLanguage', () => {
  it('shows both names and flags the recommendation', () => {
    const [arabic] = languageOptions('AE');
    expect(describeLanguage(arabic!)).toBe('Arabic — العربية (recommended)');
  });

  it('does not repeat a name that is the same in both languages', () => {
    const english = languageOptions('IE')[0]!;
    expect(describeLanguage(english)).toBe('English (recommended)');
  });
});

describe('resolveLanguageAnswer', () => {
  it('reads back the label it offered', () => {
    expect(resolveLanguageAnswer('Arabic — العربية (recommended)', 'AE')).toBe('ar');
    expect(resolveLanguageAnswer('English', 'AE')).toBe('en');
  });

  it('accepts either name on its own', () => {
    expect(resolveLanguageAnswer('العربية', 'AE')).toBe('ar');
    expect(resolveLanguageAnswer('arabic', 'AE')).toBe('ar');
  });

  it('accepts a language typed that was never offered', () => {
    // The options are suggestions, not a closed list.
    expect(resolveLanguageAnswer('French', 'AE')).toBe('fr');
    expect(resolveLanguageAnswer('Japanese', 'AE')).toBe('ja');
  });

  it('accepts a bare code', () => {
    expect(resolveLanguageAnswer('fr', 'AE')).toBe('fr');
    expect(resolveLanguageAnswer('ar-AE', 'AE')).toBe('ar');
  });

  it('returns null for something it cannot place', () => {
    // The caller keeps the saved preference rather than opening a call in a
    // language nobody asked for.
    for (const answer of ['', '   ', 'asdkjhaskdjh', 'whatever you like']) {
      expect(resolveLanguageAnswer(answer, 'AE'), answer).toBeNull();
    }
  });
});

describe('normalizeLanguageCode', () => {
  it('reduces a tag to its language', () => {
    expect(normalizeLanguageCode('en-GB')).toBe('en');
    expect(normalizeLanguageCode('ar-AE')).toBe('ar');
    expect(normalizeLanguageCode('EN')).toBe('en');
  });

  it('rejects what is not a tag', () => {
    for (const value of [null, undefined, '', '   ', '!!']) {
      expect(normalizeLanguageCode(value), String(value)).toBeNull();
    }
  });
});

describe('language names', () => {
  it('falls back to the code rather than throwing', () => {
    expect(englishNameOf('zz')).toBeTruthy();
    expect(nativeNameOf('zz')).toBeTruthy();
  });
});
