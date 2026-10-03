import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Store } from '../server/store';
import { ConnectionVerifier } from '../server/connection';
import { loadConfig } from '../server/config';
import { ProviderReadError } from '../server/calle';
import { createApp } from '../server/app';

function user(store: Store, id = 'operator') {
  store.db
    .prepare('INSERT INTO users VALUES(?,?,?,?,?,?)')
    .run(
      id,
      `${id}@example.test`,
      'Synthetic operator',
      'unused-test-hash',
      0,
      new Date().toISOString(),
    );
}
const configuration = () =>
  loadConfig({
    CALLE_API_KEY: 'private-test-key',
    LIVE_USER_IDS: 'operator',
    CALLE_VERIFICATION_CALL_ID: 'known_test_call',
  });

describe('read-only provider access verification', () => {
  it('persists only scoped check metadata and invalidates evidence when the key changes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'readycheck-connection-'));
    const path = join(directory, 'test.sqlite');
    let store = new Store(path);
    const config = configuration();
    let reads = 0,
      creates = 0;
    const transport = {
      create: async () => {
        creates++;
        return 'must-not-create';
      },
      read: async (id: string) => {
        reads++;
        assert.equal(id, 'known_test_call');
        return { status: 'completed', transcript: 'private conversation', phone: '+12025550101' };
      },
    };
    try {
      user(store);
      const verifier = new ConnectionVerifier(store, config, transport);
      const result = await verifier.verify('operator');
      assert.equal(result.status, 'verified');
      assert.match(result.message, /read access only/);
      for (const secret of [
        'private-test-key',
        'known_test_call',
        'private conversation',
        '+12025550101',
      ])
        assert.equal(JSON.stringify(result).includes(secret), false);
      assert.equal(verifier.current('other-user'), null);
      await assert.rejects(verifier.verify('operator'), /Wait one minute/);
      assert.equal(reads, 1);
      assert.equal(creates, 0);
      assert.equal(store.db.prepare('SELECT count(*) AS n FROM inquiries').get()!.n, 0);
      const persisted = JSON.stringify(store.db.prepare('SELECT * FROM connection_checks').all());
      for (const secret of [
        'private-test-key',
        'known_test_call',
        'private conversation',
        '+12025550101',
      ])
        assert.equal(persisted.includes(secret), false);
      store.close();
      store = new Store(path);
      assert.equal(
        new ConnectionVerifier(store, config, transport).current('operator')?.status,
        'verified',
      );
      assert.equal(
        new ConnectionVerifier(store, { ...config, apiKey: 'rotated-key' }, transport).current(
          'operator',
        ),
        null,
      );
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('distinguishes rejected credentials, absent calls, malformed results and network failures', async () => {
    for (const [failure, expected] of [
      [new ProviderReadError(401), 'rejected'],
      [new ProviderReadError(403), 'rejected'],
      [new ProviderReadError(404), 'not_found'],
      [new ProviderReadError(500), 'unavailable'],
      [new Error('private credential detail'), 'unavailable'],
      [null, 'invalid_response'],
    ] as const) {
      const store = new Store(':memory:');
      try {
        user(store);
        const verifier = new ConnectionVerifier(store, configuration(), {
          create: async () => {
            throw new Error('Must never create');
          },
          read: async () => {
            if (failure) throw failure;
            return { status: 'invented', detail: 'private credential detail' };
          },
        });
        const result = await verifier.verify('operator');
        assert.equal(result.status, expected);
        assert.equal(result.message.includes('private credential detail'), false);
      } finally {
        store.close();
      }
    }
  });

  it('requires a known call and never selects another user’s inquiry', async () => {
    const store = new Store(':memory:');
    let reads = 0;
    const config = { ...configuration(), verificationCallId: undefined };
    try {
      user(store);
      user(store, 'other');
      store.db
        .prepare('INSERT INTO cases VALUES(?,?,?,?,?)')
        .run('case', 'other', '{}', 0, '2026-09-09');
      store.db
        .prepare('INSERT INTO plans VALUES(?,?,?,?,?,?,?,?,?)')
        .run('plan', 'case', 'other', 1, 'hash', '{}', 'complete', null, '2026-09-10');
      store.db
        .prepare(
          'INSERT INTO inquiries(id,plan_id,candidate_id,owner_id,state,idempotency_key,payload,vendor_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          'inquiry',
          'plan',
          'candidate',
          'other',
          'evaluated',
          'key',
          '{}',
          'private_other_call',
          '2026-09-09',
          '2026-09-09',
        );
      const transport = {
        create: async () => 'never',
        read: async () => {
          reads++;
          return { status: 'completed' };
        },
      };
      const verifier = new ConnectionVerifier(store, config, transport);
      await assert.rejects(verifier.verify('operator'), /No existing call/);
      assert.equal(reads, 0);
      assert.equal((await verifier.verify('other')).status, 'verified');
      assert.equal(reads, 1);
    } finally {
      store.close();
    }
  });

  it('prevents overlapping reads and marks an interrupted check as unverified', async () => {
    const store = new Store(':memory:');
    let finish!: (value: unknown) => void;
    try {
      user(store);
      const verifier = new ConnectionVerifier(store, configuration(), {
        create: async () => 'never',
        read: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      });
      const pending = verifier.verify('operator');
      assert.equal(verifier.current('operator')?.status, 'checking');
      await assert.rejects(verifier.verify('operator'), /Wait one minute/);
      finish({ status: 'completed' });
      await pending;
      store.db
        .prepare('UPDATE connection_checks SET status=?,checked_at=?')
        .run('checking', new Date(Date.now() - 40000).toISOString());
      assert.equal(verifier.current('operator')?.status, 'unavailable');
    } finally {
      store.close();
    }
  });

  it('protects the HTTP boundary and exposes neither provider data nor a dial action', async () => {
    const store = new Store(':memory:');
    const config = configuration();
    config.users = [];
    let reads = 0,
      creates = 0;
    const { app } = createApp({
      store,
      config,
      origin: 'http://readycheck.test',
      transport: {
        create: async () => {
          creates++;
          return 'never';
        },
        read: async () => {
          reads++;
          return { status: 'completed', transcript: 'private transcript' };
        },
      },
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    let cookie = '',
      csrf = '';
    async function request(path: string, method = 'GET', body = {}, overrides = {}) {
      const response = await fetch(origin + path, {
        method,
        headers: {
          cookie,
          origin: 'http://readycheck.test',
          'content-type': 'application/json',
          'x-csrf-token': csrf,
          ...overrides,
        },
        body: method === 'GET' ? undefined : JSON.stringify(body),
      });
      if (response.headers.get('set-cookie'))
        cookie = response.headers.get('set-cookie')!.split(';')[0];
      const data = await response.json();
      if (data.csrf) csrf = data.csrf;
      return { status: response.status, data };
    }
    try {
      await request('/api/session');
      assert.equal((await request('/api/connection/verify', 'POST')).status, 403);
      const account = await request('/api/auth/signup', 'POST', {
        email: 'operator@example.test',
        password: 'Synthetic-password-for-test-only',
      });
      assert.equal(account.status, 200);
      assert.equal((await request('/api/connection/verify', 'POST')).status, 403);
      config.users.push(account.data.user.id);
      assert.equal(
        (await request('/api/connection/verify', 'POST', {}, { 'x-csrf-token': 'wrong' })).status,
        403,
      );
      assert.equal(
        (await request('/api/connection/verify', 'POST', { callId: 'arbitrary_call' })).status,
        400,
      );
      assert.equal(reads, 0);
      const verified = await request('/api/connection/verify', 'POST');
      assert.equal(verified.status, 200);
      assert.equal(verified.data.status, 'verified');
      const session = await request('/api/session');
      assert.equal(session.data.connection.readAccess.status, 'verified');
      assert.equal(session.data.connection.configured, false);
      assert.equal(session.data.connection.checks.length, 5);
      assert.equal(JSON.stringify(session.data).includes('private transcript'), false);
      await request('/api/auth/signout', 'POST');
      assert.equal((await request('/api/session')).data.connection.readAccess, null);
      assert.equal(reads, 1);
      assert.equal(creates, 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    }
  });
});
