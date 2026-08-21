import type { Call, CreateCallInput } from '@call-e/calle';
import { describe, expect, it } from 'vitest';
import {
  dispatchLiveRun,
  sanitizeCall,
  type CreateCall,
} from '../src/lib/calle-server';
import type {
  ContactRole,
  CoordinationResult,
  LiveRunInput,
} from '../src/lib/domain';
import { completedDemoCalls } from '../src/lib/demo';

const alignedResult: CoordinationResult = {
  contact_outcome: 'reached',
  commitment: 'confirmed',
  schedule_alignment: 'matched',
  scope_alignment: 'matched',
  reported_time: '06:30',
  blocker: '',
  evidence_summary: 'Explicitly confirmed.',
};

function liveInput(): LiveRunInput {
  return {
    runId: 'run-12345678',
    liveConfirmed: true,
    plan: {
      companyName: 'Northstar Concrete',
      projectName: 'Harbour Point',
      location: 'Tuas South',
      scheduledDate: '2026-09-03',
      scheduledTime: '06:30',
      volumeM3: '85',
      mixReference: 'C40 / P-217',
      region: 'SG',
    },
    contacts: [
      { role: 'site_supervisor', name: 'A', phone: '+6581234567' },
      { role: 'ready_mix_dispatch', name: 'B', phone: '+6581234568' },
      { role: 'pump_operator', name: 'C', phone: '+6581234569' },
      { role: 'testing_coordinator', name: 'D', phone: '+6581234570' },
    ],
  };
}

function call(
  role: ContactRole,
  phone: string,
  overrides: Partial<Call> = {},
): Call {
  return {
    id: 'call_' + role,
    object: 'call_task',
    status: 'queued',
    task: 'private task text',
    recipients: [
      {
        id: 'recipient_1',
        phones: [phone],
        locale: 'en-SG',
        region: 'SG',
        status: 'pending',
        structuredResult: null,
        summary: null,
        attempts: [],
      },
    ],
    structuredResult: null,
    summary: null,
    taskCompleted: null,
    completionConfidence: null,
    evidence: [],
    metadata: { run_id: 'run-12345678', role },
    failureCode: null,
    failureMessage: null,
    createdAt: '2026-08-21T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

describe('CALL-E dispatch and sanitization', () => {
  it('preserves successful call ids after a partial dispatch failure', async () => {
    const seenKeys: string[] = [];
    const create: CreateCall = async (
      payload: CreateCallInput,
      options,
    ) => {
      const role = payload.metadata?.role as ContactRole;
      seenKeys.push(options?.idempotencyKey || '');
      if (role === 'pump_operator') throw new Error('provider details');
      const phone = payload.recipient?.phone || '';
      return call(role, phone);
    };

    const snapshots = await dispatchLiveRun(liveInput(), create);
    expect(snapshots.filter((item) => item.callId)).toHaveLength(3);
    expect(
      snapshots.find((item) => item.role === 'pump_operator'),
    ).toMatchObject({
      status: 'failed',
      maskedPhone: '•••• 4569',
      failureCode: 'dispatch_failed',
    });
    expect(seenKeys).toContain('pour-ready:run-12345678:site_supervisor');
    expect(JSON.stringify(snapshots)).not.toContain('+658123');
  });

  it('masks recipients and redacts phone numbers from evidence', () => {
    const completed = call('site_supervisor', '+6581234567', {
      status: 'completed',
      structuredResult: alignedResult,
      taskCompleted: true,
      completionConfidence: { score: 0.97, label: 'high' },
      evidence: ['Confirmed from +65 8123 4567 at 06:30.'],
      recipients: [
        {
          id: 'recipient_1',
          phones: ['+6581234567'],
          locale: 'en-SG',
          region: 'SG',
          status: 'completed',
          structuredResult: null,
          summary: null,
          attempts: [
            {
              id: 'attempt_1',
              phone: '+6581234567',
              status: 'completed',
              startedAt: '2026-08-21T00:00:00.000Z',
              completedAt: '2026-08-21T00:01:00.000Z',
              summary: null,
              transcriptTurns: [
                {
                  offset_seconds: 3,
                  speaker: 'user',
                  text: 'Call me on +65 8123 4567.',
                },
              ],
              providerCallId: null,
              failureCode: null,
              failureMessage: null,
            },
          ],
        },
      ],
    });

    const snapshot = sanitizeCall(completed, 'run-12345678');
    expect(snapshot.status).toBe('completed');
    expect(snapshot.maskedPhone).toBe('•••• 4567');
    expect(JSON.stringify(snapshot)).not.toContain('+65');
    expect(snapshot.evidence[0]).toContain('[redacted phone]');
  });

  it('treats low-confidence output as incomplete', () => {
    const snapshot = sanitizeCall(
      call('site_supervisor', '+6581234567', {
        status: 'completed',
        structuredResult: alignedResult,
        taskCompleted: true,
        completionConfidence: { score: 0.55, label: 'low' },
      }),
      'run-12345678',
    );
    expect(snapshot.status).toBe('incomplete');
  });

  it('treats contradictory structured output as incomplete', () => {
    const snapshot = sanitizeCall(
      call('site_supervisor', '+6581234567', {
        status: 'completed',
        structuredResult: {
          ...alignedResult,
          contact_outcome: 'voicemail',
        },
        taskCompleted: true,
        completionConfidence: { score: 0.98, label: 'high' },
      }),
      'run-12345678',
    );
    expect(snapshot.status).toBe('incomplete');
    expect(snapshot.result).toBeNull();
  });

  it('runs dry fixtures without CALL-E credentials', () => {
    const before = process.env.CALLE_API_KEY;
    delete process.env.CALLE_API_KEY;
    expect(completedDemoCalls(liveInput().plan)).toHaveLength(4);
    if (before) process.env.CALLE_API_KEY = before;
  });
});
