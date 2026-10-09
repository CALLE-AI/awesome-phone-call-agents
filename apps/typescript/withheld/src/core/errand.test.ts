import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadErrand } from './errand';

function base(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      path.resolve(process.cwd(), 'data/errands/clinic-referral.json'),
      'utf8',
    ),
  );
}

function withPerson(phone: string) {
  const raw = base();
  (raw.person as Record<string, unknown>).phone = phone;
  return loadErrand(raw);
}

describe('loading an errand file', () => {
  it('accepts the demo errand', () => {
    const loaded = loadErrand(base());
    expect(loaded.ok).toBe(true);
    expect(loaded.errors).toEqual([]);
  });

  it.each([
    ['020 7946 0321', 'a national format with spaces'],
    ['07700900456', 'a national format with a trunk zero'],
    ['442079460321', 'digits with no plus'],
    ['+44 7700 900456', 'E.164 spoiled by spaces'],
    ['+0442079460321', 'a country code starting with zero'],
    ['+44', 'far too short'],
  ])('refuses %s (%s)', (phone) => {
    const loaded = withPerson(phone);
    expect(loaded.ok).toBe(false);
    expect(loaded.errors.join(' ')).toMatch(/E\.164/);
  });

  it('names the field that was wrong, not just that something was', () => {
    const loaded = withPerson('020 7946 0321');
    expect(loaded.errors.join(' ')).toContain('person.phone');
  });

  it('refuses a window that ends before it starts', () => {
    const raw = base();
    raw.acceptable_windows = [
      { start: '2026-09-15T12:00:00Z', end: '2026-09-15T09:00:00Z' },
    ];
    const loaded = loadErrand(raw);

    expect(loaded.ok).toBe(false);
    expect(loaded.errors.join(' ')).toMatch(/ends before it starts/);
  });

  it('refuses a window that is not a date at all', () => {
    const raw = base();
    raw.acceptable_windows = [{ start: 'tuesday-ish', end: 'later' }];
    expect(loadErrand(raw).ok).toBe(false);
  });

  it('refuses an errand with no acceptable window, rather than assuming any time suits', () => {
    const raw = base();
    raw.acceptable_windows = [];
    expect(loadErrand(raw).ok).toBe(false);
  });

  it('refuses a budget that authorises a payment card, whatever the file says', () => {
    const raw = base();
    (raw.may_say as string[]).push(
      'the card on file is 4111 1111 1111 1111',
    );
    const loaded = loadErrand(raw);

    expect(loaded.ok).toBe(false);
    expect(loaded.findings.length).toBeGreaterThan(0);
    for (const f of loaded.findings) {
      expect(f.masked).not.toContain('4111111111111111');
    }
  });

  it('refuses a budget containing the person\u2019s own number', () => {
    const raw = base();
    (raw.may_say as string[]).push(
      'they can be reached on +447700900456',
    );
    const loaded = loadErrand(raw);

    expect(loaded.ok).toBe(false);
    expect(loaded.findings.some((f) => f.kind === 'phone_number')).toBe(true);
  });
});
