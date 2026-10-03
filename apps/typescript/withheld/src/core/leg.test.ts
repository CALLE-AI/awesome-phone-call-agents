import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadErrand } from './errand';
import { runLeg } from './leg';
import type { CallStatus, LegResult, Turn } from './types';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = path.join(root, 'fixtures/legs');

interface Fixture {
  name: string;
  description: string;
  status: CallStatus;
  now: string;
  turns: Turn[];
  expect: Partial<LegResult>;
}

function loadFixture(file: string): Fixture {
  return JSON.parse(readFileSync(path.join(fixtureDir, file), 'utf8')) as Fixture;
}

const errandRaw = JSON.parse(
  readFileSync(path.join(root, 'data/errands/clinic-referral.json'), 'utf8'),
);

const loaded = loadErrand(errandRaw);

describe('the example errand file', () => {
  it('loads and passes its gates', () => {
    expect(loaded.errors).toEqual([]);
    expect(loaded.ok).toBe(true);
    expect(loaded.errand).not.toBeNull();
  });
});

const files = readdirSync(fixtureDir).filter((f) => f.endsWith('.json')).sort();

describe('every fixture replays to its expected verdict', () => {
  for (const file of files) {
    const fixture = loadFixture(file);

    it(`${fixture.name}: ${fixture.description}`, () => {
      const result = runLeg({
        errand: loaded.errand!,
        leg: 1,
        status: fixture.status,
        turns: fixture.turns,
        transcriptRef: `fixture:${fixture.name}`,
        now: new Date(fixture.now),
      });

      for (const [key, value] of Object.entries(fixture.expect)) {
        expect(result[key as keyof LegResult], `${fixture.name} → ${key}`).toEqual(
          value,
        );
      }
    });
  }
});

describe('the invariant', () => {
  it('holds across every fixture except the one built to break it', () => {
    for (const file of files) {
      const fixture = loadFixture(file);
      const result = runLeg({
        errand: loaded.errand!,
        leg: 1,
        status: fixture.status,
        turns: fixture.turns,
        transcriptRef: `fixture:${fixture.name}`,
        now: new Date(fixture.now),
      });

      if (fixture.name === 'number-leaked') {
        expect(result.number_disclosed).toBe(true);
        expect(result.next_action).toBe('needs_human');
      } else {
        expect(result.number_disclosed, fixture.name).toBe(false);
      }
    }
  });

  it('never reports a leak by quoting it', () => {
    const fixture = loadFixture('number-leaked.json');
    const result = runLeg({
      errand: loaded.errand!,
      leg: 1,
      status: fixture.status,
      turns: fixture.turns,
      transcriptRef: 'fixture:number-leaked',
      now: new Date(fixture.now),
    });

    const report = JSON.stringify(result.outside_may_say_findings);
    expect(report).not.toContain('712345678');
    expect(result.outside_may_say_findings.length).toBeGreaterThan(0);
  });

  it('a booked appointment does not excuse a leaked number', () => {
    const fixture = loadFixture('number-leaked.json');
    const result = runLeg({
      errand: loaded.errand!,
      leg: 1,
      status: fixture.status,
      turns: fixture.turns,
      transcriptRef: 'fixture:number-leaked',
      now: new Date(fixture.now),
    });

    expect(result.status).not.toBe('errand_complete');
    expect(result.status).not.toBe('window_agreed');
  });
});

describe('non-terminal calls', () => {
  it('yield no verdict even when the transcript looks complete', () => {
    const fixture = loadFixture('not-terminal.json');
    const result = runLeg({
      errand: loaded.errand!,
      leg: 1,
      status: fixture.status,
      turns: fixture.turns,
      transcriptRef: 'fixture:not-terminal',
      now: new Date(fixture.now),
    });

    expect(result.status).toBe('not_terminal');
    expect(result.agreed_window.start).toBeNull();
    expect(result.answers).toEqual([]);
    expect(result.outside_may_say_findings).toEqual([]);
  });
});
