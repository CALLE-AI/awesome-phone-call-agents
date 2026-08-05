import { describe, it, expect } from 'vitest';
import { flattenResult } from '../lib/flatten-result.js';

const event = {
  id: 'evt_1',
  type: 'call.completed',
  created_at: '2026-08-02T00:01:00Z',
  data: {
    id: 'call_1',
    object: 'call_task',
    status: 'completed',
    task: 'Call the on-call engineer.',
    task_completed: true,
    completion_confidence: { score: 0.92, label: 'high' },
    structured_result: { acknowledged: 'yes', notes: 'On it.' },
    summary: 'The engineer acknowledged the incident.',
    evidence: ['The engineer said yes.'],
    metadata: { correlation_id: 'incident-42', source_platform: 'zapier' },
    failure_code: null,
    failure_message: null,
    completed_at: '2026-08-02T00:01:00Z',
    recipients: [
      {
        id: 'rcp_1',
        phones: ['+15550123456'],
        status: 'completed',
        structured_result: { acknowledged: 'yes' },
        summary: 'Acknowledged.',
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

describe('flattenResult', () => {
  it('exposes the disposition and core fields', () => {
    const out = flattenResult(event);
    expect(out.disposition).toBe('confirmed');
    expect(out.is_actionable).toBe(true);
    expect(out.call_id).toBe('call_1');
    expect(out.status).toBe('completed');
    expect(out.correlation_id).toBe('incident-42');
    expect(out.confidence_label).toBe('high');
    expect(out.confidence_score).toBe(0.92);
  });

  it('lifts structured result fields to the top level with a prefix', () => {
    const out = flattenResult(event);
    expect(out.result_acknowledged).toBe('yes');
    expect(out.result_notes).toBe('On it.');
  });

  it('counts recipients by status', () => {
    const out = flattenResult(event);
    expect(out.recipients_total).toBe(1);
    expect(out.recipients_completed).toBe(1);
    expect(out.recipients_failed).toBe(0);
  });

  it('masks phone numbers everywhere they appear', () => {
    const serialized = JSON.stringify(flattenResult(event));
    expect(serialized).not.toContain('0123456');
    expect(serialized).toContain('+1******3456');
  });

  it('renders the transcript as readable text', () => {
    expect(flattenResult(event).transcript_text)
      .toBe('bot: Are you able to take this incident?\nuser: Yes, on it.');
  });

  it('masks a bare digit-run phone number in free text summary and transcript', () => {
    const bareDigitsEvent = {
      id: 'evt_3',
      type: 'call.completed',
      created_at: '2026-08-02T00:01:00Z',
      data: {
        id: 'call_3',
        object: 'call_task',
        status: 'completed',
        task: 'Reach the caller.',
        task_completed: true,
        completion_confidence: { score: 0.9, label: 'high' },
        structured_result: {},
        summary: 'Caller asked us to reach them on 15550123456 instead.',
        evidence: [],
        metadata: {},
        failure_code: null,
        failure_message: null,
        completed_at: '2026-08-02T00:01:00Z',
        recipients: [
          {
            id: 'rcp_3',
            phones: ['+15550123456'],
            status: 'completed',
            structured_result: {},
            summary: 'Left a message.',
            attempts: [
              {
                id: 'att_3',
                status: 'completed',
                transcript_turns: [
                  { offset_seconds: 0, speaker: 'user', text: 'my other number is 15550123456' },
                ],
              },
            ],
          },
        ],
      },
    };

    const serialized = JSON.stringify(flattenResult(bareDigitsEvent));
    expect(serialized).not.toContain('15550123456');
  });

  describe('review and compliance fields', () => {
    const eventWith = (turns, dataOverrides = {}) => ({
      id: 'evt_r',
      type: 'call.completed',
      data: {
        id: 'call_r',
        status: 'completed',
        task_completed: true,
        completion_confidence: { score: 0.9, label: 'high' },
        structured_result: { confirmed: 'yes' },
        recipients: [{ status: 'completed', attempts: [{ transcript_turns: turns }] }],
        ...dataOverrides,
      },
    });

    it('surfaces the last thing the recipient said when review is needed', () => {
      const out = flattenResult(
        eventWith(
          [
            { offset_seconds: 3, speaker: 'bot', text: 'Can you confirm Thursday?' },
            { offset_seconds: 7, speaker: 'user', text: 'I might be able to, not sure yet.' },
            { offset_seconds: 12, speaker: 'bot', text: 'Understood.' },
          ],
          { structured_result: { confirmed: 'unknown' } },
        ),
      );

      expect(out.disposition).toBe('review_required');
      expect(out.review_excerpt).toBe('I might be able to, not sure yet.');
      expect(out.review_excerpt_offset_seconds).toBe(7);
    });

    it('offers no excerpt for a confirmed call', () => {
      const out = flattenResult(
        eventWith([{ offset_seconds: 7, speaker: 'user', text: 'Yes, confirmed.' }]),
      );
      expect(out.disposition).toBe('confirmed');
      expect(out.review_excerpt).toBeNull();
      expect(out.review_excerpt_offset_seconds).toBeNull();
    });

    it('overrides a confirmed result when the recipient revoked consent', () => {
      const out = flattenResult(
        eventWith([
          { offset_seconds: 4, speaker: 'user', text: 'Yes fine, but stop calling me after this.' },
        ]),
      );

      expect(out.opt_out_requested).toBe(true);
      expect(out.is_actionable).toBe(false);
      expect(out.disposition).toBe('needs_human');
      expect(out.lead_state).toBe('blocked_compliance');
      // The extracted answer is still there for whoever handles it.
      expect(out.result_confirmed).toBe('yes');
    });

    it('assigns a lead_state to every result', () => {
      expect(flattenResult(eventWith([])).lead_state).toBe('qualified');
      expect(
        flattenResult(eventWith([], { status: 'failed', failure_code: 'no_answer' })).lead_state,
      ).toBe('needs_human');
    });

    // Regression: two safety checks - the opt-out scan and the review
    // excerpt - read `recipients`. When it is present but unreadable, both
    // silently find nothing, and `opt_out_requested: false` stops meaning
    // "no revocation" and starts meaning "I could not look". A call whose
    // transcript could not be read must not be actionable.
    it('refuses to confirm a payload whose transcript could not be read', () => {
      for (const recipients of ['nope', 42, { 0: 'x' }, true]) {
        const out = flattenResult(eventWith([], { recipients }));
        expect(out.disposition, JSON.stringify(recipients)).toBe('review_required');
        expect(out.is_actionable).toBe(false);
        expect(out.lead_state).toBe('needs_human');
        expect(out.disposition_reason).toMatch(/transcript|recipient/i);
      }
    });

    it('still confirms when the recipients array is legitimately empty', () => {
      const out = flattenResult(eventWith([], { recipients: [] }));
      expect(out.disposition).toBe('confirmed');
    });

    it('still confirms when recipients is absent entirely', () => {
      const event = eventWith([]);
      delete event.data.recipients;
      expect(flattenResult(event).disposition).toBe('confirmed');
    });

    // The excerpt fields are transcript text, so they carry the same leak
    // risk as transcript_text and must go through the same masking.
    it('masks a phone number spoken inside an excerpt', () => {
      const out = flattenResult(
        eventWith([
          { offset_seconds: 4, speaker: 'user', text: 'Stop calling, try +15550123456 instead.' },
        ]),
      );
      expect(out.opt_out_excerpt).not.toContain('5550123456');
      expect(JSON.stringify(out)).not.toContain('15550123456');
    });
  });

  it('does not throw on a minimal failure event', () => {
    const out = flattenResult({
      id: 'evt_2',
      type: 'call.failed',
      data: { id: 'call_2', status: 'failed', failure_code: 'provider_error', recipients: [] },
    });
    expect(out.disposition).toBe('failed');
    expect(out.failure_code).toBe('provider_error');
    expect(out.recipients_total).toBe(0);
    expect(out.transcript_text).toBe('');
  });
});
