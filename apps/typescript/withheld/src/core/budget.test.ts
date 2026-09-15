import { describe, expect, it } from 'vitest';
import {
  containsNumber,
  expandSpokenDigits,
  findPhoneShaped,
  maskSecret,
  refusesCall,
  scanAgainstBudget,
  scanForNumbers,
  redactForDisplay,
  scanForProhibited,
} from './budget';

const PERSON = '+447700900456';

describe('the number gate', () => {
  it('catches the number written plainly', () => {
    expect(containsNumber('You can reach them on +447700900456.', PERSON)).toBe(true);
  });

  it('catches the number however it is punctuated', () => {
    expect(containsNumber('call 07700 900 456 any time', PERSON)).toBe(true);
    expect(containsNumber('try (07700) 900-456', PERSON)).toBe(true);
    expect(containsNumber('44-7700-900-456', PERSON)).toBe(true);
  });

  it('catches the number read aloud, which is how it would actually leak', () => {
    expect(
      containsNumber(
        'it is oh double seven oh oh nine oh oh four five six',
        PERSON,
      ),
    ).toBe(true);
  });

  it('catches "oh" for zero', () => {
    expect(
      containsNumber(
        'zero double seven zero zero nine zero zero four five six',
        PERSON,
      ),
    ).toBe(true);
  });

  it('expands "double" the way people say it', () => {
    expect(expandSpokenDigits('double seven one')).toBe('771');
    expect(expandSpokenDigits('triple four')).toBe('444');
  });

  it('does not mistake an ISO timestamp for a phone number', () => {
    expect(findPhoneShaped('the window is 2026-09-15T09:00:00Z')).toEqual([]);
  });

  it('does not mistake a clock time for a phone number', () => {
    expect(findPhoneShaped('between 10:30 and 12:00')).toEqual([]);
  });

  it('does not fire on an ordinary sentence', () => {
    expect(containsNumber('I can call you back on Tuesday morning.', PERSON)).toBe(
      false,
    );
  });

  it('refuses any phone-shaped text, not only the person"s own number', () => {
    const findings = scanForNumbers({
      text: 'you can also try 0788 999 111',
      personPhone: PERSON,
      where: 'caller_speech',
    });
    expect(findings).toHaveLength(1);
    expect(refusesCall(findings)).toBe(true);
  });
});

describe('masking', () => {
  it('never reproduces the secret it is reporting', () => {
    const masked = maskSecret('447700900456');
    expect(masked).not.toContain('7700900');
    expect(masked).not.toContain('900456');
    expect(masked.startsWith('44')).toBe(true);
    expect(masked.endsWith('56')).toBe(true);
  });
});

describe('categories refused outright', () => {
  it('refuses a payment card even if the budget lists it', () => {
    const findings = scanForProhibited(
      'the card is 4111 1111 1111 1111',
      'errand_file',
    );
    expect(findings.some((f) => f.kind === 'payment_card')).toBe(true);
    expect(refusesCall(findings)).toBe(true);
  });

  it('refuses credentials', () => {
    expect(
      scanForProhibited('the password is hunter2', 'script').some(
        (f) => f.kind === 'password',
      ),
    ).toBe(true);
  });

  it('refuses national identifiers', () => {
    expect(
      scanForProhibited('their national id is on file', 'script').some(
        (f) => f.kind === 'national_id',
      ),
    ).toBe(true);
  });
});

describe('the disclosure budget', () => {
  it('reports a personal detail the budget does not cover', () => {
    const findings = scanAgainstBudget(
      'She is deaf and also has a diabetes diagnosis.',
      ['the patient is Deaf and communicates in writing'],
      'caller_speech',
    );
    expect(findings.some((f) => f.masked.length > 0)).toBe(true);
    expect(findings.every((f) => f.kind === 'outside_may_say')).toBe(true);
  });

  it('stays quiet about a detail the budget does cover', () => {
    const findings = scanAgainstBudget(
      'The patient is deaf.',
      ['deaf'],
      'caller_speech',
    );
    expect(findings).toHaveLength(0);
  });

  it('masks its findings rather than quoting them', () => {
    const findings = scanAgainstBudget('the HIV result', [], 'caller_speech');
    expect(findings[0]?.masked).not.toBe('HIV');
  });
});

/**
 * The printer quotes answers and supporting turns straight out of the call, so
 * a leak the report is supposed to flag could otherwise be printed by the
 * report itself. A privacy report that quotes the leak is not a report.
 */
describe('redactForDisplay', () => {
  const phone = '+447700900123';

  it('leaves ordinary transcript text alone', () => {
    expect(redactForDisplay('Thursday at ten works', phone)).toBe(
      'Thursday at ten works',
    );
    expect(redactForDisplay('', phone)).toBe('');
  });

  it("masks the person's number and never prints it back", () => {
    const out = redactForDisplay('ring them on 07700 900123', phone);
    expect(out).toMatch(/redacted/);
    expect(out).not.toContain('900123');
    expect(out).not.toContain('07700');
  });

  it('masks it when spoken as words, which is how it would actually be said', () => {
    const out = redactForDisplay(
      'oh double seven double oh nine oh oh one two three',
      phone,
    );
    expect(out).toMatch(/the person's number/);
    expect(out).not.toContain('one two three');
  });

  it('masks any other phone-shaped run, not just the one it knows', () => {
    const out = redactForDisplay('try the ward on 020 7946 0321', phone);
    expect(out).toMatch(/phone-shaped/);
    expect(out).not.toContain('0321');
  });

  it('still redacts when no number is supplied, as on the crash path', () => {
    // The top-level error handler has no errand in scope, so it must fall back
    // to shape alone rather than printing the payload raw.
    expect(redactForDisplay('CALL-E returned HTTP 500', '')).toBe(
      'CALL-E returned HTTP 500',
    );
    expect(redactForDisplay('failed for 07700 900123', '')).toMatch(
      /phone-shaped/,
    );
  });
});
