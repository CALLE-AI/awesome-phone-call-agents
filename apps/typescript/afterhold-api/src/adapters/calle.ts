/**
 * CALLE adapter.
 *
 * Two implementations:
 *  - real: raw HTTPS to the approved ${CALLE_BASE_URL} origin (see lib/env.ts)
 *    using the documented call-task contract:
 *      POST /v1/calls        { task, recipients: [{ phones, region, locale }], result_schema, metadata }
 *      GET  /v1/calls/{id}   poll until a terminal status
 *  - mock: scripted phase timeline. No network. No call placed. This is the default.
 *
 * Caller (worker) only cares about the Callegate interface — never look at
 * env inside the worker.
 */

import { env } from '../lib/env.js';
import { request } from 'undici';
import { maskPhones, newId } from '../lib/util.js';

export interface Callegate {
  /**
   * Create the call. Returns the call id assigned by CALL-E.
   * Throws CalleSubmitError; `ambiguous` says whether the call may have been created anyway.
   */
  createCall(input: CreateCallInput): Promise<{ calle_call_id: string }>;
  /** Poll for status. Returns terminal status if reached, plus transcript/result if available. */
  getCallStatus(callId: string): Promise<CallStatusResponse>;
}

export interface CreateCallInput {
  task: string;
  resultSchema: object;
  phoneNumber: string; // E.164
  region: string | null; // ISO 3166-1 alpha-2, required for live calls
  language?: string;
  idempotencyKey: string;
  missionId: string;
}

export interface CallStatusResponse {
  status: 'queued' | 'planning' | 'dialing' | 'in_conversation' | 'wrapping' | 'completed' | 'voicemail' | 'unavailable' | 'refused' | 'failed' | 'canceled';
  structuredResult?: any;
  transcriptExcerpt?: string;
  completedAt?: string;
  errorMessage?: string;
}

/**
 * A failed create. `ambiguous: true` means the request may have reached CALL-E
 * (timeout, connection reset, 5xx, unreadable response), so the call may exist.
 * `ambiguous: false` means CALL-E answered with a definite 4xx rejection.
 */
export class CalleSubmitError extends Error {
  constructor(message: string, readonly ambiguous: boolean) {
    super(maskPhones(message));
  }
}

// ── Real implementation ────────────────────────────────────────────────

const TERMINAL_OK = new Set(['succeeded', 'completed']);
const TERMINAL_FAILED = new Set(['failed', 'error']);
const TERMINAL_CANCELED = new Set(['canceled', 'cancelled']);
const PENDING = new Set(['queued', 'pending', 'scheduled', 'created']);

const TIMEOUTS = { headersTimeout: 30_000, bodyTimeout: 30_000 } as const;

class RealCallegate implements Callegate {
  private baseHeaders() {
    // env.ts already refused to boot in live mode without a key or with an unapproved origin.
    return {
      Authorization: `Bearer ${env.CALLE_API_KEY}`,
      'Content-Type': 'application/json',
    } as const;
  }

  async createCall(input: CreateCallInput) {
    if (!input.region) throw new CalleSubmitError('recipient region is required for live calls', false);
    const recipient: Record<string, unknown> = { phones: [input.phoneNumber], region: input.region };
    if (input.language) recipient.locale = input.language;

    let res;
    try {
      res = await request(`${env.CALLE_BASE_URL}/v1/calls`, {
        method: 'POST',
        headers: { ...this.baseHeaders(), 'Idempotency-Key': input.idempotencyKey },
        body: JSON.stringify({
          task: input.task,
          recipients: [recipient],
          result_schema: input.resultSchema,
          metadata: { afterhold_mission_id: input.missionId },
        }),
        maxRedirections: 0,
        ...TIMEOUTS,
      });
    } catch (e) {
      throw new CalleSubmitError(`could not confirm CALL-E create: ${(e as Error).message}`, true);
    }

    if (res.statusCode >= 400) {
      const body = await res.body.text().catch(() => '');
      // 4xx is a definite rejection; 5xx (or anything odd) may still have created the call.
      throw new CalleSubmitError(`CALL-E createCall ${res.statusCode}: ${body.slice(0, 300)}`, res.statusCode >= 500);
    }
    let json: any;
    try {
      json = await res.body.json();
    } catch {
      throw new CalleSubmitError('CALL-E createCall returned an unreadable body', true);
    }
    const id = json?.id ?? json?.call_id;
    if (typeof id !== 'string' || !id) throw new CalleSubmitError('CALL-E createCall response had no call id', true);
    return { calle_call_id: id };
  }

