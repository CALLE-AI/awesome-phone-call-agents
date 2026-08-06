import { describe, it, expect } from 'vitest';
import callCompleted from '../triggers/call-completed.js';

const { perform } = callCompleted.operation;

const completedEvent = {
  id: 'evt_1',
  type: 'call.completed',
  created_at: '2026-08-02T00:01:00Z',
  data: {
    id: 'call_1',
    status: 'completed',
    task_completed: true,
    completion_confidence: { score: 0.92, label: 'high' },
    structured_result: { acknowledged: 'yes' },
    summary: 'The engineer acknowledged the incident.',
    metadata: { correlation_id: 'incident-42' },
    recipients: [
      {
        id: 'rcp_1',
        phones: ['+15550123456'],
        status: 'completed',
        attempts: [
          {
            id: 'att_1',
            status: 'completed',
            transcript_turns: [
              { offset_seconds: 0, speaker: 'bot', text: 'Are you able to take this incident?' },
              { offset_seconds: 4, speaker: 'user', text: 'Yes, on it.' },
            ],
          },
        ],
      },
    ],
  },
};

const failedEvent = {
  id: 'evt_2',
  type: 'call.failed',
  data: { id: 'call_2', status: 'failed', failure_code: 'provider_error', recipients: [] },
};

const bundleFor = (cleanedRequest) => ({ cleanedRequest, authData: { apiKey: 'k' } });

// The webhook URL is unauthenticated, so the delivered body is only ever a
// notification. Every field this trigger reports is re-read from CALL-E over
// the connection's own API key, which is what this fake stands in for: it
// serves the records the account actually has.
const zServing = (records = [completedEvent.data, failedEvent.data], { throws = null, status = 200 } = {}) => ({
  request: async ({ url }) => {
    if (throws) throw new Error(throws);
    const id = decodeURIComponent(url.split('/').pop());
    const record = records.find((r) => r.id === id);
    if (!record) return { status: 404, data: { error: { code: 'not_found' } } };
    return { status, data: record };
  },
});

describe('call_completed trigger', () => {
  it('yields exactly one confirmed, actionable result for a terminal completed event', async () => {
    const out = await perform(zServing(), bundleFor(completedEvent));
    expect(out).toHaveLength(1);
    expect(out[0].disposition).toBe('confirmed');
    expect(out[0].is_actionable).toBe(true);
    expect(out[0].verified).toBe(true);
  });

  it('yields a failed, non-actionable result for a call.failed event', async () => {
    const out = await perform(zServing(), bundleFor(failedEvent));
    expect(out).toHaveLength(1);
    expect(out[0].disposition).toBe('failed');
    expect(out[0].is_actionable).toBe(false);
  });

  it('reports what CALL-E holds, not what the POSTed body claims', async () => {
    const forged = {
      id: 'evt_forged',
      type: 'call.completed',
      data: {
        id: 'call_1',
        status: 'completed',
        task_completed: true,
        completion_confidence: { score: 1, label: 'high' },
        structured_result: { acknowledged: 'yes' },
        recipients: [],
      },
    };
    // CALL-E's actual record for call_1: nobody gave an answer.
    const truth = { ...completedEvent.data, structured_result: { acknowledged: 'unknown' } };

    const out = await perform(zServing([truth]), bundleFor(forged));
    expect(out).toHaveLength(1);
    expect(out[0].disposition).toBe('review_required');
    expect(out[0].is_actionable).toBe(false);
    expect(out[0].result_acknowledged).toBe('unknown');
  });

  it('triggers nothing for a payload naming a call this connection cannot see', async () => {
    const forged = {
      id: 'evt_forged',
      type: 'call.completed',
      data: {
        id: 'call_does_not_exist',
        status: 'completed',
        task_completed: true,
        completion_confidence: { score: 1, label: 'high' },
        structured_result: { qualified: 'yes' },
        recipients: [],
      },
    };
    await expect(perform(zServing([]), bundleFor(forged))).resolves.toEqual([]);
  });

  // A real outcome must not be silently dropped just because CALL-E was
  // briefly unreachable - that is the opposite failure from a forged payload,
  // and it deserves the opposite handling.
  it('surfaces an unconfirmable outcome as needs_human rather than dropping it', async () => {
    const out = await perform(zServing([], { throws: 'socket hang up' }), bundleFor(completedEvent));
    expect(out).toHaveLength(1);
    expect(out[0].disposition).toBe('needs_human');
    expect(out[0].is_actionable).toBe(false);
    expect(out[0].verified).toBe(false);
  });

  it('makes no lookup, and confirms nothing, when the payload carries no call id', async () => {
    const seen = [];
    const z = { request: async (options) => { seen.push(options); return { status: 200, data: {} }; } };
    const out = await perform(z, bundleFor({ id: 'evt_x', type: 'call.completed', data: { status: 'completed' } }));
    expect(seen).toEqual([]);
    expect(out).toHaveLength(1);
    expect(out[0].is_actionable).toBe(false);
  });

  it('yields review_required when the call completed but nothing was extracted', async () => {
    const event = {
      id: 'evt_3',
      type: 'call.completed',
      data: {
        id: 'call_3',
        status: 'completed',
        task_completed: true,
        completion_confidence: { label: 'high' },
        recipients: [],
      },
    };
    const out = await perform(zServing([event.data]), bundleFor(event));
    expect(out).toHaveLength(1);
    expect(out[0].disposition).toBe('review_required');
  });

  it('returns an empty array rather than throwing when cleanedRequest is missing', async () => {
    await expect(perform({}, {})).resolves.toEqual([]);
  });

  it('returns an empty array rather than throwing when cleanedRequest is null', async () => {
    await expect(perform({}, bundleFor(null))).resolves.toEqual([]);
  });

  it('returns an empty array rather than throwing when cleanedRequest is not an object', async () => {
    await expect(perform({}, bundleFor('not an object'))).resolves.toEqual([]);
  });

  it('returns an empty array rather than throwing when cleanedRequest has no data object', async () => {
    await expect(perform({}, bundleFor({ id: 'evt_4', type: 'call.completed' }))).resolves.toEqual([]);
    await expect(
      perform({}, bundleFor({ id: 'evt_5', type: 'call.completed', data: 'nope' })),
    ).resolves.toEqual([]);
  });

  it('masks phone numbers in the output', async () => {
    const out = await perform(zServing(), bundleFor(completedEvent));
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('0123456');
    expect(serialized).toContain('+1******3456');
  });

  it('classifies an unrecognized event type to needs_human instead of dropping it', async () => {
    const event = { id: 'evt_6', type: 'call.something_new', data: { id: 'call_6', status: 'completed' } };
    const out = await perform(zServing([event.data]), bundleFor(event));
    expect(out).toHaveLength(1);
    expect(out[0].disposition).toBe('needs_human');
    expect(out[0].is_actionable).toBe(false);
  });
});
