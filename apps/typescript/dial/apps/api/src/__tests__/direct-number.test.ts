import { describe, it, expect, afterEach } from 'vitest';
import { extractDialTargets } from '@dial/domain';
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
 * A number in the request answers the question the search stage exists to ask.
 *
 * "Call +971 55 550 1234 and ask about my order" needs no directory, no
 * geocoding and no location: there is nothing to find. Asking where to search
 * would be asking the user to repeat what they already said, in a worse form.
 */

let h: Harness;
afterEach(async () => {
  await h?.close();
});

/** No geocode and no businesses: if the search stage runs at all, it fails. */
function noDirectory() {
  return stubDiscovery({ candidates: [], geocode: null });
}

function instructionOnly() {
  return stubInterpreter(() => ({
    task: {
      ...REPAIR_TASK,
      // A purpose is stated so this stays about the number itself; what
      // Dial asks when one is missing has its own tests below.
      callPurpose: 'ask about my order',
      location: null,
    },
    callFamily: 'general_inquiry' as const,
  }));
}

/**
 * Answers the language question, which a foreign number triggers on the way
 * through. Returns the detail once the task has moved past it.
 */
async function settleLanguage(h: Harness, token: string, id: string) {
  const detail = await getTaskDetail(h, token, id);
  if (detail.state !== 'needs_user_input') return detail;
  await h.app.inject({
    method: 'POST',
    url: `/api/tasks/${id}/answers`,
    headers: { authorization: `Bearer ${token}` },
    payload: { answers: [{ id: 'call_language', answer: 'English' }] },
  });
  await h.runner.drain();
  return getTaskDetail(h, token, id);
}

describe('extractDialTargets', () => {
  it('finds a number written in international form', () => {
    const [found] = extractDialTargets('call +971 55 550 1234 and ask about my order');
    expect(found?.e164).toBe('+971555501234');
    expect(found?.country).toBe('AE');
    // Kept as written, so it can be shown back the way the user typed it.
    expect(found?.raw).toBe('+971 55 550 1234');
  });

  it('reads a national number against a country hint', () => {
    expect(extractDialTargets('please ring 055 550 1234 for me', 'AE')[0]?.e164).toBe(
      '+971555501234',
    );
    expect(extractDialTargets('ring 01 555 0100 and book a table', 'IE')[0]?.e164).toBe(
      '+35315550100',
    );
  });

  it('does not mistake ordinary numbers in a request for a phone number', () => {
    // The dangerous failure: ringing a price or an order number.
    for (const text of [
      'find the cheapest iPhone 13 screen repair near me',
      'get me a quote around 2820 dirhams',
      'my order number is 12345678, check it',
      'book a table for 4 people at 7pm',
      'repair costs 1500 to 3000',
    ]) {
      expect(extractDialTargets(text, 'AE'), text).toHaveLength(0);
    }
  });

  it('refuses an emergency number', () => {
    // The policy layer blocks these too; not extracting them means the task
    // never gets far enough to need blocking.
    expect(extractDialTargets('call 999 now')).toHaveLength(0);
    expect(extractDialTargets('call +44 999')).toHaveLength(0);
  });

  it('has nothing to say about an empty request', () => {
    expect(extractDialTargets('')).toHaveLength(0);
    expect(extractDialTargets(null)).toHaveLength(0);
  });
});

