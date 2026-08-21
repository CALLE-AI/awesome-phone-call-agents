import { describe, expect, it } from 'vitest';
import {
  type CallSnapshot,
  type ContactRole,
  type CoordinationResult,
  ROLES,
} from '../src/lib/domain';
import { reconcile } from '../src/lib/reconcile';

function result(
  overrides: Partial<CoordinationResult> = {},
): CoordinationResult {
  return {
    contact_outcome: 'reached',
    commitment: 'confirmed',
    schedule_alignment: 'matched',
    scope_alignment: 'matched',
    reported_time: '06:30',
    blocker: '',
    evidence_summary: 'Explicit confirmation.',
    ...overrides,
  };
}

function call(
  role: ContactRole,
  overrides: Partial<CallSnapshot> = {},
): CallSnapshot {
  return {
    role,
    callId: 'call_' + role,
    maskedPhone: '•••• 1234',
    status: 'completed',
    result: result(),
    taskCompleted: true,
    completionConfidence: { score: 0.96, label: 'high' },
    evidence: [],
    transcriptTurns: [],
    ...overrides,
  };
}

function alignedCalls() {
  return ROLES.map((role) => call(role));
}

describe('reconcile', () => {
  it('returns aligned only for four explicit high-confidence confirmations', () => {
    expect(reconcile(alignedCalls()).state).toBe('aligned');
  });

  it('finds an explicit time conflict', () => {
    const calls = alignedCalls();
    calls[2] = call('pump_operator', {
      result: result({
        schedule_alignment: 'conflict',
        reported_time: '08:00',
      }),
    });
    expect(reconcile(calls)).toMatchObject({
      state: 'conflict',
      conflicts: expect.arrayContaining([
        'Pump operator reported 08:00.',
      ]),
    });
  });

  it('finds an explicit scope conflict', () => {
    const calls = alignedCalls();
    calls[1] = call('ready_mix_dispatch', {
      result: result({ scope_alignment: 'conflict' }),
    });
    expect(reconcile(calls).state).toBe('conflict');
  });

  it('treats a conditional commitment as a conflict', () => {
    const calls = alignedCalls();
    calls[2] = call('pump_operator', {
      result: result({ commitment: 'conditional' }),
    });
    expect(reconcile(calls).state).toBe('conflict');
  });

  it('treats null output as incomplete', () => {
    const calls = alignedCalls();
    calls[0] = call('site_supervisor', { result: null, status: 'incomplete' });
    expect(reconcile(calls).state).toBe('incomplete');
  });

  it('treats voicemail as incomplete', () => {
    const calls = alignedCalls();
    calls[3] = call('testing_coordinator', {
      status: 'incomplete',
      result: result({
        contact_outcome: 'voicemail',
        commitment: 'unknown',
        schedule_alignment: 'unknown',
        scope_alignment: 'unknown',
      }),
    });
    expect(reconcile(calls).state).toBe('incomplete');
  });

  it('treats a failed call as incomplete', () => {
    const calls = alignedCalls();
    calls[1] = call('ready_mix_dispatch', {
      status: 'failed',
      result: null,
      taskCompleted: false,
    });
    expect(reconcile(calls).state).toBe('incomplete');
  });

  it('treats low confidence as incomplete', () => {
    const calls = alignedCalls();
    calls[0] = call('site_supervisor', {
      completionConfidence: { score: 0.61, label: 'low' },
    });
    expect(reconcile(calls).state).toBe('incomplete');
  });

  it('keeps conflict precedence while exposing pending roles', () => {
    const calls = alignedCalls();
    calls[2] = call('pump_operator', {
      result: result({
        schedule_alignment: 'conflict',
        reported_time: '08:00',
      }),
    });
    calls[3] = call('testing_coordinator', {
      status: 'calling',
      result: null,
      taskCompleted: null,
    });
    const state = reconcile(calls);
    expect(state.state).toBe('conflict');
    expect(state.incompleteRoles).toContain('testing_coordinator');
  });
});
