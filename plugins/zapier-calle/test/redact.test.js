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

  it('leaves identifiers containing long digit runs intact', () => {
    expect(maskPhone('evt_1754091234567')).toBe('evt_1754091234567');
    expect(maskPhone('call_20260802000000')).toBe('call_20260802000000');
    expect(maskPhone('provider_call_123')).toBe('provider_call_123');
  });

  it('still masks a standalone domestic number in surrounding text', () => {
    expect(maskPhone('Call 5550123456 back.')).toBe('Call ******3456 back.');
    expect(maskPhone('5550123456')).toBe('******3456');
  });

  it('hides a majority of digits for a mid-length international number', () => {
    // Previously only 2 of 7 digits were masked ('+5**0123'); the last-4 rule revealed too much
    // once the number was short enough that first+last4 covered most of it.
    expect(maskPhone('+5550123')).toBe('+*****23');
  });

  it('fully masks an international number with fewer than 4 digits', () => {
    // Previously these were validated as too short to mask and passed through raw.
    expect(maskPhone('+123')).toBe('+***');
    expect(maskPhone('+12')).toBe('+**');
  });

  it('masks bare digit runs longer than ten digits', () => {
    // Previously only exactly-10-digit bare runs were masked; anything longer (a country code
    // with no leading '+', e.g.) passed through raw.
    expect(maskPhone('15550123456')).not.toContain('15550123456');
    expect(maskPhone('845550123456')).not.toContain('845550123456');
    expect(maskPhone('my other number is 15550123456')).not.toContain('15550123456');
  });

  it('leaves bare digit runs outside the 10-15 digit phone range unmasked', () => {
    expect(maskPhone('123456789')).toBe('123456789');
    expect(maskPhone('1234567890123456')).toBe('1234567890123456');
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
