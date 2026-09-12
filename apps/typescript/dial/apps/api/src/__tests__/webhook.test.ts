import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { calls, processedWebhookEvents } from '@dial/database';
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
 * The webhook boundary (section 6 / section 26). Deliveries are unsigned, so
 * every one of these tests is really asking the same question: can a stranger
 * who POSTs this endpoint change what Dial believes happened on a phone call?
 */

let h: Harness;
afterEach(async () => {
  await h?.close();
});

/** A provider whose calls stay in progress until the webhook arrives. */
function pendingProvider(onGet: () => ProviderCallSnapshot): CallProvider {
  return {
    name: 'fake',
    placesRealCalls: false,
    async create(request) {
      return {
        providerCallId: `pc_${request.idempotencyKey.replace(/[^a-z0-9]/gi, '')}`,
        status: 'in_progress',
        structuredResult: null,
        summary: null,
        taskCompleted: null,
        completionConfidence: null,
        evidence: [],
        attempts: [],
        failureCode: null,
        failureMessage: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
    },
    async get() {
      return onGet();
    },
  };
}

function terminalSnapshot(providerCallId: string, price: number): ProviderCallSnapshot {
  return {
    providerCallId,
    status: 'completed',
    structuredResult: {
      can_repair: 'yes',
      quoted_price: price,
      currency: 'EUR',
      confidence: 'high',
      evidence_summary: `They quoted ${price} euro.`,
    },
    summary: 'Quoted a price.',
    taskCompleted: true,
    completionConfidence: { score: 0.9, label: 'high' },
    evidence: ['Price stated on the call.'],
    attempts: [
      {
        id: `${providerCallId}_a1`,
        phoneMasked: '+35***00',
        status: 'completed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        summary: 'Quoted a price.',
        transcript: [{ offsetSeconds: 0, speaker: 'bot', text: 'Hello' }],
        failureCode: null,
        failureMessage: null,
      },
    ],
    failureCode: null,
    failureMessage: null,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
}

async function setup(snapshotPrice = 95): Promise<{ token: string; taskId: string; providerCallId: string }> {
  h = await createHarness({
    provider: pendingProvider(() => terminalSnapshot(currentProviderCallId, snapshotPrice)),
    discovery: stubDiscovery({ candidates: [candidate({ id: 'w1', name: 'WebhookShop' })] }),
  });
  const { token } = await signUp(h);
  const created = await createTask(h, token, 'Find the cheapest iPhone 13 screen repair near me');
  await h.runner.drain();

  const rows = await h.handle.db.select().from(calls).where(eq(calls.taskId, created.id));
  currentProviderCallId = rows[0]!.providerCallId!;
  return { token, taskId: created.id, providerCallId: currentProviderCallId };
}

let currentProviderCallId = '';

function webhookBody(eventId: string, providerCallId: string, type = 'call.completed') {
  return {
    id: eventId,
    type,
    created_at: new Date().toISOString(),
    data: { id: providerCallId, status: 'completed' },
  };
}

describe('CALL-E webhook receiver', () => {
  it('accepts a well-formed delivery and applies the re-fetched result', async () => {
    const { token, taskId, providerCallId } = await setup(95);

    const response = await h.app.inject({
      method: 'POST',
      url: '/api/webhooks/calle',
      headers: { 'call-e-event-id': 'evt_1' },
      payload: webhookBody('evt_1', providerCallId),
    });
    expect(response.statusCode).toBe(200);

    await h.runner.drain();
    const detail = await getTaskDetail(h, token, taskId);
    expect(detail.calls[0].disposition).toBe('answered_useful');
    expect(detail.calls[0].structuredResult.quoted_price).toBe(95);
  });

  it('is idempotent: a redelivered event changes nothing', async () => {
    const { providerCallId } = await setup();

    const first = await h.app.inject({
      method: 'POST',
      url: '/api/webhooks/calle',
      headers: { 'call-e-event-id': 'evt_dup' },
      payload: webhookBody('evt_dup', providerCallId),
    });
    const second = await h.app.inject({
      method: 'POST',
      url: '/api/webhooks/calle',
      headers: { 'call-e-event-id': 'evt_dup' },
      payload: webhookBody('evt_dup', providerCallId),
    });

    // Both acknowledged — CALL-E treats any 2xx as delivered.
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const events = await h.handle.db.select().from(processedWebhookEvents);
    expect(events.filter((e) => e.eventId === 'evt_dup')).toHaveLength(1);
  });

  it('rejects a delivery whose event-id header does not match the body', async () => {
    const { providerCallId } = await setup();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/webhooks/calle',
      headers: { 'call-e-event-id': 'not_the_same' },
      payload: webhookBody('evt_2', providerCallId),
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a delivery with no event-id header at all', async () => {
    const { providerCallId } = await setup();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/webhooks/calle',
      payload: webhookBody('evt_3', providerCallId),
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a malformed payload', async () => {
    await setup();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/webhooks/calle',
      headers: { 'call-e-event-id': 'evt_4' },
      payload: { id: 'evt_4', type: 'not.a.real.event', data: {} },
    });
    expect(response.statusCode).toBe(400);
  });

  it('never writes attacker-supplied data: the result comes from the re-fetch', async () => {
    const { token, taskId, providerCallId } = await setup(95);

    // A hostile delivery claiming a €1 quote and a bogus transcript.
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/webhooks/calle',
      headers: { 'call-e-event-id': 'evt_evil' },
      payload: {
        ...webhookBody('evt_evil', providerCallId),
        data: {
          id: providerCallId,
          status: 'completed',
          structured_result: { can_repair: 'yes', quoted_price: 1, currency: 'EUR' },
          summary: 'INJECTED',
        },
      },
    });
    expect(response.statusCode).toBe(200);

    await h.runner.drain();
    const detail = await getTaskDetail(h, token, taskId);
    // The authenticated re-fetch won; the delivered body was ignored entirely.
    expect(detail.calls[0].structuredResult.quoted_price).toBe(95);
    expect(detail.calls[0].summary).not.toBe('INJECTED');
  });

  it('acknowledges an event for a call it does not know about', async () => {
    await setup();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/webhooks/calle',
      headers: { 'call-e-event-id': 'evt_unknown' },
      payload: webhookBody('evt_unknown', 'pc_someone_elses_call'),
    });
    expect(response.statusCode).toBe(200);
  });
});
