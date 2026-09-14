import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { runChain } from './chain';
import { FixtureProvider, foldStatus, normalizeTurns } from './calle';
import { loadErrand } from './errand';
import type { ErrandFile } from './types';

const FIXTURES = path.resolve(process.cwd(), 'fixtures/legs');
const NOW = new Date('2026-09-14T09:00:00Z');

function errand(): ErrandFile {
  const raw = JSON.parse(
    readFileSync(
      path.resolve(process.cwd(), 'data/errands/clinic-referral.json'),
      'utf8',
    ),
  );
  const loaded = loadErrand(raw);
  if (!loaded.ok) throw new Error(loaded.errors.join('; '));
  return loaded.errand!;
}

function chain(sequence: string[], e: ErrandFile = errand()) {
  return runChain({
    errand: e,
    provider: new FixtureProvider(FIXTURES, sequence),
    now: NOW,
  });
}

describe('runChain', () => {
  it('carries an errand across two legs without the person ever answering a phone', async () => {
    const state = await chain(['window-agreed', 'errand-complete']);

    expect(state.legs).toHaveLength(2);
    expect(state.legs[0].status).toBe('window_agreed');
    expect(state.legs[1].status).toBe('errand_complete');
    expect(state.halted_reason).toBeNull();
  });

  it('never discloses the number on any leg', async () => {
    const state = await chain(['window-agreed', 'errand-complete']);
    expect(state.legs.every((l) => !l.number_disclosed)).toBe(true);
  });

  it('reports no pending call once the errand is finished', async () => {
    const state = await chain(['window-agreed', 'errand-complete']);
    expect(state.next).toBeNull();
  });

  it('keeps the intent that caused a call even after that call has been made', async () => {
    const state = await chain(['window-agreed', 'not-terminal']);

    // Leg 2 was placed, so nothing is pending — but the record of why it was
    // placed, and which sentence justified it, survives.
    expect(state.next).toBeNull();
    expect(state.scheduled).toHaveLength(1);
    expect(state.scheduled[0].leg).toBe(2);
    expect(state.scheduled[0].supporting_turn).toMatch(/between ten and twelve/i);
  });

  it('stops rather than leak when the callee demands a number', async () => {
    const state = await chain(['number-demanded']);

    expect(state.legs).toHaveLength(1);
    expect(state.legs[0].number_requested_by_callee).toBe(true);
    expect(state.legs[0].number_disclosed).toBe(false);
    expect(state.halted_reason).toMatch(/rather than leaking it/i);
  });

  it('stops the chain immediately when a number does get out', async () => {
    const state = await chain(['number-leaked']);

    expect(state.legs).toHaveLength(1);
    expect(state.legs[0].number_disclosed).toBe(true);
    expect(state.halted_reason).toMatch(/outranks every other outcome/i);
  });

  it('does not treat a no-answer as a refusal', async () => {
    const state = await chain(['no-answer']);

    expect(state.legs[0].status).toBe('no_answer');
    expect(state.legs[0].agreed_window.start).toBeNull();
    expect(state.halted_reason).toMatch(/disposition, not a finding/i);
  });

  it('draws no verdict at all from a call CALL-E has not finished', async () => {
    const state = await chain(['not-terminal']);

    expect(state.legs[0].status).toBe('not_terminal');
    expect(state.legs[0].answers).toHaveLength(0);
    expect(state.legs[0].outside_may_say_findings).toHaveLength(0);
  });

  it('hands over to a human when the callee will not name any time', async () => {
    const state = await chain(['schedule-refused']);

    expect(state.legs[0].status).toBe('callback_refused_by_callee');
    expect(state.next).toBeNull();
  });

  it('refuses to schedule into a window the person never said they would accept', async () => {
    const narrowed: ErrandFile = {
      ...errand(),
      acceptable_windows: [
        { start: '2026-09-17T13:00:00Z', end: '2026-09-17T17:00:00Z' },
      ],
    };
    const state = await chain(['window-agreed'], narrowed);

    expect(state.legs[0].status).toBe('window_agreed');
    expect(state.next).not.toBeNull();
    expect(state.halted_reason).toMatch(/outside the times/i);
  });

  it('places no call at all when the script fails its own number gate', async () => {
    const leaky: ErrandFile = {
      ...errand(),
      may_say: [
        ...errand().may_say,
        'you can reach the patient on +447700900456',
      ],
    };
    const state = await chain(['errand-complete'], leaky);

    expect(state.legs).toHaveLength(0);
    expect(state.halted_reason).toMatch(/did not pass the number gate/i);
  });

  it('stops at the leg ceiling instead of calling forever', async () => {
    const state = await runChain({
      errand: errand(),
      provider: new FixtureProvider(FIXTURES, ['window-agreed']),
      now: NOW,
      maxLegs: 2,
    });

    expect(state.legs).toHaveLength(2);
    expect(state.halted_reason).toMatch(/leg ceiling/i);
  });
});

describe('foldStatus', () => {
  it('treats a completed call in which nobody spoke as a no-answer', () => {
    expect(
      foldStatus({
        call: 'completed',
        attempt: 'completed',
        failureCode: null,
        anyHumanSpeech: false,
      }),
    ).toBe('no_answer');
  });

  it('keeps a completed call with human speech as completed', () => {
    expect(
      foldStatus({
        call: 'completed',
        attempt: 'completed',
        failureCode: null,
        anyHumanSpeech: true,
      }),
    ).toBe('completed');
  });

  it('recovers a no-answer from the attempt failure code', () => {
    expect(
      foldStatus({
        call: 'failed',
        attempt: 'failed',
        failureCode: 'no_answer',
        anyHumanSpeech: false,
      }),
    ).toBe('no_answer');
  });

  it('treats voicemail as nobody answering, not as a conversation', () => {
    expect(
      foldStatus({
        call: 'completed',
        attempt: 'completed',
        failureCode: 'answering_machine',
        anyHumanSpeech: true,
      }),
    ).toBe('no_answer');
  });

  it('never invents a terminal status for a call still running', () => {
    expect(
      foldStatus({
        call: 'in_progress',
        attempt: 'dialing',
        failureCode: null,
        anyHumanSpeech: false,
      }),
    ).toBe('in_progress');
  });
});

describe('normalizeTurns', () => {
  it("maps CALL-E's bot and user labels onto caller and callee", () => {
    const turns = normalizeTurns([
      { speaker: 'bot', text: 'Good morning.', offset_seconds: 1 },
      { speaker: 'user', text: 'Riverside Clinic.', offset_seconds: 3 },
    ]);

    expect(turns).toEqual([
      { speaker: 'caller', text: 'Good morning.', at: 1 },
      { speaker: 'callee', text: 'Riverside Clinic.', at: 3 },
    ]);
  });

  it('leaves an unattributed turn unattributed instead of guessing a side', () => {
    const turns = normalizeTurns([{ speaker: 'unknown', text: 'Hold on.' }]);
    expect(turns[0].speaker).toBe('unknown');
  });

  it('drops empty turns rather than carrying blank evidence', () => {
    expect(normalizeTurns([{ speaker: 'user', text: '   ' }, null, 'x'])).toEqual(
      [],
    );
  });
});
