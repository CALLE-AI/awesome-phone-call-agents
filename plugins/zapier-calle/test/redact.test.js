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