describe('a request naming a number', () => {
  it('never asks where to search', async () => {
    h = await createHarness({ interpreter: instructionOnly(), discovery: noDirectory() });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'call +971 55 550 1234 and ask about my order');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    const rendered = JSON.stringify(detail);

    // It may still ask which language to speak; what it must never ask is
    // where to look, when the request said exactly who to ring.
    expect(rendered).not.toMatch(/where should Dial search|postcode|town or city/i);
    expect(detail.clarificationQuestion ?? '').not.toMatch(/where/i);
  });

  it('rings that number, having searched for nothing', async () => {
    h = await createHarness({ interpreter: instructionOnly(), discovery: noDirectory() });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'call +971 55 550 1234 and ask about my order');
    await h.runner.drain();

    const detail = await settleLanguage(h, token, created.id);
    expect(detail.directPhone).toBe('+971555501234');
    expect(detail.calls).toHaveLength(1);
    // The masked form still ends in the right digits.
    expect(detail.calls[0].phoneMasked).toMatch(/34$/);
    // Exactly one candidate, and it is not pretending to be a business.
    expect(detail.candidates).toHaveLength(1);
    expect(detail.candidates[0].candidate.name).toBe('The number you gave');
    expect(detail.candidates[0].candidate.source).toBe('user_supplied');
  });

  it('still searches normally when no number was given', async () => {
    // The shortcut must not swallow the ordinary path.
    h = await createHarness({
      discovery: stubDiscovery({
        candidates: [candidate({ id: 'a', name: 'FixLab', phoneE164: '+35315550100' })],
      }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop in Dublin 2');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.directPhone).toBeNull();
    expect(detail.candidates[0].candidate.name).toBe('FixLab');
  });
});

describe('keeping the number', () => {
  async function taskWithNumber(h: Harness, token: string) {
    const created = await createTask(h, token, 'call +971 55 550 1234 about my order');
    await h.runner.drain();
    return created.id;
  }

  it('offers to save a number that is not kept yet', async () => {
    h = await createHarness({ interpreter: instructionOnly(), discovery: noDirectory() });
    const { token } = await signUp(h);
    const id = await taskWithNumber(h, token);

    const detail = await getTaskDetail(h, token, id);
    expect(detail.directPhone).toBe('+971555501234');
    expect(detail.directPhoneSaved).toBe(false);
  });

  it('saves the number from the task, without it travelling back and forth', async () => {
    h = await createHarness({ interpreter: instructionOnly(), discovery: noDirectory() });
    const { token } = await signUp(h);
    const id = await taskWithNumber(h, token);

    const saved = await h.app.inject({
      method: 'POST',
      url: '/api/contacts',
      headers: { authorization: `Bearer ${token}` },
      payload: { taskId: id, name: 'Ahmed at the garage' },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().phoneE164).toBe('+971555501234');

    // The task now knows it is kept, so the UI stops offering.
    const detail = await getTaskDetail(h, token, id);
    expect(detail.directPhoneSaved).toBe(true);
  });

  it('renames rather than duplicating when the number is saved again', async () => {
    h = await createHarness({ interpreter: instructionOnly(), discovery: noDirectory() });
    const { token } = await signUp(h);
    const id = await taskWithNumber(h, token);
    const auth = { authorization: `Bearer ${token}` };

    for (const name of ['Garage', 'Ahmed at the garage']) {
      await h.app.inject({ method: 'POST', url: '/api/contacts', headers: auth, payload: { taskId: id, name } });
    }

    const list = await h.app.inject({ method: 'GET', url: '/api/contacts', headers: auth });
    expect(list.json().contacts).toHaveLength(1);
    expect(list.json().contacts[0].name).toBe('Ahmed at the garage');
  });

  it('uses the saved name when that number is called again', async () => {
    h = await createHarness({ interpreter: instructionOnly(), discovery: noDirectory() });
    const { token } = await signUp(h);
    const auth = { authorization: `Bearer ${token}` };

    await h.app.inject({
      method: 'POST',
      url: '/api/contacts',
      headers: auth,
      payload: { phone: '+971555501234', name: 'Ahmed at the garage' },
    });

    const created = await createTask(h, token, 'call +971 55 550 1234 about my order');
    await h.runner.drain();

    const detail = await settleLanguage(h, token, created.id);
    // Named, rather than described as an anonymous number.
    expect(detail.candidates[0].candidate.name).toBe('Ahmed at the garage');
    expect(detail.calls[0].businessName).toBe('Ahmed at the garage');
  });

  it('renames and deletes a contact', async () => {
    h = await createHarness({ interpreter: instructionOnly(), discovery: noDirectory() });
    const { token } = await signUp(h);
    const auth = { authorization: `Bearer ${token}` };

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/contacts',
      headers: auth,
      payload: { phone: '+35315550100', name: 'The place' },
    });
    const contactId = created.json().id;

    const renamed = await h.app.inject({
      method: 'PATCH',
      url: `/api/contacts/${contactId}`,
      headers: auth,
      payload: { name: 'Dublin bakery' },
    });
    expect(renamed.json().name).toBe('Dublin bakery');

    const removed = await h.app.inject({
      method: 'DELETE',
      url: `/api/contacts/${contactId}`,
      headers: auth,
    });
    expect(removed.statusCode).toBe(200);

    const list = await h.app.inject({ method: 'GET', url: '/api/contacts', headers: auth });
    expect(list.json().contacts).toHaveLength(0);
  });

  it('will not store a number Dial refuses to dial', async () => {
    h = await createHarness({ interpreter: instructionOnly(), discovery: noDirectory() });
    const { token } = await signUp(h);
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/contacts',
      headers: { authorization: `Bearer ${token}` },
      payload: { phone: '999', name: 'Emergency' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('keeps one user’s contacts away from another’s', async () => {
    h = await createHarness({ interpreter: instructionOnly(), discovery: noDirectory() });
    const owner = await signUp(h);
    const stranger = await signUp(h, 'stranger@example.com');

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/contacts',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { phone: '+35315550100', name: 'Mine' },
    });
    const contactId = created.json().id;

    for (const [method, payload] of [
      ['PATCH', { name: 'Theirs' }],
      ['DELETE', undefined],
    ] as const) {
      const response = await h.app.inject({
        method,
        url: `/api/contacts/${contactId}`,
        headers: { authorization: `Bearer ${stranger.token}` },
        ...(payload ? { payload } : {}),
      });
      expect(response.statusCode).toBe(404);
    }

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/contacts',
      headers: { authorization: `Bearer ${stranger.token}` },
    });
    expect(list.json().contacts).toHaveLength(0);
  });
});

