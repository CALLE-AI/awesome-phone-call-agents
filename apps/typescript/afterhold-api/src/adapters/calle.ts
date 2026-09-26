/**
 * CALLE adapter.
 *
 * Two implementations:
 *  - real: raw HTTPS to ${CALLE_BASE_URL} with the CALLE_API_KEY header.
 *  - mock: scripted phase timeline. No network. No free call burned.
 *
 * Caller (worker) only cares about the Callegate interface — never look at
 * env inside the worker.
 */

import { env } from '../lib/env.js';
import { request } from 'undici';
import { newId } from '../lib/util.js';

export interface Callegate {
  /** Create the call. Returns the call id assigned by CALL-E. */
  createCall(input: CreateCallInput): Promise<{ calle_call_id: string }>;
  /** Poll for status. Returns terminal status if reached, plus transcript/result if available. */
  getCallStatus(callId: string): Promise<CallStatusResponse>;
  /** Optional: pull the developer-facing event log. */
  getCallEvents(callId: string): Promise<CallEvent[]>;
}

export interface CreateCallInput {
  task: string;
  resultSchema: object;
  phoneNumber: string; // E.164
  language?: string;
  idempotencyKey?: string;
}

export interface CallStatusResponse {
  status: 'queued' | 'planning' | 'dialing' | 'in_conversation' | 'wrapping' | 'completed' | 'voicemail' | 'unavailable' | 'refused' | 'failed';
  structuredResult?: any;
  transcriptExcerpt?: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface CallEvent {
  type: string;
  payload: any;
  t: string; // ISO
}

// ── Real implementation ────────────────────────────────────────────────

class RealCallegate implements Callegate {
  private baseHeaders() {
    if (!env.CALLE_API_KEY) throw new Error('CALLE_API_KEY is required when CALLE_MOCK=0');
    return {
      Authorization: `Bearer ${env.CALLE_API_KEY}`,
      'Content-Type': 'application/json',
    } as const;
  }

  async createCall(input: CreateCallInput) {
    const headers: Record<string, string> = { ...this.baseHeaders() };
    if (input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey;
    const res = await request(`${env.CALLE_BASE_URL}/v1/calls`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        task: input.task,
        result_schema: input.resultSchema,
        phone_number: input.phoneNumber,
        language: input.language ?? 'en-IN',
      }),
    });
    if (res.statusCode >= 400) {
      const body = await res.body.text();
      throw new Error(`CALL-E createCall ${res.statusCode}: ${body.slice(0, 500)}`);
    }
    const json = (await res.body.json()) as { id: string };
    return { calle_call_id: json.id };
  }

  async getCallStatus(callId: string) {
    const res = await request(`${env.CALLE_BASE_URL}/v1/calls/${callId}`, {
      method: 'GET',
      headers: this.baseHeaders(),
    });
    if (res.statusCode >= 400) throw new Error(`CALL-E getCallStatus ${res.statusCode}`);
    const json = (await res.body.json()) as any;
    return {
      status: json.status,
      structuredResult: json.structured_result,
      transcriptExcerpt: json.transcript_excerpt ?? json.transcript,
      completedAt: json.completed_at,
      errorMessage: json.error,
    } as CallStatusResponse;
  }

  async getCallEvents(callId: string) {
    const res = await request(`${env.CALLE_BASE_URL}/v1/calls/${callId}/events`, {
      method: 'GET',
      headers: this.baseHeaders(),
    });
    if (res.statusCode >= 400) throw new Error(`CALL-E getCallEvents ${res.statusCode}`);
    const json = (await res.body.json()) as { events: any[] };
    return (json.events ?? []).map((e: any) => ({
      type: e.type,
      payload: e.payload ?? {},
      t: e.t ?? e.created_at ?? new Date().toISOString(),
    }));
  }
}

// ── Mock implementation ────────────────────────────────────────────────

/**
 * Mock state machine. We store a small in-memory map of mock-call timelines.
 * Each call walks the phases with believable delays and ends in `completed`
 * (with a courier-style brief) or `voicemail` (1 in 4 chance, to make the
 * demo show a non-success path).
 */
class MockCallegate implements Callegate {
  private static timelines = new Map<
    string,
    { startedAt: number; phoneNumber: string; voicemail: boolean; seq: number }
  >();

