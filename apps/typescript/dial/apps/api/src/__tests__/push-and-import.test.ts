import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { pushTokens, notifications, jobs } from '@dial/database';
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
 * Push registration and contact import.
 *
 * Push: the token identifies a device install. It has exactly one owner at a
 * time; only its owner can remove it; and a completed task's notification row
 * must end up delivered even when no device is registered -- the row is the
 * record, push is just how it travels.
 *
 * Import: entries arrive raw from the address book. The server normalizes
 * against the country of recent searches, skips what it cannot dial, and
 * renames numbers that are already kept.
 */

let h: Harness;
afterEach(async () => {
  await h?.close();
});

describe('push token registration', () => {
  it('registers, re-homes on takeover, and is removed by its owner', async () => {
    h = await createHarness();
    const alice = await signUp(h);
    const bob = await signUp(h);
    const headersFor = (token: string) => ({ authorization: `Bearer ${token}` });

    const first = await h.app.inject({
      method: 'POST',
      url: '/api/push/register',
      headers: headersFor(alice.token),
      payload: { token: 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaaaaaa]', platform: 'ios' },
    });
    expect(first.statusCode).toBe(200);
    expect(await h.handle.db.select().from(pushTokens)).toHaveLength(1);

    // The same phone signing in as Bob takes the token over; Alice no longer
    // rings this device.
    const second = await h.app.inject({
      method: 'POST',
      url: '/api/push/register',
      headers: headersFor(bob.token),
      payload: { token: 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaaaaaa]', platform: 'ios' },
    });
    expect(second.statusCode).toBe(200);
    const rows = await h.handle.db.select().from(pushTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(bob.userId);

    // Bob cannot be stripped of it by Alice.
    await h.app.inject({
      method: 'POST',
      url: '/api/push/unregister',
      headers: headersFor(alice.token),
      payload: { token: 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaaaaaa]' },
    });
    expect(await h.handle.db.select().from(pushTokens)).toHaveLength(1);

    // Only Bob can.
    await h.app.inject({
      method: 'POST',
      url: '/api/push/unregister',
      headers: headersFor(bob.token),
      payload: { token: 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaaaaaa]' },
    });
    expect(await h.handle.db.select().from(pushTokens)).toHaveLength(0);
  });

  it('rejects an unregistered caller', async () => {
    h = await createHarness();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/push/register',
      payload: { token: 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbbbbbb]', platform: 'android' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('records every notification as delivered once its delivery job runs', async () => {
    h = await createHarness({
      discovery: stubDiscovery({ candidates: [candidate({ id: 'p1', name: 'RingShop', phoneE164: '+35316790309' })] }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'Find the cheapest iPhone 13 screen repair near me');
    await h.runner.drain();

    // The task finishing enqueues exactly one delivery job per notification,
    // deduped by the notification id.
    const deliveries = await h.handle.db.select().from(jobs).where(eq(jobs.kind, 'push.deliver'));
    expect(deliveries.length).toBeGreaterThan(0);

    // Every notification row ends delivered, even with no device registered:
    // the row is the record, push is only how it would have travelled.
    const all = await h.handle.db.select().from(notifications);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((n) => n.deliveredAt !== null)).toBe(true);

    // And the task itself finished normally with nobody registered.
    const detail = await getTaskDetail(h, token, created.id);
    expect(['completed', 'partially_completed']).toContain(detail.state);
  });
});

describe('contact import from a device', () => {
  it('normalizes against the country of recent searches and reports skips', async () => {
    h = await createHarness({
      discovery: stubDiscovery({
        candidates: [candidate({ id: 'i1', name: 'ImportShop', phoneE164: '+35316790308' })],
        geocode: { latitude: 53.3498, longitude: -6.2603, label: 'Dublin, Ireland', countryCode: 'IE' },
      }),
    });
    const { token } = await signUp(h);

    // One completed search first, so Dial knows "local" means Irish.
    const created = await createTask(h, token, 'Find the cheapest iPhone 13 screen repair near me');
    await h.runner.drain();
    expect(created.id).toBeTruthy();

    const response = await h.app.inject({
      method: 'POST',
      url: '/api/contacts/import',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        contacts: [
          { name: 'Aoife', phone: '087 123 4567' },          // national form -> +353…
          { name: 'Garbage', phone: '12345' },               // not diallable anywhere
          { name: 'Premium Line', phone: '+19005550001' },   // blocked range
          { name: 'Aoife Mobile', phone: '+353871234567' },  // same number again -> rename
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { imported: number; renamed: number; skipped: Array<{ name: string; reason: string }> };
    expect(body.imported).toBe(1);
    expect(body.renamed).toBe(1);
    expect(body.skipped).toEqual([
      { name: 'Garbage', reason: 'invalid_number' },
      { name: 'Premium Line', reason: 'blocked_number' },
    ]);

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/contacts',
      headers: { authorization: `Bearer ${token}` },
    });
    const contacts = (list.json() as { contacts: Array<{ name: string; phoneE164: string }> }).contacts;
    const aoife = contacts.find((c) => c.name === 'Aoife Mobile');
    expect(aoife?.phoneE164).toBe('+353871234567');
    expect(contacts.some((c) => c.name === 'Aoife')).toBe(false);
  });

  it('refuses an empty batch and an unregistered caller', async () => {
    h = await createHarness();
    const { token } = await signUp(h);

    const empty = await h.app.inject({
      method: 'POST',
      url: '/api/contacts/import',
      headers: { authorization: `Bearer ${token}` },
      payload: { contacts: [] },
    });
    expect(empty.statusCode).toBe(400);

    const anonymous = await h.app.inject({
      method: 'POST',
      url: '/api/contacts/import',
      payload: { contacts: [{ name: 'X', phone: '+35316790307' }] },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
