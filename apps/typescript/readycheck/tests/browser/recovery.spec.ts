import { test, expect } from '@playwright/test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { Store } from '../../server/store';
import { createApp } from '../../server/app';
import { DispatchUnknown } from '../../server/calle';
import { preparePlan, approvePlan } from '../../server/inquiries';
import { defaultTask } from '../../src/domain/templates';
import type { CaseRecord } from '../../src/domain/model';
import type { Config } from '../../server/config';

test('recovery UI resumes the original request exactly once and shows provider progress', async ({
  page,
}) => {
  const store = new Store(':memory:');
  const gateway = express();
  const server = gateway.listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const config: Config = {
    apiKey: 'fake',
    enabled: true,
    users: [],
    recipients: [
      {
        id: 'test',
        name: 'Synthetic shop',
        phone: '+12025550101',
        consentRef: 'fixture',
        timezone: 'UTC',
      },
    ],
    maxPerDay: 1,
    maxPerUserDay: 1,
    callStart: 0,
    callEnd: 24,
    retentionDays: 30,
  };
  let replays = 0,
    creates = 0,
    expectedId = '',
    originalBody = '',
    originalKey = '';
  const { app, service } = createApp({
    store,
    origin,
    config,
    transport: {
      create: async () => {
        creates++;
        throw new DispatchUnknown('Synthetic lost response');
      },
      recover: async (body, key) => {
        replays++;
        expect(body).toBe(originalBody);
        expect(key).toBe(originalKey);
        return 'call_original';
      },
      read: async () => ({
        status: 'in_progress',
        metadata: { readycheck_inquiry_id: expectedId },
        recipients: [{ status: 'completed' }],
      }),
    },
  });
  gateway.use(app);
  gateway.use(express.static(resolve('dist')));
  gateway.get('/', (_req, res) => res.sendFile(resolve('dist/index.html')));
  try {
    await page.goto(origin);
    const session = await page.evaluate(async () => (await fetch('/api/session')).json());
    store.db.prepare('UPDATE users SET guest=0 WHERE id=?').run(session.user.id);
    const user = { ...session.user, guest: false };
    config.users.push(user.id);
    const now = new Date().toISOString();
    const record: CaseRecord = {
      id: 'recovery-fixture',
      title: 'Synthetic recovery check',
      mode: 'live',
      createdAt: now,
      updatedAt: now,
      currentVersion: 1,
      revisions: [{ version: 1, task: defaultTask('repair'), createdAt: now, results: [] }],
      outcomes: [],
      stopped: false,
    };
    store.saveCase(user.id, record);
    const plan = preparePlan(store, config, user, record, ['test']);
    approvePlan(store, config, user, plan.id, plan.hash);
    expectedId = plan.inquiries[0].id;
    const row = store.db
      .prepare('SELECT payload,idempotency_key FROM inquiries WHERE id=?')
      .get(expectedId)!;
    originalBody = String(row.payload);
    originalKey = String(row.idempotency_key);
    await service.dispatchNext(plan.id, user);
    await page.goto(`${origin}/?case=${record.id}`);
    await page.getByRole('button', { name: 'View call status', exact: true }).click();
    await page.getByRole('button', { name: 'Reconcile existing call', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('this may start the approved call now');
    await page.getByRole('button', { name: 'Recover original request once', exact: true }).click();
    await expect
      .poll(
        () =>
          store.db.prepare('SELECT vendor_id FROM inquiries WHERE id=?').get(expectedId)!.vendor_id,
      )
      .toBe('call_original');
    expect(replays).toBe(1);
    expect(creates).toBe(1);
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM budgets').get()!.n).toBe(1);
    await service.tick();
    await page.reload();
    await page.getByRole('button', { name: 'View call status', exact: true }).click();
    await expect(page.getByText('Call ended · preparing the transcript and answers')).toBeVisible();
    await page.screenshot({ path: 'artifacts/recovery-verified.png' });
    expect(replays).toBe(1);
  } finally {
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
    store.close();
  }
});
