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

  it('exports exactly the nine documented dispositions', () => {
    expect(DISPOSITIONS).toEqual([
      'confirmed',
      'review_required',
      'result_invalid',
      'failed',
      'canceled',
      'outcome_unknown',
      'needs_human',
      'outside_calling_window',
      'suppressed',
    ]);
  });

  it('never treats a falsy or empty structured result as confirmed', () => {
    for (const value of [false, 0, '', [], {}, NaN]) {
      const result = deriveDisposition(event({}, { structured_result: value }));
      expect(result.disposition).toBe('review_required');
      expect(result.is_actionable).toBe(false);
    }
  });

  it('returns needs_human instead of throwing when a property access throws', () => {
    const hostile = event();
    Object.defineProperty(hostile.data, 'status', {
      get() { throw new Error('boom'); },
      configurable: true,
    });
    expect(() => deriveDisposition(hostile)).not.toThrow();
    expect(deriveDisposition(hostile).disposition).toBe('needs_human');
  });

  it('returns needs_human when failure_code stringification throws', () => {
    const hostile = event({ type: 'call.failed' }, {
      status: 'failed',
      failure_code: { toString() { throw new Error('boom'); } },
    });
    expect(() => deriveDisposition(hostile)).not.toThrow();
    expect(deriveDisposition(hostile).disposition).toBe('needs_human');
  });

  it('ignores inherited properties when classifying', () => {
    const inherited = Object.create({
      status: 'completed',
      task_completed: true,
      completion_confidence: { label: 'high' },
      structured_result: { a: 1 },
    });
    expect(deriveDisposition({ id: 'e', type: 'call.completed', data: inherited }).disposition)
      .toBe('needs_human');
  });

  it('caps untrusted values echoed into the reason', () => {
    const long = 'x'.repeat(500);
    const result = deriveDisposition(event({ type: 'call.failed' }, { status: 'failed', failure_code: long }));
    expect(result.reason.length).toBeLessThan(300);
  });

  it('exposes DISPOSITIONS as a frozen array', () => {
    expect(Object.isFrozen(DISPOSITIONS)).toBe(true);
  });
});