  async createCall(input: CreateCallInput) {
    const id = `mock_${newId('').slice(1)}`;
    MockCallegate.timelines.set(id, {
      startedAt: Date.now(),
      phoneNumber: input.phoneNumber,
      voicemail: Math.random() < 0.18, // 18% → sometimes the demo shows voicemail path
      seq: 0,
    });
    return { calle_call_id: id };
  }

  async getCallStatus(callId: string): Promise<CallStatusResponse> {
    const tl = MockCallegate.timelines.get(callId);
    if (!tl) throw new Error(`unknown mock call ${callId}`);
    const elapsed = (Date.now() - tl.startedAt) / 1000;
    if (elapsed < 1) return { status: 'queued' };
    if (elapsed < 2) return { status: 'planning' };
    if (elapsed < 3) return { status: 'dialing' };
    if (tl.voicemail && elapsed > 6) {
      return {
        status: 'voicemail',
        structuredResult: {
          outcome: 'voicemail',
          summary_for_user: 'Reached voicemail — left a brief message. Will retry after 5 minutes.',
          facts: {},
          callee_role: 'voicemail',
        },
        completedAt: new Date().toISOString(),
      };
    }
    if (elapsed < 5) return { status: 'in_conversation' };
    if (elapsed < 18) return { status: 'in_conversation' };
    if (elapsed < 20) return { status: 'wrapping' };
    return {
      status: 'completed',
      structuredResult: {
        outcome: 'resolved',
        summary_for_user:
          'BlueDart confirmed AWB 8821 is out for delivery, expected by 4 PM today. Rider is +91 98765 43210 if you need to reach them directly.',
        facts: {
          tracking_number: 'AWB 8821',
          status: 'Out for delivery',
          expected_time: '4 PM today',
          rider_contact: '+91 98765 43210',
        },
        next_step: 'Track from 3:30 PM onward. The rider will call if anything slips.',
        callee_role: 'dispatcher',
      },
      transcriptExcerpt:
        'Surrogate: Hi, this is AfterHold calling on behalf of the user. Could you confirm AWB 8821?\nDispatcher: Yes, out for delivery, expected by 4 PM.\nSurrogate: Is there a rider I can reach directly?\nDispatcher: Sure — 98765 43210.\nSurrogate: Thank you.',
      completedAt: new Date().toISOString(),
    };
  }

  async getCallEvents(callId: string) {
    const tl = MockCallegate.timelines.get(callId);
    if (!tl) return [];
    const elapsed = (Date.now() - tl.startedAt) / 1000;
    const events: CallEvent[] = [
      { type: 'created', payload: { callId }, t: new Date(tl.startedAt).toISOString() },
    ];
    if (elapsed > 1) events.push({ type: 'planning', payload: {}, t: new Date(tl.startedAt + 1000).toISOString() });
    if (elapsed > 2) events.push({ type: 'dialing', payload: { to: tl.phoneNumber }, t: new Date(tl.startedAt + 2000).toISOString() });
    if (elapsed > 3) events.push({ type: 'connected', payload: {}, t: new Date(tl.startedAt + 3000).toISOString() });
    if (elapsed > 6) events.push({ type: 'transcript', payload: { role: 'surrogate', text: 'Hi, this is AfterHold calling on behalf of the user. Could you confirm AWB 8821?' }, t: new Date(tl.startedAt + 6000).toISOString() });
    if (elapsed > 8) events.push({ type: 'transcript', payload: { role: 'callee', text: 'Yes, out for delivery, expected by 4 PM.' }, t: new Date(tl.startedAt + 8000).toISOString() });
    if (elapsed > 11) events.push({ type: 'transcript', payload: { role: 'surrogate', text: 'Is there a rider I can reach directly?' }, t: new Date(tl.startedAt + 11000).toISOString() });
    if (elapsed > 13) events.push({ type: 'transcript', payload: { role: 'callee', text: 'Sure — 98765 43210.' }, t: new Date(tl.startedAt + 13000).toISOString() });
    if (elapsed > 16) events.push({ type: 'transcript', payload: { role: 'surrogate', text: 'Thank you.' }, t: new Date(tl.startedAt + 16000).toISOString() });
    if (elapsed > 20) events.push({ type: 'completed', payload: { outcome: 'resolved' }, t: new Date(tl.startedAt + 20000).toISOString() });
    return events;
  }
}

// Factory
export function makeCallegate(): Callegate {
  return env.CALLE_MOCK ? new MockCallegate() : new RealCallegate();
}
