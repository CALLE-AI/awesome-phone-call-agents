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

  it('exports exactly the ten documented dispositions', () => {
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
      'retry_policy_blocked',
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

  // CALL-E's own schema guidance tells authors to add an `unknown` enum
  // member for calls that cannot produce evidence, and the sibling
  // calle-script-advisor skill lints for exactly that. Treating the value it
  // told them to add as a success would make the two halves of this
  // contribution contradict each other.
  describe('unusable structured results', () => {
    it('refuses to confirm a result whose fields all came back unknown', () => {
      const result = deriveDisposition(
        event({}, { structured_result: { qualified: 'unknown', interest: 'unclear' } }),
      );
      expect(result.disposition).toBe('review_required');
      expect(result.is_actionable).toBe(false);
      expect(result.reason).toContain('qualified');
    });

    it('refuses to confirm a result whose fields are all null or empty', () => {
      for (const value of [{ a: null }, { a: '' }, { a: [] }, { a: {} }, { a: '   ' }]) {
        expect(deriveDisposition(event({}, { structured_result: value })).disposition)
          .toBe('review_required');
      }
    });

    it('treats false and 0 as real extracted answers, not as empty', () => {
      expect(deriveDisposition(event({}, { structured_result: { attending: false } })).disposition)
        .toBe('confirmed');
      expect(deriveDisposition(event({}, { structured_result: { count: 0 } })).disposition)
        .toBe('confirmed');
    });

    it('refuses to confirm when a field the caller declared required is absent', () => {
      const schema = { type: 'object', required: ['qualified'], properties: { qualified: {} } };
      const result = deriveDisposition(
        event({}, { structured_result: { notes: 'they were vague' } }),
        { resultSchema: schema },
      );
      expect(result.disposition).toBe('review_required');
      expect(result.reason).toContain('was not returned');
    });

    it('ignores an unknown value in a field the caller did not require', () => {
      const schema = { type: 'object', required: ['qualified'] };
      const result = deriveDisposition(
        event({}, { structured_result: { qualified: 'yes', notes: 'unknown' } }),
        { resultSchema: schema },
      );
      expect(result.disposition).toBe('confirmed');
    });

    it('checks required fields nested inside required objects', () => {
      const schema = {
        type: 'object',
        required: ['appointment'],
        properties: { appointment: { type: 'object', required: ['time'] } },
      };
      const result = deriveDisposition(
        event({}, { structured_result: { appointment: { time: 'unknown' } } }),
        { resultSchema: schema },
      );
      expect(result.disposition).toBe('review_required');
      expect(result.reason).toContain('appointment.time');
    });

    it('without a schema, still catches an unknown value it can see', () => {
      expect(
        deriveDisposition(event({}, { structured_result: { qualified: 'UNKNOWN' } })).disposition,
      ).toBe('review_required');
    });
  });

  describe('confidence score floor', () => {
    it('refuses to confirm a high label carrying a low score', () => {
      const result = deriveDisposition(
        event({}, { completion_confidence: { label: 'high', score: 0.05 } }),
      );
      expect(result.disposition).toBe('review_required');
      expect(result.reason).toContain('0.05');
    });

    it('refuses to confirm when a terminal result carries no numeric score', () => {
      for (const confidence of [{ label: 'high' }, { label: 'high', score: 'high' }, { label: 'high', score: NaN }]) {
        expect(deriveDisposition(event({}, { completion_confidence: confidence })).disposition)
          .toBe('review_required');
      }
    });

    it('honors an explicit floor of 0 as label-only classification', () => {
      const result = deriveDisposition(
        event({}, { completion_confidence: { label: 'high' } }),
        { minConfidenceScore: 0 },
      );
      expect(result.disposition).toBe('confirmed');
    });

    it('applies a caller-supplied floor above the default', () => {
      const strict = { minConfidenceScore: 0.95 };
      expect(deriveDisposition(event(), strict).disposition).toBe('review_required');
      expect(deriveDisposition(event()).disposition).toBe('confirmed');
    });
  });

  describe('transcript grounding', () => {
    const said = (text) => [
      { attempts: [{ transcript_turns: [{ offset_seconds: 4, speaker: 'user', text }] }] },
    ];

    it('confirms an answer the recipient is recorded as having given', () => {
      const grounded = event({}, {
        structured_result: { confirmed: 'yes', confirmed_quote: 'yes that works for me' },
        recipients: said('Yes, that works for me.'),
      });
      expect(deriveDisposition(grounded).disposition).toBe('confirmed');
    });

    // Every gate above this one passes: terminal status, task_completed,
    // high confidence with a 0.92 score, and a populated structured result
    // carrying no unknown-like value. Only the transcript disagrees.
    it('refuses an otherwise-perfect result whose quote was never spoken', () => {
      const invented = event({}, {
        structured_result: { confirmed: 'yes', confirmed_quote: 'absolutely, sign us up today' },
        recipients: said('I need to think about it.'),
      });
      const result = deriveDisposition(invented);
      expect(result.disposition).toBe('review_required');
      expect(result.is_actionable).toBe(false);
      expect(result.reason).toContain('confirmed');
    });

    it('leaves a schema that never asked for quotes classified as before', () => {
      const noQuotes = event({}, { recipients: said('I need to think about it.') });
      expect(deriveDisposition(noQuotes).disposition).toBe('confirmed');
    });
  });
});

// The gap this closes: a schema can declare `<field>_quote` without making it
// required, and a model that omits it produced no key for the grounding check
// to examine - so the answer passed ungrounded. The schema, written before
// the call, is what says evidence was owed.
describe('grounding against the declared schema', () => {
  const schema = {
    type: 'object',
    properties: {
      confirmed: { type: 'string', enum: ['yes', 'no', 'unknown'] },
      confirmed_quote: { type: 'string' },
    },
    required: ['confirmed'],
  };

  const eventWith = (structured) => ({
    id: 'evt_1',
    type: 'call.completed',
    data: {
      id: 'call_1',
      status: 'completed',
      task_completed: true,
      completion_confidence: { score: 0.95, label: 'high' },
      structured_result: structured,
      recipients: [
        {
          attempts: [
            {
              transcript_turns: [
                { offset_seconds: 0, speaker: 'bot', text: 'Can you make Friday?' },
                { offset_seconds: 4, speaker: 'user', text: 'Yes, Friday works for me.' },
              ],
            },
          ],
        },
      ],
    },
  });

  it('refuses an answer whose declared quote the model never returned', () => {
    const derived = deriveDisposition(eventWith({ confirmed: 'yes' }), { resultSchema: schema });
    expect(derived.disposition).toBe('review_required');
    expect(derived.is_actionable).toBe(false);
    expect(derived.reason).toMatch(/without the supporting quote/);
  });

  it('confirms the same call once the quote is returned and was spoken', () => {
    const derived = deriveDisposition(
      eventWith({ confirmed: 'yes', confirmed_quote: 'Yes, Friday works for me.' }),
      { resultSchema: schema },
    );
    expect(derived.disposition).toBe('confirmed');
    expect(derived.is_actionable).toBe(true);
  });

  it('leaves a schema that asked for no quotes classified as before', () => {
    const plain = {
      type: 'object',
      properties: { confirmed: { type: 'string' } },
      required: ['confirmed'],
    };
    const derived = deriveDisposition(eventWith({ confirmed: 'yes' }), { resultSchema: plain });
    expect(derived.disposition).toBe('confirmed');
  });
});
