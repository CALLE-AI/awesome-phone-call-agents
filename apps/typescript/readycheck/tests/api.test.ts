import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { Store } from '../server/store';
import { parseCallResult } from '../server/calle';
import { defaultTask } from '../src/domain/templates';
import type { CaseRecord } from '../src/domain/model';

async function harness() {
  const store = new Store(':memory:');
  let liveCalls = 0;
  const { app, service } = createApp({
    store,
    origin: 'http://readycheck.test',
    transport: {
      create: async () => {
        liveCalls++;
        throw Error('A sample must never dispatch');
      },
      read: async () => ({}),
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  function client() {
    let cookie = '',
      csrf = '';
    return {
      async request(
        path: string,
        method = 'GET',
        body?: unknown,
        headers: Record<string, string> = {},
      ) {
        const response = await fetch(url + path, {
          method,
          headers: {
            cookie,
            origin: 'http://readycheck.test',
            'content-type': 'application/json',
            'x-csrf-token': csrf,
            ...headers,
          },
          body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
        });
        const next = response.headers.get('set-cookie');
        if (next) cookie = next.split(';')[0];
        const isJson = response.headers.get('content-type')?.includes('json');
        const data = isJson ? await response.json() : await response.text();
        if (data?.csrf) csrf = data.csrf;
        return { status: response.status, data };
      },
      get cookie() {
        return cookie;
      },
    };
  }
  return {
    store,
    service,
    client,
    get liveCalls() {
      return liveCalls;
    },
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      store.close();
    },
  };
}
describe('HTTP → ownership → durable case flow', () => {
  it('reviews corrections atomically, isolates learning, resets methods and forgets deleted cases', async () => {
    const h = await harness();
    try {
      const client = h.client(),
        other = h.client();
      const session = await client.request('/api/session');
      await other.request('/api/session');
      const made = await client.request('/api/cases', 'POST', {
        task: defaultTask('repair'),
        mode: 'sample',
      });
      const c = made.data as CaseRecord;
      const result = parseCallResult(
        {
          recipients: [
            {
              structured_result: {
                disposition: 'answered',
                facts: [
                  {
                    field: 'budget',
                    value_json: '38',
                    quote: 'The total is $38.',
                    turn_index: 0,
                    certainty: 'confirmed',
                    conditions: [],
                    unit: 'USD',
                    price_basis: 'all_in',
                  },
                ],
              },
              attempts: [{ transcript_turns: [{ speaker: 'user', text: 'The total is $38.' }] }],
            },
          ],
        },
        c.revisions[0].task,
        {
          id: 'test',
          name: 'Synthetic recipient',
          phone: '+12025550101',
          consentRef: 'test',
          timezone: 'UTC',
        },
        'synthetic-learning',
        c.createdAt,
      );
      c.mode = 'live';
      c.revisions[0].results = [result];
      h.store.saveCase(session.data.user.id, c);
      const review = {
        version: 1,
        candidateId: result.id,
        reviews: [{ factId: result.facts[0].id, action: 'confirm' }],
      };
      const eventsBefore = h.store.db.prepare('SELECT COUNT(*) AS n FROM events').get()!.n;
      const failed = await client.request(`/api/cases/${c.id}/review`, 'POST', {
        ...review,
        reviews: [...review.reviews, { factId: 'missing', action: 'confirm' }],
      });
      assert.equal(failed.status, 404);
      assert.equal((await client.request('/api/learning')).data.rules[0].accepted, 0);
      assert.equal(h.store.db.prepare('SELECT COUNT(*) AS n FROM events').get()!.n, eventsBefore);
      assert.equal(
        h.store.getCase(c.id, session.data.user.id)!.revisions[0].results[0].facts[0].reviewed,
        false,
      );
      assert.equal((await other.request(`/api/cases/${c.id}/review`, 'POST', review)).status, 404);
      for (let i = 0; i < 2; i++)
        assert.equal(
          (await client.request(`/api/cases/${c.id}/review`, 'POST', review)).status,
          200,
        );
      assert.equal((await client.request('/api/learning')).data.rules[0].accepted, 1);
      assert.equal((await other.request('/api/learning')).data.rules[0].accepted, 0);
      assert.equal(
        (await client.request('/api/learning/explicit_usd', 'DELETE', {}, { 'x-csrf-token': '' }))
          .status,
        403,
      );
      const rejected = await client.request(`/api/cases/${c.id}/review`, 'POST', {
        ...review,
        reviews: [{ factId: result.facts[0].id, action: 'reject' }],
      });
      assert.equal(rejected.status, 200);
      assert.equal((await client.request('/api/learning')).data.rules[0].status, 'paused');
      assert.equal(
        (await client.request('/api/learning/explicit_usd', 'DELETE')).data.rules[0].status,
        'trial',
      );
      // Restore only the synthetic test fixture to exercise deletion of newly learned feedback.
      h.store.saveCase(session.data.user.id, c);
      assert.equal((await client.request(`/api/cases/${c.id}/review`, 'POST', review)).status, 200);
      assert.equal((await client.request('/api/learning')).data.rules[0].accepted, 1);
      assert.equal((await client.request(`/api/cases/${c.id}`, 'DELETE')).status, 200);
      assert.equal((await client.request('/api/learning')).data.rules[0].accepted, 0);
      assert.equal(h.liveCalls, 0);
    } finally {
      await h.close();
    }
  });
  it('three sample templates save, compare, reopen, export, and never call the provider', async () => {
    const h = await harness();
    try {
      const c = h.client();
      assert.equal((await c.request('/api/session')).status, 200);
      for (const template of ['repair', 'rental', 'venue'] as const) {
        const made = await c.request('/api/cases', 'POST', {
          task: defaultTask(template),
          mode: 'sample',
        });
        assert.equal(made.status, 201);
        const id = made.data.id;
        const checked = await c.request(`/api/cases/${id}/sample`, 'POST', {
          expectedVersion: 1,
          candidateIds: [`${template}-1`, `${template}-2`, `${template}-3`],
        });
        assert.equal(checked.status, 200);
        assert.equal(checked.data.revisions[0].results.length, 3);
        const reopened = await c.request(`/api/cases/${id}`);
        assert.equal(reopened.data.revisions[0].results.length, 3);
        const exported = await c.request(`/api/cases/${id}/export`);
        assert.match(exported.data, /FICTIONAL/);
        assert.match(exported.data, /Evidence:/);
      }
      assert.equal(h.liveCalls, 0);
    } finally {
      await h.close();
    }
  });
  it('new revisions preserve original requirements and evidence', async () => {
    const h = await harness();
    try {
      const c = h.client();
      await c.request('/api/session');
      const made = await c.request('/api/cases', 'POST', {
        task: defaultTask('repair'),
        mode: 'sample',
      });
      const id = made.data.id;
      await c.request(`/api/cases/${id}/sample`, 'POST', {
        expectedVersion: 1,
        candidateIds: ['repair-1'],
      });
      const task = defaultTask('repair');
      task.requirements.find((r) => r.id === 'budget')!.value = 5000;
      const revised = await c.request(`/api/cases/${id}`, 'PATCH', { task, expectedVersion: 1 });
      assert.equal(revised.status, 200);
      assert.equal(revised.data.revisions.length, 2);
      assert.equal(
        revised.data.revisions[0].task.requirements.find((r: { id: string }) => r.id === 'budget')
          .value,
        4000,
      );
      assert.equal(
        revised.data.revisions[1].task.requirements.find((r: { id: string }) => r.id === 'budget')
          .value,
        5000,
      );
      assert.equal(
        (await c.request(`/api/cases/${id}`, 'PATCH', { task, expectedVersion: 1 })).status,
        409,
      );
    } finally {
      await h.close();
    }
  });
  it('denies another account every case, evidence, mutation, and export route', async () => {
    const h = await harness();
    try {
      const a = h.client(),
        b = h.client();
      await a.request('/api/session');
      await b.request('/api/session');
      const made = await a.request('/api/cases', 'POST', {
        task: defaultTask('repair'),
        mode: 'sample',
      });
      const id = made.data.id;
      for (const suffix of ['', '/export'])
        assert.equal((await b.request(`/api/cases/${id}${suffix}`)).status, 404);
      assert.equal((await b.request(`/api/cases/${id}`, 'DELETE')).status, 404);
      assert.equal(
        (
          await b.request(`/api/cases/${id}/sample`, 'POST', {
            expectedVersion: 1,
            candidateIds: ['repair-1'],
          })
        ).status,
        404,
      );
      assert.deepEqual((await b.request('/api/cases')).data, []);
    } finally {
      await h.close();
    }
  });
  it('blocks cross-origin writes, missing CSRF, and unauthorized live cases', async () => {
    const h = await harness();
    try {
      const c = h.client();
      await c.request('/api/session');
      const body = { task: defaultTask('repair'), mode: 'sample' };
      assert.equal(
        (await c.request('/api/cases', 'POST', body, { origin: 'https://untrusted.example' }))
          .status,
        403,
      );
      assert.equal(
        (await c.request('/api/cases', 'POST', body, { 'x-csrf-token': '' })).status,
        403,
      );
      assert.equal((await c.request('/api/cases', 'POST', { ...body, mode: 'live' })).status, 403);
    } finally {
      await h.close();
    }
  });
  it('sign-up retains guest checks, sign-out isolates them, sign-in restores ownership', async () => {
    const h = await harness();
    try {
      const c = h.client();
      await c.request('/api/session');
      const made = await c.request('/api/cases', 'POST', {
        task: defaultTask('repair'),
        mode: 'sample',
      });
      const oldCookie = c.cookie;
      const signup = await c.request('/api/auth/signup', 'POST', {
        email: 'builder@example.test',
        password: 'A-local-test-password-42',
        name: 'Builder',
      });
      assert.equal(signup.status, 200);
      assert.equal(signup.data.user.guest, false);
      assert.notEqual(c.cookie, oldCookie);
      assert.equal((await c.request(`/api/cases/${made.data.id}`)).status, 200);
      await c.request('/api/auth/signout', 'POST');
      assert.equal((await c.request(`/api/cases/${made.data.id}`)).status, 404);
      assert.equal(
        (
          await c.request('/api/auth/signin', 'POST', {
            email: 'builder@example.test',
            password: 'A-local-test-password-42',
          })
        ).status,
        200,
      );
      assert.equal((await c.request(`/api/cases/${made.data.id}`)).status, 200);
    } finally {
      await h.close();
    }
  });
  it('only human outcome transitions can confirm and complete an arrangement', async () => {
    const h = await harness();
    try {
      const c = h.client();
      await c.request('/api/session');
      const made = await c.request('/api/cases', 'POST', {
        task: defaultTask('repair'),
        mode: 'sample',
      });
      const id = made.data.id;
      await c.request(`/api/cases/${id}/sample`, 'POST', {
        expectedVersion: 1,
        candidateIds: ['repair-1'],
      });
      assert.equal(
        (
          await c.request(`/api/cases/${id}/outcomes`, 'POST', {
            candidateId: 'repair-1',
            state: 'completed',
          })
        ).status,
        409,
      );
      for (const state of ['selected', 'arrangement_confirmed', 'completed'])
        assert.equal(
          (await c.request(`/api/cases/${id}/outcomes`, 'POST', { candidateId: 'repair-1', state }))
            .status,
          200,
        );
      const final = await c.request(`/api/cases/${id}`);
      assert.equal(final.data.outcomes.length, 3);
    } finally {
      await h.close();
    }
  });
  it('delete removes all ordinary access and export', async () => {
    const h = await harness();
    try {
      const c = h.client();
      await c.request('/api/session');
      const made = await c.request('/api/cases', 'POST', {
        task: defaultTask('repair'),
        mode: 'sample',
      });
      assert.equal((await c.request(`/api/cases/${made.data.id}`, 'DELETE')).status, 200);
      assert.equal((await c.request(`/api/cases/${made.data.id}`)).status, 404);
      assert.deepEqual((await c.request('/api/cases')).data, []);
    } finally {
      await h.close();
    }
  });
  it('SQLite data survives closing and reopening the store', () => {
    const dir = mkdtempSync(join(tmpdir(), 'readycheck-store-'));
    try {
      const path = join(dir, 'test.sqlite'),
        s = new Store(path),
        now = new Date().toISOString();
      s.db
        .prepare('INSERT INTO users VALUES(?,?,?,?,?,?)')
        .run('owner', null, 'Owner', null, 1, now);
      const record: CaseRecord = {
        id: 'case',
        title: 'Persisted',
        mode: 'sample',
        createdAt: now,
        updatedAt: now,
        currentVersion: 1,
        revisions: [{ version: 1, task: defaultTask('repair'), createdAt: now, results: [] }],
        outcomes: [],
        stopped: false,
      };
      s.saveCase('owner', record);
      s.close();
      const reopened = new Store(path);
      assert.equal(reopened.getCase('case', 'owner')!.title, 'Persisted');
      assert.equal(reopened.getCase('case', 'other'), null);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

it('audits metadata corrections and rejects caller citations, silent edits and supersession cycles', async () => {
  const h = await harness();
  try {
    const client = h.client();
    const session = await client.request('/api/session');
    const { data: c } = await client.request('/api/cases', 'POST', {
      task: defaultTask('repair'),
      mode: 'sample',
    });
    const task = c.revisions[0].task;
    const value = task.requirements.find((r: { id: string }) => r.id === 'deadline').value;
    const result = parseCallResult(
      {
        recipients: [
          {
            structured_result: {
              disposition: 'answered',
              facts: [
                {
                  field: 'deadline',
                  value_json: JSON.stringify(value),
                  quote: 'Yes, it will be ready.',
                  turn_index: 1,
                  certainty: 'tentative',
                  conditions: ['Asked about the requested deadline'],
                  unit: 'none',
                  price_basis: 'not_applicable',
                },
              ],
            },
            attempts: [
              {
                transcript_turns: [
                  { speaker: 'bot', text: 'Can it be ready by the requested deadline?' },
                  { speaker: 'user', text: 'Yes, it will be ready.' },
                ],
              },
            ],
          },
        ],
      },
      task,
      {
        id: 'test',
        name: 'Synthetic shop',
        phone: '+12025550101',
        consentRef: 'fixture',
        timezone: 'UTC',
      },
      'metadata-fixture',
      c.createdAt,
    );
    c.mode = 'live';
    c.revisions[0].results = [result];
    h.store.saveCase(session.data.user.id, c);
    const original = JSON.parse(JSON.stringify(result.facts[0]));
    const review = (entry: object) =>
      client.request(`/api/cases/${c.id}/review`, 'POST', {
        version: 1,
        candidateId: result.id,
        reviews: [{ factId: original.id, ...entry }],
      });
    assert.equal((await review({ action: 'confirm', conditions: [] })).status, 400);
    assert.equal(
      (await review({ action: 'correct', value, reason: 'Wrong source', turn: 0 })).status,
      400,
    );
    assert.equal(
      (await review({ action: 'correct', value, reason: 'Outside source', evidenceTurns: [999] }))
        .status,
      400,
    );
    const fixed = await review({
      action: 'correct',
      value,
      reason:
        'The recipient confirms the deadline; the extraction put the question description in conditions.',
      certainty: 'confirmed',
      conditions: [],
      context: original.conditions,
      answerState: 'value',
      turn: 1,
      evidenceTurns: [0, 1],
    });
    assert.equal(fixed.status, 200);
    const saved = h.store.getCase(c.id, session.data.user.id)!.revisions[0].results[0];
    assert.deepEqual(saved.facts[0], original);
    assert.equal(saved.facts[1].supersedes, original.id);
    assert.deepEqual(saved.facts[1].conditions, []);
    assert.deepEqual(saved.facts[1].context, original.conditions);
    const { evaluateCandidate } = await import('../src/domain/evaluator');
    assert.equal(
      evaluateCandidate(task, saved).checks.find((check) => check.requirement.id === 'deadline')!
        .verdict,
      'pass',
    );
    assert.equal((await review({ action: 'confirm', supersedes: saved.facts[1].id })).status, 409);
    assert.equal(h.liveCalls, 0);
  } finally {
    await h.close();
  }
});
