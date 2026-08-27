import { describe, it } from 'node:test';
import * as assert from 'node:assert';

describe('CallAction Prechecks', () => {
  it('should redact phone-like numbers from engineer notes', () => {
    const phoneLikeRegex = /(?:\+?\d[\d\s\-\.\(\)]{5,}\d)/g;
    const redact = (text: string) => text.replace(phoneLikeRegex, '[phone-redacted]');
    
    const rawNotes = "I am at 555-0199 and my secret is 1234. Call +1 (202) 555-0123.";
    const safeNotes = redact(rawNotes);
    
    assert.ok(safeNotes.includes('[phone-redacted]'), 'Should replace phone-like formats');
    assert.ok(!safeNotes.includes('555-0199'), 'Should not contain raw phone number');
  });

  it('should validate strict E.164 phone numbers', () => {
    const isValid = (p: string) => /^\+[1-9]\d{7,14}$/.test(p);
    
    assert.strictEqual(isValid('+12025550123'), true);
    assert.strictEqual(isValid('+442079460958'), true);
    assert.strictEqual(isValid('+012025550123'), false, 'Should reject +0');
    assert.strictEqual(isValid('12025550123'), false, 'Should reject missing +');
    assert.strictEqual(isValid('+1 (202) 555-0123'), false, 'Should reject formatting chars');
  });
});