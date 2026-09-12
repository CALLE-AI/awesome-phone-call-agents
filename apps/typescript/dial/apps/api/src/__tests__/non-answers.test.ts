import { describe, it, expect, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { deriveDisposition } from '@dial/orchestrator';
import { getCallFamily } from '@dial/schemas';
import type { CallProvider, ProviderCallSnapshot } from '@dial/calle';
import {
  createHarness,
  signUp,
  createTask,
  getTaskDetail,
  stubDiscovery,
  candidate,
  type Harness,
} from './harness.js';

/**
 * A call that got no answer must never be filed as one that did.
 *
 * From two real calls to Paris bakeries. One recipient said only "Oui, Allô ?"
 * and the line ended; the other said "au revoir". CALL-E reported both
 * accurately -- `question_answered: "no"` -- and Dial recorded both as
 * `answered_useful`, counted them towards the comparison, and would have been
 * willing to present "Oui, Allô ?" as a verified result.
 *
 * The cause was one line reasoning that "an explicit no is a real answer". It
 * is -- for `can_repair: "no"`, which tells the user this shop cannot help. It
 * is the exact opposite for `question_answered: "no"`, which says nothing was
 * learned at all.
 */

let h: Harness;
afterEach(async () => {
  await h?.close();
});

function snap(structuredResult: Record<string, unknown>): ProviderCallSnapshot {
  return {
    providerCallId: 'c1',
    status: 'completed',
    structuredResult,
    summary: null,
    taskCompleted: false,
    completionConfidence: null,
    evidence: [],
    attempts: [],
    failureCode: null,
    failureMessage: null,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
}

describe('deriveDisposition', () => {
  it('treats "we could not get an answer" as exactly that', () => {
    // The real payload from the Paris call.
    const result = { question_answered: 'no', evidence_summary: 'They said: “Oui, Allô ?”' };
    expect(deriveDisposition(snap(result), result, 'question_answered', true)).toBe(
      'answered_no_answer_to_question',
    );
  });

  it('still treats "this shop cannot help" as a real answer', () => {
    // Nothing about the fix may swallow a genuine no. Learning that a shop
    // cannot do the repair is learning something.
    const result = { can_repair: 'no' };
    expect(deriveDisposition(snap(result), result, 'can_repair', false)).toBe('answered_useful');
  });

  it('records a refusal as a refusal', () => {
    const result = { question_answered: 'no', refused_reason: 'Only takes enquiries online' };
    expect(deriveDisposition(snap(result), result, 'question_answered', true)).toBe('refused');
  });

  it('is unchanged for a yes', () => {
    for (const [field, value] of [
      ['question_answered', 'yes'],
      ['can_repair', 'yes'],
      ['availability', 'available'],
    ] as const) {
      const result = { [field]: value };
      expect(deriveDisposition(snap(result), result, field, true), field).toBe('answered_useful');
    }
  });

  it('still returns needs_review when nothing parseable came back', () => {
    expect(deriveDisposition(snap({}), null, 'question_answered', true)).toBe('needs_review');
  });
});

describe('the families that ask whether an answer was obtained', () => {
  it('are marked, and the ones asking whether help is possible are not', () => {
    // Getting this backwards is the whole bug, so it is asserted per family
    // rather than inferred.
    expect(getCallFamily('general_inquiry').viabilityAsksWhetherAnswered).toBe(true);
    expect(getCallFamily('status_check').viabilityAsksWhetherAnswered).toBe(true);

    for (const id of ['repair_quote', 'service_quote', 'reservation', 'appointment'] as const) {
      expect(getCallFamily(id).viabilityAsksWhetherAnswered ?? false, id).toBe(false);
    }
  });
});

describe('a call where nobody actually answered the question', () => {
  const saysHelloThenNothing: CallProvider = {
    name: 'fake',
    placesRealCalls: false,
    async create(request) {
      return {
        ...snap({ question_answered: 'no', evidence_summary: 'They said: “Oui, Allô ?”' }),
        providerCallId: `p_${request.idempotencyKey.replace(/[^a-z0-9]/gi, '')}`,
      };
    },
    async get(id) {
      return { ...snap({ question_answered: 'no' }), providerCallId: id };
    },
  };

  it('does not count towards the comparison', async () => {
    h = await createHarness({
      provider: saysHelloThenNothing,
      env: { MAX_CALLS_PER_TASK: '2', MAX_CALLS_UNTIL_RESULT: '4', COMPARABLE_TARGET: '2' },
      discovery: stubDiscovery({
        candidates: Array.from({ length: 8 }, (_, i) =>
          candidate({ id: `b${i}`, name: `Bakery ${i}`, phoneE164: `+3314455660${i}` }),
        ),
      }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find croissants in Paris');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.result?.tally.comparable).toBe(0);
    // And because none of them counted, Dial kept trying rather than stopping
    // at two on the strength of two greetings.
    expect(detail.calls.length).toBeGreaterThan(2);
  });

  it('is never presented as a verified result', async () => {
    h = await createHarness({
      provider: saysHelloThenNothing,
      env: { MAX_CALLS_PER_TASK: '2', MAX_CALLS_UNTIL_RESULT: '2' },
      discovery: stubDiscovery({
        candidates: [candidate({ id: 'a', name: 'La Flânerie', phoneE164: '+33144556677' })],
      }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find croissants in Paris');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.result?.best).toBeNull();
    expect(detail.calls[0].disposition).toBe('answered_no_answer_to_question');
  });
});

describe('the stall safety net', () => {
  /** Never resolves, so the task genuinely is stuck. */
  const neverResolves: CallProvider = {
    name: 'fake',
    placesRealCalls: false,
    async create(request) {
      return {
        ...snap({}),
        providerCallId: `n_${request.idempotencyKey.replace(/[^a-z0-9]/gi, '')}`,
        status: 'in_progress',
        structuredResult: null,
        completedAt: null,
      };
    },
    async get(id) {
      return { ...snap({}), providerCallId: id, status: 'in_progress', structuredResult: null, completedAt: null };
    },
  };

  it('gives up on a task where nothing is happening', async () => {
    h = await createHarness({
      provider: neverResolves,
      env: { TASK_STALL_TIMEOUT_MS: '1', CALL_POLL_DELAY_MS: '60000' },
      discovery: stubDiscovery({
        candidates: [candidate({ id: 'a', name: 'Silent Bakery', phoneE164: '+33144556677' })],
      }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find croissants in Paris');
    await h.runner.drain();

    // Make every pending job due, including the safety net.
    await h.handle.db.execute(sql`UPDATE jobs SET run_at = now() WHERE state = 'pending'`);
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(['completed', 'partially_completed', 'failed']).toContain(detail.state);
  });

  it('does not give up on a task that is simply taking its turn', async () => {
    // Six businesses were once marked failed having never been dialled,
    // because the clock ran out while the queue worked through them properly.
    h = await createHarness({
      provider: neverResolves,
      env: { TASK_STALL_TIMEOUT_MS: '600000', CALL_POLL_DELAY_MS: '60000' },
      discovery: stubDiscovery({
        candidates: Array.from({ length: 6 }, (_, i) =>
          candidate({ id: `b${i}`, name: `Bakery ${i}`, phoneE164: `+3314455660${i}` }),
        ),
      }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find croissants in Paris');
    await h.runner.drain();

    // The net comes due, but the task has just been making progress.
    await h.handle.db.execute(
      sql`UPDATE jobs SET run_at = now() WHERE state = 'pending' AND kind = 'task.timeout'`,
    );
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(['completed', 'partially_completed', 'failed']).not.toContain(detail.state);
    // Nothing was written off as failed while it was still waiting its turn.
    expect(detail.calls.every((c: any) => c.failureCode !== 'timeout')).toBe(true);
  });
});
