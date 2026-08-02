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