describe('a request naming a person', () => {
  /** The interpreter recognises who to call but not what a business is. */
  function namesCallee(calleeName: string | null) {
    return stubInterpreter(() => ({
      task: {
        ...REPAIR_TASK,
        calleeName,
        // Stated, so these stay about finding the contact.
        callPurpose: 'ask whether there is ice cream',
        location: null,
      },
      callFamily: 'general_inquiry' as const,
    }));
  }

  it('rings the saved contact instead of asking where to search', async () => {
    // The reported case: "call malik and beg him to check if there is ice
    // cream", where Malik is a contact. Malik is not a place, and no city
    // would help Dial find him.
    h = await createHarness({ interpreter: namesCallee('Malik'), discovery: noDirectory() });
    const { token } = await signUp(h);
    const auth = { authorization: `Bearer ${token}` };

    await h.app.inject({
      method: 'POST',
      url: '/api/contacts',
      headers: auth,
      payload: { phone: '+35315550100', name: 'malik' },
    });

    const created = await createTask(h, token, 'call malik and beg him to check if there is ice cream');
    await h.runner.drain();
    const detail = await settleLanguage(h, token, created.id);

    expect(JSON.stringify(detail)).not.toMatch(/where should Dial search|postcode/i);
    expect(detail.calls).toHaveLength(1);
    expect(detail.calls[0].businessName).toBe('malik');
  });

  it('matches the contact however it is capitalised', async () => {
    h = await createHarness({ interpreter: namesCallee('MALIK'), discovery: noDirectory() });
    const { token } = await signUp(h);
    await h.app.inject({
      method: 'POST',
      url: '/api/contacts',
      headers: { authorization: `Bearer ${token}` },
      payload: { phone: '+35315550100', name: 'malik' },
    });

    const created = await createTask(h, token, 'call MALIK about the order');
    await h.runner.drain();
    const detail = await settleLanguage(h, token, created.id);
    expect(detail.directPhone).toBe('+35315550100');
  });

  it('says it has no number rather than asking for a city', async () => {
    // Nobody named Malik is saved. No search would find him, so asking where
    // to look is a question with no useful answer.
    h = await createHarness({ interpreter: namesCallee('Malik'), discovery: noDirectory() });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'call malik about the order');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.state).toBe('needs_user_input');
    expect(detail.clarificationQuestion).toMatch(/does not have a number for Malik/i);
    expect(detail.clarificationQuestion).not.toMatch(/where|postcode|city/i);
    expect(detail.calls).toHaveLength(0);
  });

  it('does not ask intake questions when it already knows who to ring', async () => {
    // Intake sharpens a search. There is no search.
    h = await createHarness({
      interpreter: namesCallee('Malik'),
      discovery: noDirectory(),
      questionGenerator: {
        name: 'stub',
        async generate() {
          return [
            { id: 'flavour', question: 'Which flavour?', why: null, options: [], required: false },
          ];
        },
      },
    });
    const { token } = await signUp(h);
    await h.app.inject({
      method: 'POST',
      url: '/api/contacts',
      headers: { authorization: `Bearer ${token}` },
      payload: { phone: '+35315550100', name: 'malik' },
    });

    const created = await createTask(h, token, 'call malik about ice cream');
    await h.runner.drain();
    const detail = await settleLanguage(h, token, created.id);

    expect(JSON.stringify(detail)).not.toMatch(/Which flavour/i);
    expect(detail.calls).toHaveLength(1);
  });
});