  async getCallStatus(callId: string): Promise<CallStatusResponse> {
    const res = await request(`${env.CALLE_BASE_URL}/v1/calls/${encodeURIComponent(callId)}`, {
      method: 'GET',
      headers: this.baseHeaders(),
      maxRedirections: 0,
      ...TIMEOUTS,
    });
    if (res.statusCode >= 400) {
      await res.body.text().catch(() => '');
      throw new Error(`CALL-E getCallStatus ${res.statusCode}`);
    }
    const json = (await res.body.json()) as any;
    const raw = String(json.status ?? '').toLowerCase();
    const recipient = Array.isArray(json.recipients) ? json.recipients[0] : undefined;
    const structuredResult = json.structured_result ?? recipient?.structured_result;
    const transcriptExcerpt = typeof json.transcript === 'string' ? json.transcript : undefined;
    const base = { structuredResult, transcriptExcerpt, completedAt: json.completed_at };

    if (TERMINAL_OK.has(raw)) return { status: 'completed', ...base };
    if (TERMINAL_CANCELED.has(raw)) return { status: 'canceled', ...base };
    if (TERMINAL_FAILED.has(raw)) {
      return { status: 'failed', ...base, errorMessage: json.failure_message ?? json.failure_code ?? 'Call failed.' };
    }
    // Anything that is not a published terminal status is still open.
    return { status: PENDING.has(raw) ? 'queued' : 'in_conversation' };
  }
}

// ── Mock implementation ────────────────────────────────────────────────

/**
 * Mock state machine. We store a small in-memory map of mock-call timelines.
 * Each call walks the phases with believable delays and ends in `completed`
 * (with a courier-style brief) or `voicemail` (roughly 1 in 5, to make the
 * demo show a non-success path). All phone numbers are fictional 555-01xx.
 */
class MockCallegate implements Callegate {
  private static timelines = new Map<string, { startedAt: number; voicemail: boolean }>();

  async createCall(_input: CreateCallInput) {
    const id = `mock_${newId('').slice(1)}`;
    MockCallegate.timelines.set(id, {
      startedAt: Date.now(),
      voicemail: Math.random() < 0.18, // 18% → sometimes the demo shows voicemail path
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
          summary_for_user: 'Reached voicemail and left a brief message. Nothing was confirmed.',
          facts: {},
          callee_role: 'voicemail',
        },
        completedAt: new Date().toISOString(),
      };
    }
    if (elapsed < 18) return { status: 'in_conversation' };
    if (elapsed < 20) return { status: 'wrapping' };
    return {
      status: 'completed',
      structuredResult: {
        outcome: 'resolved',
        summary_for_user:
          'The courier confirmed AWB 8821 is out for delivery, expected by 4 PM today. Rider is +1 202 555 0199 if you need to reach them directly.',
        facts: {
          tracking_number: 'AWB 8821',
          status: 'Out for delivery',
          expected_time: '4 PM today',
          rider_contact: '+1 202 555 0199',
        },
        next_step: 'Track from 3:30 PM onward. The rider will call if anything slips.',
        callee_role: 'dispatcher',
      },
      transcriptExcerpt:
        'Surrogate: Hi, this is AfterHold calling on behalf of the user. Could you confirm AWB 8821?\nDispatcher: Yes, out for delivery, expected by 4 PM.\nSurrogate: Is there a rider I can reach directly?\nDispatcher: Sure — 202 555 0199.\nSurrogate: Thank you.',
      completedAt: new Date().toISOString(),
    };
  }
}

// Factory
export function makeCallegate(): Callegate {
  return env.CALLE_MOCK ? new MockCallegate() : new RealCallegate();
}
