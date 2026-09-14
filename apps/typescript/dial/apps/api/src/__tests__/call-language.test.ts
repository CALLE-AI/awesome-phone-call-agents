import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { tasks } from '@dial/database';
import {
  createHarness,
  signUp,
  createTask,
  getTaskDetail,
  stubDiscovery,
  stubInterpreter,
  candidate,
  REPAIR_TASK,
  type Harness,
} from './harness.js';

/**
 * Choosing which language Dial speaks on a call.
 *
 * Asked at the end of the search rather than the start, because that is the
 * first moment the country is known -- and the country is the whole basis of
 * the recommendation. Asking sooner would mean recommending the language of
 * wherever the user happens to be rather than wherever Dial is calling.
 */

let h: Harness;
afterEach(async () => {
  await h?.close();
});

const DUBAI = {
  latitude: 25.2048,
  longitude: 55.2708,
  label: 'Dubai, United Arab Emirates',
  countryCode: 'AE',
  addressType: 'city',
  spanKm: 90,
};

const DUBLIN = {
  latitude: 53.3498,
  longitude: -6.2603,
  label: 'Dublin, Ireland',
  countryCode: 'IE',
  addressType: 'city',
  spanKm: 20,
};

function taskInPlace(raw: string) {
  return stubInterpreter(() => ({
    task: {
      ...REPAIR_TASK,
      location: { raw, latitude: null, longitude: null, label: null, radiusKm: 10 },
    },
    callFamily: 'repair_quote' as const,
  }));
}

function harnessFor(geocode: typeof DUBAI) {
  return createHarness({
    interpreter: taskInPlace(geocode.label),
    discovery: stubDiscovery({
      candidates: [candidate({ id: 'x1', name: 'Fix It', phoneE164: '+97142345678' })],
      geocode,
    }),
  });
}

async function answer(h: Harness, token: string, id: string, text: string) {
  return h.app.inject({
    method: 'POST',
    url: `/api/tasks/${id}/answers`,
    headers: { authorization: `Bearer ${token}` },
    payload: { answers: [{ id: 'call_language', answer: text }] },
  });
}

describe('the call language question', () => {
  it('asks once the country is known, recommending that country’s language', async () => {
    h = await harnessFor(DUBAI);
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop in Dubai');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.state).toBe('needs_user_input');

    const question = detail.clarifyingQuestions[0];
    expect(question.id).toBe('call_language');
    // The country's own language leads, and is the one marked.
    expect(question.options[0]).toBe('Arabic — العربية (recommended)');
    expect(question.options).toContain('English');
    expect(question.why).toMatch(/Arabic is the main language/i);

    // Nothing was dialled while the question was outstanding.
    expect(detail.calls).toHaveLength(0);
  });

  it('does not ask when the local language is already the saved one', async () => {
    // Nothing to decide, so a question would be pure friction.
    h = await harnessFor(DUBLIN);
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop in Dublin');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.state).not.toBe('needs_user_input');
    expect(detail.clarifyingQuestions).toHaveLength(0);
    // It still says which language it will speak.
    expect(detail.events.map((e: any) => e.message).join(' ')).toMatch(/Calling in English/i);
    expect(detail.calls.length).toBeGreaterThan(0);
  });

  it('uses the language the user picked', async () => {
    h = await harnessFor(DUBAI);
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop in Dubai');
    await h.runner.drain();

    const response = await answer(h, token, created.id, 'Arabic — العربية (recommended)');
    expect(response.statusCode).toBe(200);
    await h.runner.drain();

    const [row] = await h.handle.db.select().from(tasks).where(eq(tasks.id, created.id));
    expect(row?.callLanguage).toBe('ar');

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.calls.length).toBeGreaterThan(0);
  });

  it('accepts a language that was never offered', async () => {
    h = await harnessFor(DUBAI);
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop in Dubai');
    await h.runner.drain();

    await answer(h, token, created.id, 'French');
    await h.runner.drain();

    const [row] = await h.handle.db.select().from(tasks).where(eq(tasks.id, created.id));
    expect(row?.callLanguage).toBe('fr');
  });

  it('keeps the saved language when the answer means nothing', async () => {
    // Better to speak the language the user already chose than to open a call
    // in one nobody asked for.
    h = await harnessFor(DUBAI);
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop in Dubai');
    await h.runner.drain();

    await answer(h, token, created.id, 'whatever you think is best');
    await h.runner.drain();

    const [row] = await h.handle.db.select().from(tasks).where(eq(tasks.id, created.id));
    expect(row?.callLanguage).toBeNull();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.state).not.toBe('needs_user_input');
    expect(detail.calls.length).toBeGreaterThan(0);
  });

  it('does not redo the search just to answer a language question', async () => {
    // The answer changes how the calls are spoken, not who is called. Resuming
    // at interpretation would spend a model call and a directory search to
    // reach a conclusion already reached.
    h = await harnessFor(DUBAI);
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop in Dubai');
    await h.runner.drain();

    const before = await getTaskDetail(h, token, created.id);
    const discoveredBefore = before.candidates.length;

    await answer(h, token, created.id, 'English');
    await h.runner.drain();

    const after = await getTaskDetail(h, token, created.id);
    expect(after.candidates.length).toBe(discoveredBefore);
    // The search results survived the round trip rather than being rebuilt.
    expect(after.interpreted).toBeTruthy();
    expect(after.calls.length).toBeGreaterThan(0);
  });

  it('does not ask again once answered', async () => {
    h = await harnessFor(DUBAI);
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop in Dubai');
    await h.runner.drain();

    await answer(h, token, created.id, 'English');
    await h.runner.drain();
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.state).not.toBe('needs_user_input');
    expect(detail.clarifyingQuestions).toHaveLength(0);
  });
});
