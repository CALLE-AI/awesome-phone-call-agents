import { describe, it, expect, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import type { CallFamilyId } from '@dial/schemas';
import {
  createHarness,
  signUp,
  createTask,
  getTaskDetail,
  stubInterpreter,
  stubDiscovery,
  candidate,
  REPAIR_TASK,
  type Harness,
} from './harness.js';

/**
 * Requests that no phone call could ever satisfy.
 *
 * From a real run: "find dinosaur meat in Dubai". Every stage worked. The
 * request parsed, Dial asked four clarifying questions about it, discovered
 * ninety-one butchers, and began telephoning them. Nothing was broken except
 * that nobody had checked whether the thing exists.
 *
 * The cost of getting this wrong runs both ways, so both directions are
 * tested: refusing a real request is worse than searching and finding nothing.
 */

let h: Harness;
afterEach(async () => {
  await h?.close();
});

const DISCOVERY = stubDiscovery({
  candidates: [
    candidate({ id: 'a', name: 'A Butcher', phoneE164: '+97145551000' }),
    candidate({ id: 'b', name: 'Another Butcher', phoneE164: '+97145551001' }),
  ],
});

/** An interpreter that declares the request impossible, as Gemini now can. */
function refuses(reason: string) {
  return stubInterpreter(() => ({
    task: { ...REPAIR_TASK, impossibleReason: reason },
    callFamily: 'repair_quote' as CallFamilyId,
  }));
}

async function countCalls() {
  const rows = await h.handle.db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM calls`);
  return rows.rows[0]!.n;
}

describe('an impossible request', () => {
  it('is refused before anybody is telephoned', async () => {
    h = await createHarness({
      discovery: DISCOVERY,
      interpreter: refuses('Dinosaur meat does not exist, so no business could sell it.'),
    });
    const user = await signUp(h);
    const created = await createTask(h, user.token, 'find dinosaur meat in dubai');
    await h.runner.drain();

    const detail = await getTaskDetail(h, user.token, created.id);
    expect(detail.state).toBe('failed');
    // Not one number dialled, and no businesses discovered to dial.
    expect(await countCalls()).toBe(0);
    expect(detail.candidates).toHaveLength(0);
  });

  it('says why, in the words written about this request', async () => {
    h = await createHarness({
      discovery: DISCOVERY,
      interpreter: refuses('Dinosaur meat does not exist, so no business could sell it.'),
    });
    const user = await signUp(h);
    const created = await createTask(h, user.token, 'find dinosaur meat in dubai');
    await h.runner.drain();

    const detail = await getTaskDetail(h, user.token, created.id);
    const shown = JSON.stringify(detail);
    expect(shown).toContain('Dinosaur meat does not exist');
    // A code is not an explanation.
    expect(detail.headline ?? '').not.toMatch(/impossible_request/);
  });

  it('is refused before the intake questions are asked', async () => {
    // The original run asked four questions about dinosaur meat before doing
    // anything else. Being interrogated about a thing that cannot exist is
    // worse than being told plainly.
    h = await createHarness({
      discovery: DISCOVERY,
      interpreter: refuses('There are no businesses on Mars to telephone.'),
    });
    const user = await signUp(h);
    const created = await createTask(h, user.token, 'find a restaurant on planet mars');
    await h.runner.drain();

    const detail = await getTaskDetail(h, user.token, created.id);
    expect(detail.clarifyingQuestions).toHaveLength(0);
    expect(detail.state).toBe('failed');
  });

  it('does not stand in the way of a request that is merely unusual', async () => {
    // The expensive mistake in the other direction. Camel milk, taxidermy, a
    // 3am locksmith: all real, all findable. Searching and finding nothing is
    // an honest outcome; refusing to look is not.
    h = await createHarness({
      discovery: DISCOVERY,
      interpreter: stubInterpreter(() => ({
        task: { ...REPAIR_TASK, impossibleReason: null },
        callFamily: 'repair_quote' as CallFamilyId,
      })),
    });
    const user = await signUp(h);
    const created = await createTask(h, user.token, 'find somewhere selling camel milk');
    await h.runner.drain();

    const detail = await getTaskDetail(h, user.token, created.id);
    expect(detail.state).not.toBe('failed');
    expect(detail.candidates.length).toBeGreaterThan(0);
  });
});
