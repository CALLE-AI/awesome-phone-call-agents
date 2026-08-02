import { describe, it, expect } from 'vitest';
import { deriveDisposition, DISPOSITIONS } from '../lib/disposition.js';

const event = (overrides = {}, dataOverrides = {}) => ({
  id: 'evt_1',
  type: 'call.completed',
  created_at: '2026-08-02T00:01:00Z',
  ...overrides,
  data: {
    id: 'call_1',
    object: 'call_task',
    status: 'completed',
    task_completed: true,
    completion_confidence: { score: 0.92, label: 'high' },
    structured_result: { confirmed: 'yes' },
    failure_code: null,
    failure_message: null,
    recipients: [],
    ...dataOverrides,
  },
});

describe('deriveDisposition', () => {
  it('returns confirmed only when every signal agrees', () => {
    const result = deriveDisposition(event());
    expect(result.disposition).toBe('confirmed');
    expect(result.is_actionable).toBe(true);
  });

  it('returns review_required when the task did not complete', () => {
    expect(deriveDisposition(event({}, { task_completed: false })).disposition)
      .toBe('review_required');
  });

  it('returns review_required when confidence is not high', () => {
    const low = event({}, { completion_confidence: { score: 0.4, label: 'low' } });
    expect(deriveDisposition(low).disposition).toBe('review_required');
  });

  it('returns review_required when the structured result is null', () => {
    expect(deriveDisposition(event({}, { structured_result: null })).disposition)
      .toBe('review_required');
  });

  it('returns result_invalid for a validation-failure event', () => {
    expect(deriveDisposition(event({ type: 'call.result_validation_failed' })).disposition)
      .toBe('result_invalid');
  });

  it('returns failed for a call.failed event', () => {
    const failure = event(
      { type: 'call.failed' },
      { status: 'failed', task_completed: false, failure_code: 'provider_error' },
    );
    const result = deriveDisposition(failure);
    expect(result.disposition).toBe('failed');
    expect(result.reason).toContain('provider_error');
  });

  it('returns failed when status is failed even on a completed event type', () => {
    expect(deriveDisposition(event({}, { status: 'failed' })).disposition).toBe('failed');
  });

  it('returns canceled when the call was canceled', () => {
    expect(deriveDisposition(event({}, { status: 'canceled' })).disposition).toBe('canceled');
  });

  it('returns outcome_unknown for a non-terminal status', () => {
    expect(deriveDisposition(event({}, { status: 'in_progress' })).disposition)
      .toBe('outcome_unknown');
    expect(deriveDisposition(event({}, { status: 'queued' })).disposition)
      .toBe('outcome_unknown');
  });

  it('returns needs_human for an unrecognized status', () => {
    expect(deriveDisposition(event({}, { status: 'COMPLETED' })).disposition).toBe('needs_human');
    expect(deriveDisposition(event({}, { status: 'no_answer' })).disposition).toBe('needs_human');
  });

  it('returns needs_human for an unrecognized event type', () => {
    expect(deriveDisposition(event({ type: 'call.exploded' })).disposition).toBe('needs_human');
  });

  it('returns needs_human when required fields are missing', () => {
    expect(deriveDisposition({ id: 'evt_1', type: 'call.completed' }).disposition)
      .toBe('needs_human');
    expect(deriveDisposition(null).disposition).toBe('needs_human');
  });

  it('never marks anything but confirmed as actionable', () => {
    const dispositions = [
      deriveDisposition(event({}, { task_completed: false })),
      deriveDisposition(event({ type: 'call.failed' }, { status: 'failed' })),
      deriveDisposition(event({}, { status: 'canceled' })),
      deriveDisposition(event({ type: 'call.exploded' })),
      deriveDisposition(event({ type: 'call.result_validation_failed' })),
      deriveDisposition(event({}, { status: 'in_progress' })),
    ];
    expect(dispositions.every((entry) => entry.is_actionable === false)).toBe(true);
  });

  it('exports exactly the seven documented dispositions', () => {
    expect(DISPOSITIONS).toEqual([
      'confirmed',
      'review_required',
      'result_invalid',
      'failed',
      'canceled',
      'outcome_unknown',
      'needs_human',
    ]);
  });
});
