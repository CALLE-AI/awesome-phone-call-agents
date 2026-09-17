/**
 * Numbers that ship in the repository.
 *
 * Every phone number in a committed fixture or errand file will be read by
 * strangers, and some of them will run it. A plausible-looking number in a
 * sample is a real telephone that rings in someone's house, which is a
 * peculiar way for an app about not disclosing numbers to fail.
 *
 * These tests hold every committed number to a range the regulators have
 * guaranteed can never be allocated to a person.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/**
 * Ranges reserved for drama and documentation, and therefore never connected:
 *
 *   Ofcom, UK   07700 900000–900999   mobile
 *               020 7946 0000–0999    London landline
 *   NANP        (XXX) 555-0100–0199   North America
 */
const RESERVED = [
  /^\+44770090\d{4}$/,
  /^\+442079460\d{3}$/,
  /^\+1\d{3}555 ?01\d{2}$/,
];

function isReserved(e164: string): boolean {
  return RESERVED.some((r) => r.test(e164));
}

function jsonFiles(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));
}

const FILES = [...jsonFiles('data/errands'), ...jsonFiles('fixtures/legs')];

describe('numbers committed to the repository', () => {
  it('found files to check, so a passing run means something', () => {
    expect(FILES.length).toBeGreaterThan(5);
  });

  it.each(FILES)('uses only never-allocatable numbers in %s', (file) => {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    const found = text.match(/\+\d[\d\s().-]{6,20}/g) ?? [];

    for (const raw of found) {
      const e164 = `+${raw.replace(/\D+/g, '')}`;
      expect(
        isReserved(e164),
        `${file} contains ${e164}, which is not in a reserved range and may be a real telephone`,
      ).toBe(true);
    }
  });

  it('states the person\u2019s number in exactly one place', () => {
    const hits = FILES.filter((f) =>
      readFileSync(path.join(ROOT, f), 'utf8').includes('+447700900456'),
    );

    // The errand file is the only place it belongs. If a fixture ever needs it
    // written out in full, that fixture is staging a leak and should say so.
    expect(hits).toEqual(['data/errands/clinic-referral.json']);
  });
});
