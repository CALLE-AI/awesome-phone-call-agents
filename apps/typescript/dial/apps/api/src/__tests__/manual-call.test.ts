import { describe, it, expect, afterEach } from 'vitest';
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
 * Calling a business the user picked, after Dial has had its turn.
 *
 * Dial rings the ones it ranked highest. That is a judgement, and a judgement
 * can be wrong: the user sees the whole list and may know something the ranking
 * does not -- that they have dealt with one of them before, or that the shop
 * Dial skipped is the one across the road.
 */

let h: Harness;
afterEach(async () => {
  await h?.close();
});

/** More businesses than the per-task ceiling, so some are left uncalled. */
function manyBusinesses() {
  return stubDiscovery({
    candidates: [
      candidate({ id: 'a', name: 'First Choice', phoneE164: '+35315550100', distanceMeters: 100 }),
      candidate({ id: 'b', name: 'Second Choice', phoneE164: '+35315550101', distanceMeters: 200 }),
      candidate({ id: 'c', name: 'Third Choice', phoneE164: '+35315550102', distanceMeters: 300 }),
      candidate({ id: 'd', name: 'The One Nobody Rang', phoneE164: '+35315550103', distanceMeters: 4000 }),
      candidate({ id: 'e', name: 'No Phone Listed', phoneE164: null, distanceMeters: 500 }),
    ],
  });
}

/**
 * Both ceilings are pinned so Dial stops on its own and leaves somebody
 * uncalled -- otherwise it would keep ringing towards the comparison goal and
 * there would be nobody left for the user to pick.
 */
async function finishedTask(
  env: Record<string, string> = { MAX_CALLS_PER_TASK: '2', MAX_CALLS_UNTIL_RESULT: '2' },
) {
  const harness = await createHarness({ env, discovery: manyBusinesses() });
  const { token } = await signUp(harness);
  const created = await createTask(harness, token, 'Find an iPhone repair shop in Dublin 2');
  await harness.runner.drain();
  return { harness, token, id: created.id };
}

function callFor(detail: any, name: string) {
  return detail.calls.find((c: any) => c.businessName === name);
}

/**
 * Candidates are stored with generated ids, so the one to pick is found the
 * way the UI finds it: by looking at the list the task exposes.
 */
async function candidateIdFor(h: Harness, token: string, id: string, name: string) {
  const detail = await getTaskDetail(h, token, id);
  const entry = detail.candidates.find((c: any) => c.candidate.name === name);
  if (!entry) throw new Error(`no candidate named ${name}`);
  return entry.candidate.id as string;
}
async function pick(h: Harness, token: string, id: string, candidateId: string) {
  return h.app.inject({
    method: 'POST',
    url: `/api/tasks/${id}/call-candidate`,
    headers: { authorization: `Bearer ${token}` },
    payload: { candidateId },
  });
}

describe('choosing a business Dial did not call', () => {
  it('calls the one the user picked', async () => {
    const { harness, token, id } = await finishedTask();
    h = harness;

    const before = await getTaskDetail(h, token, id);
    expect(callFor(before, 'The One Nobody Rang')).toBeUndefined();

    const response = await pick(h, token, id, await candidateIdFor(h, token, id, 'The One Nobody Rang'));
    expect(response.statusCode).toBe(200);
    await h.runner.drain();

    const after = await getTaskDetail(h, token, id);
    expect(callFor(after, 'The One Nobody Rang')).toBeTruthy();
    // Said plainly in the timeline: this call was asked for, not chosen.
    expect(after.events.map((e: any) => e.message).join(' ')).toMatch(
      /You asked Dial to call The One Nobody Rang/i,
    );
  });

  it('goes past the per-task ceiling, because that bounds Dial, not the user', async () => {
    // The ceiling stops Dial working through twenty businesses on its own
    // initiative. It is not a limit on what the user may ask for.
    const { harness, token, id } = await finishedTask({
      MAX_CALLS_PER_TASK: '2',
      MAX_CALLS_UNTIL_RESULT: '2',
    });
    h = harness;

    const before = await getTaskDetail(h, token, id);
    expect(before.calls.length).toBeLessThanOrEqual(2);

    expect((await pick(h, token, id, await candidateIdFor(h, token, id, 'The One Nobody Rang'))).statusCode).toBe(200);
    await h.runner.drain();

    const after = await getTaskDetail(h, token, id);
    expect(after.calls.length).toBeGreaterThan(before.calls.length);
  });

  it('folds the new outcome into the comparison', async () => {
    // A result the user asked for has to count, or the answer still describes
    // only the calls Dial chose.
    const { harness, token, id } = await finishedTask();
    h = harness;

    await pick(h, token, id, await candidateIdFor(h, token, id, 'The One Nobody Rang'));
    await h.runner.drain();

    const after = await getTaskDetail(h, token, id);
    expect(['completed', 'partially_completed']).toContain(after.state);
    expect(after.result?.tally.contacted).toBe(after.calls.length);
  });

  it('refuses a business with no number Dial can dial', async () => {
    const { harness, token, id } = await finishedTask();
    h = harness;

    const response = await pick(h, token, id, await candidateIdFor(h, token, id, 'No Phone Listed'));
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('no_phone');
    expect(response.json().error.message).toMatch(/no number it can dial/i);
  });

  it('will not call the same business twice', async () => {
    const { harness, token, id } = await finishedTask();
    h = harness;

    expect((await pick(h, token, id, await candidateIdFor(h, token, id, 'The One Nobody Rang'))).statusCode).toBe(200);
    await h.runner.drain();

    const second = await pick(h, token, id, await candidateIdFor(h, token, id, 'The One Nobody Rang'));
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('already_called');
  });

  it('refuses a business belonging to another task', async () => {
    const { harness, token, id } = await finishedTask();
    h = harness;

    const response = await pick(h, token, id, 'not-a-candidate-of-this-task');
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('candidate_not_found');
  });

  it('refuses another user’s task', async () => {
    const { harness, id } = await finishedTask();
    h = harness;
    const stranger = await signUp(h, 'stranger@example.com');

    const response = await pick(h, stranger.token, id, 'any-candidate-id');
    expect(response.statusCode).toBe(404);
  });

  it('still respects the daily budget', async () => {
    // The ceiling is about Dial's autonomy; this one is about real money.
    const { harness, token, id } = await finishedTask({
      MAX_CALLS_PER_TASK: '2',
      MAX_CALLS_UNTIL_RESULT: '2',
      MAX_CALLS_PER_USER_PER_DAY: '2',
    });
    h = harness;

    const response = await pick(h, token, id, await candidateIdFor(h, token, id, 'The One Nobody Rang'));
    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('budget_exhausted');
    expect(response.json().error.message).toMatch(/today's limit/i);
  });

  it('still respects a policy that forbids calling', async () => {
    const { harness, token, id } = await finishedTask();
    h = harness;

    await h.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { policy: { phoneInquiries: 'never' } },
    });

    const response = await pick(h, token, id, await candidateIdFor(h, token, id, 'The One Nobody Rang'));
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('not_authorized');
  });
});
