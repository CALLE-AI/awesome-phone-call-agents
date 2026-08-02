import { describe, it, expect } from 'vitest';
import { maskPhone, redactDeep } from '../lib/redact.js';

describe('maskPhone', () => {
  it('keeps the country code and last two digits', () => {
    expect(maskPhone('+15550123456')).toBe('+1******3456');
  });

  it('leaves a non-phone string untouched', () => {
    expect(maskPhone('hello')).toBe('hello');
  });

  it('handles a short number without throwing', () => {
    expect(maskPhone('+1234')).toBe('+1***');
  });

  it('masks grouped and parenthesized international formats', () => {
    expect(maskPhone('Call +1 (555) 012-3456 tomorrow.')).toBe('Call +1******3456 tomorrow.');
    expect(maskPhone('+44 20 7946 0958')).toBe('+4*******0958');
  });

  it('masks domestic formats with and without separators', () => {
    expect(maskPhone('5550123456')).toBe('******3456');
    expect(maskPhone('(555) 012-3456')).toBe('******3456');
    expect(maskPhone('555-012-3456')).toBe('******3456');
  });

  it('does not mask short digit runs that are not phone numbers', () => {
    expect(maskPhone('order 12345')).toBe('order 12345');
    expect(maskPhone('offset 42 seconds')).toBe('offset 42 seconds');
  });
});

describe('redactDeep', () => {
  it('masks phones nested in objects and arrays', () => {
    const input = { recipients: [{ phones: ['+15550123456'] }] };
    expect(redactDeep(input)).toEqual({ recipients: [{ phones: ['+1******3456'] }] });
  });

  it('redacts credential-bearing keys', () => {
    expect(redactDeep({ apiKey: 'calle_live_secret' })).toEqual({ apiKey: '[redacted]' });
    expect(redactDeep({ authorization: 'Bearer x' })).toEqual({ authorization: '[redacted]' });
  });

  it('masks a phone embedded in free text', () => {
    expect(redactDeep({ summary: 'Called +15550123456 today.' }))
      .toEqual({ summary: 'Called +1******3456 today.' });
  });

  it('returns primitives unchanged', () => {
    expect(redactDeep(42)).toBe(42);
    expect(redactDeep(null)).toBe(null);
  });
});
