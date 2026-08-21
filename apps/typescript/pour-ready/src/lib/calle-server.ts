import {
  CalleClient,
  type Call,
  type CreateCallInput,
} from '@call-e/calle';
import {
  type CallSnapshot,
  type ContactRole,
  type LiveRunInput,
  isRole,
  maskPhone,
  parseCoordinationResult,
  redactText,
  REGION_CONFIG,
} from './domain';
import { buildCallTask, COORDINATION_RESULT_SCHEMA } from './tasks';
import { idempotencyKey } from './validation';

export type CreateCall = (
  input: CreateCallInput,
  options?: { idempotencyKey?: string },
) => Promise<Call>;

export function getCalleClient(): CalleClient {
  const apiKey = process.env.CALLE_API_KEY?.trim();
  if (!apiKey) throw new Error('CALLE_API_KEY is not configured');
  return new CalleClient({ apiKey });
}

function safeFailureCode(value: unknown, fallback = 'call_failed'): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 48);
  return normalized || fallback;
}

function terminalSnapshot(
  role: ContactRole,
  maskedPhone: string,
  failureCode: string,
): CallSnapshot {
  return {
    role,
    maskedPhone,
    status: 'failed',
    result: null,
    taskCompleted: false,
    completionConfidence: null,
    evidence: [],
    transcriptTurns: [],
    failureCode,
  };
}

export async function dispatchLiveRun(
  input: LiveRunInput,
  createCall: CreateCall,
): Promise<CallSnapshot[]> {
  const region = REGION_CONFIG[input.plan.region];

  return Promise.all(
    input.contacts.map(async (contact) => {
      try {
        const call = await createCall(
          {
            task: buildCallTask(input.plan, contact),
            recipient: {
              phone: contact.phone,
              region: input.plan.region,
              locale: region.locale,
            },
            resultSchema: COORDINATION_RESULT_SCHEMA as unknown as Record<
              string,
              unknown
            >,
            metadata: {
              run_id: input.runId,
              role: contact.role,
            },
          },
          { idempotencyKey: idempotencyKey(input.runId, contact.role) },
        );
        return sanitizeCall(call, input.runId);
      } catch {
        return terminalSnapshot(
          contact.role,
          maskPhone(contact.phone),
          'dispatch_failed',
        );
      }
    }),
  );
}

function statusFor(call: Call, resultIsUsable: boolean): CallSnapshot['status'] {
  if (call.status === 'queued') return 'queued';
  if (call.status === 'in_progress') return 'calling';
  if (call.status === 'failed' || call.status === 'canceled') return 'failed';
  return resultIsUsable ? 'completed' : 'incomplete';
}

function firstPhone(call: Call): string {
  const recipient = call.recipients[0];
  return (
    recipient?.phones[0] ??
    recipient?.attempts.find((attempt) => attempt.phone)?.phone ??
    ''
  );
}

export function sanitizeCall(call: Call, expectedRunId: string): CallSnapshot {
  const role = call.metadata.role;
  if (call.metadata.run_id !== expectedRunId || !isRole(role)) {
    throw new Error('Call does not belong to this PourReady run');
  }

  const parsedResult = parseCoordinationResult(call.structuredResult);
  const highConfidence =
    call.completionConfidence?.label.toLowerCase() === 'high';
  const resultIsUsable =
    call.status === 'completed' &&
    call.taskCompleted === true &&
    highConfidence &&
    parsedResult?.contact_outcome === 'reached' &&
    parsedResult.commitment !== 'unknown' &&
    parsedResult.schedule_alignment !== 'unknown' &&
    parsedResult.scope_alignment !== 'unknown';

  const transcriptTurns = call.recipients
    .flatMap((recipient) => recipient.attempts)
    .flatMap((attempt) => attempt.transcriptTurns)
    .map((turn) => ({
      offsetSeconds: turn.offset_seconds ?? 0,
      speaker: turn.speaker,
      text: redactText(turn.text),
    }))
    .filter((turn) => turn.text)
    .slice(0, 24);

  return {
    role,
    callId: call.id,
    maskedPhone: maskPhone(firstPhone(call)),
    status: statusFor(call, Boolean(resultIsUsable)),
    result: parsedResult,
    taskCompleted: call.taskCompleted,
    completionConfidence: call.completionConfidence,
    evidence: call.evidence.map(redactText).filter(Boolean).slice(0, 8),
    transcriptTurns,
    ...(call.status === 'failed' || call.status === 'canceled'
      ? { failureCode: safeFailureCode(call.failureCode) }
      : {}),
  };
}
