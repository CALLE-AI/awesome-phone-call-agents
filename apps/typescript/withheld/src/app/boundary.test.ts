/**
 * The server/client boundary.
 *
 * The console masks the number on screen, which is worth nothing on its own: a
 * React server component serialises every prop it passes into the page as RSC
 * payload, so an errand handed to a client component whole would render as
 * `+4*********56` and read as `+447700900456` in view-source.
 *
 * That happened during development. These tests exist so it cannot happen
 * again quietly.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getErrand, runScenario } from './actions';
import { SCENARIOS } from './scenarios';
import { expandSpokenDigits } from '@/core/budget';

const REAL_PHONE: string = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), 'data/errands/clinic-referral.json'),
    'utf8',
  ),
).person.phone;

const DIGITS = REAL_PHONE.replace(/\D+/g, '');

function serialised(value: unknown): string {
  return JSON.stringify(value);
}

describe('the client boundary', () => {
  it('has a number worth protecting in the errand file to begin with', () => {
    expect(DIGITS.length).toBeGreaterThanOrEqual(9);
  });

  it('never ships the number to the browser', async () => {
    const payload = serialised(await getErrand());

    expect(payload).not.toContain(REAL_PHONE);
    expect(payload).not.toContain(DIGITS);
    expect(payload.replace(/\D+/g, '')).not.toContain(DIGITS.slice(-9));
  });

  it('still shows enough of it for a person to recognise their own number', async () => {
    const errand = await getErrand();

    expect(errand.person.phone_masked).toContain(DIGITS.slice(-2));
    expect(errand.person.phone_masked).toMatch(/\*{3,}/);
  });

  it('ships the things the console legitimately needs', async () => {
    const errand = await getErrand();

    expect(errand.person.name).toBeTruthy();
    expect(errand.callee.name).toBeTruthy();
    expect(errand.may_say.length).toBeGreaterThan(0);
    expect(errand.acceptable_windows.length).toBeGreaterThan(0);
  });

  it.each(SCENARIOS.map((s) => s.id))(
    'never ships the number in the result of scenario "%s"',
    async (id) => {
      const payload = serialised(await runScenario(id));

      expect(payload).not.toContain(REAL_PHONE);
      expect(payload).not.toContain(DIGITS);
    },
  );

  it('carries no errand file on the result at all', async () => {
    const result = await runScenario('happy');
    expect(result).not.toHaveProperty('errand');
  });

  it('reports that it placed no real calls', async () => {
    const result = await runScenario('happy');
    expect(result.placedRealCalls).toBe(false);
  });
});

describe('the leaked-number scenario', () => {
  it('is the one place a number appears, and it is masked even there', async () => {
    const result = await runScenario('leaked');
    const leg = result.state.legs[0];

    expect(leg.number_disclosed).toBe(true);

    const findings = leg.outside_may_say_findings.filter(
      (v) => v.kind === 'phone_number',
    );
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.masked).not.toContain(DIGITS);
      expect(f.masked).toMatch(/\*{3,}/);
    }
  });

  it('leaves the spoken number in the transcript, because that is what was said', async () => {
    const result = await runScenario('leaked');
    const spoken = result.transcripts[0].turns.map((t) => t.text).join(' ');

    // The number is read out in words — "zero seven one two…" — which is how a
    // number actually leaks on a phone call, and why the detector expands
    // spoken digits before looking. The transcript is evidence and is never
    // edited: the *report* is masked, the record of what was said is not, or
    // the leak could never be investigated.
    expect(expandSpokenDigits(spoken).replace(/\D+/g, '')).toContain(
      DIGITS.slice(-9),
    );
  });
});