describe('what the call is for', () => {
  /**
   * Stands in for the interpreter reading the instruction each time round. A
   * purpose is only recognised once the user has actually given one, and vague
   * replies do not count -- which is the behaviour being tested.
   */
  function readsPurpose(calleeName: string | null) {
    return stubInterpreter((instruction: string) => {
      const vague = /(idk|dunno|whatever|you decide|just call|anything)/i.test(instruction);
      const detail = /Additional detail from the user: (.+)/.exec(instruction);
      const answered = detail?.[1]?.trim() ?? null;
      return {
        task: {
          ...REPAIR_TASK,
          calleeName,
          callPurpose: !vague && answered ? answered : null,
          location: null,
        },
        callFamily: 'general_inquiry' as const,
      };
    });
  }

  async function withContact(calleeName: string | null) {
    const harness = await createHarness({
      interpreter: readsPurpose(calleeName),
      discovery: noDirectory(),
    });
    const { token } = await signUp(harness);
    await harness.app.inject({
      method: 'POST',
      url: '/api/contacts',
      headers: { authorization: `Bearer ${token}` },
      payload: { phone: '+35315550100', name: 'malik' },
    });
    return { harness, token };
  }

  async function reply(h: Harness, token: string, id: string, answer: string) {
    await h.app.inject({
      method: 'POST',
      url: `/api/tasks/${id}/clarify`,
      headers: { authorization: `Bearer ${token}` },
      payload: { answer },
    });
    await h.runner.drain();
    return getTaskDetail(h, token, id);
  }

  it('asks what the user wants from that person', async () => {
    const { harness, token } = await withContact('Malik');
    h = harness;
    const created = await createTask(h, token, 'call malik');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.state).toBe('needs_user_input');
    expect(detail.clarificationQuestion).toBe('What do you want from Malik?');
    // Nobody was rung while Dial had nothing to say.
    expect(detail.calls).toHaveLength(0);
  });

  it('goes ahead once the answer says something', async () => {
    const { harness, token } = await withContact('Malik');
    h = harness;
    const created = await createTask(h, token, 'call malik');
    await h.runner.drain();

    let detail = await reply(h, token, created.id, 'ask if there is ice cream');
    if (detail.state === 'needs_user_input' && detail.clarifyingQuestions?.length) {
      detail = await settleLanguage(h, token, created.id);
    }
    expect(detail.interpreted.callPurpose).toMatch(/ice cream/i);
    expect(detail.calls).toHaveLength(1);
  });

  it('asks again when the answer says nothing', async () => {
    const { harness, token } = await withContact('Malik');
    h = harness;
    const created = await createTask(h, token, 'call malik');
    await h.runner.drain();

    const detail = await reply(h, token, created.id, 'idk');
    expect(detail.state).toBe('needs_user_input');
    // Worded differently, so the user can tell they were not understood.
    expect(detail.clarificationQuestion).toMatch(/still is not sure what to ask Malik/i);
    expect(detail.calls).toHaveLength(0);
  });

  it('stops asking rather than arguing about it', async () => {
    // Two questions is persistence. Holding the task hostage to a third is not.
    const { harness, token } = await withContact('Malik');
    h = harness;
    const created = await createTask(h, token, 'call malik');
    await h.runner.drain();

    await reply(h, token, created.id, 'idk');
    let detail = await reply(h, token, created.id, 'whatever');
    if (detail.state === 'needs_user_input' && detail.clarifyingQuestions?.length) {
      detail = await settleLanguage(h, token, created.id);
    }

    expect(detail.state).not.toBe('needs_user_input');
    expect(detail.events.map((e: any) => e.message).join(' ')).toMatch(/keep the call general/i);
    expect(detail.calls).toHaveLength(1);
  });

  it('does not ask when the request already said what it wants', async () => {
    // This one states a purpose from the outset, so nothing should be asked.
    h = await createHarness({
      interpreter: stubInterpreter(() => ({
        task: {
          ...REPAIR_TASK,
          calleeName: 'Malik',
          callPurpose: 'check whether there is ice cream',
          location: null,
        },
        callFamily: 'general_inquiry' as const,
      })),
      discovery: noDirectory(),
    });
    const fresh = await signUp(h);
    await h.app.inject({
      method: 'POST',
      url: '/api/contacts',
      headers: { authorization: `Bearer ${fresh.token}` },
      payload: { phone: '+35315550100', name: 'malik' },
    });

    const created = await createTask(h, fresh.token, 'call malik and check if there is ice cream');
    await h.runner.drain();
    const detail = await settleLanguage(h, fresh.token, created.id);

    expect(JSON.stringify(detail)).not.toMatch(/what do you want from/i);
    expect(detail.calls).toHaveLength(1);
  });

  it('does not ask for a purpose on an ordinary search', async () => {
    // "The cheapest screen repair" is both who to call and what to ask.
    h = await createHarness({
      discovery: stubDiscovery({
        candidates: [candidate({ id: 'a', name: 'FixLab', phoneE164: '+35315550100' })],
      }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find an iPhone repair shop in Dublin 2');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(JSON.stringify(detail)).not.toMatch(/what do you want from/i);
  });
});
