import { CalleClient, type Call } from "@call-e/calle";
import type { TranscriptTurn } from "../domain/types.js";
import type {
  CalleGateway,
  CallHandle,
  CallRequest,
  CallSnapshot,
} from "./gateway.js";

/**
 * Live gateway backed by the CALL-E SDK (@call-e/calle). Used only when
 * CLAIMLINE_MODE=live and a CALLE_API_KEY is present. This is the layer that can
 * place a REAL phone call.
 */
export class LiveCalleGateway implements CalleGateway {
  readonly mode = "live" as const;
  private readonly client: CalleClient;

  constructor(options: { apiKey: string; baseUrl?: string | null }) {
    this.client = new CalleClient({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    });
  }

  async startCall(req: CallRequest): Promise<CallHandle> {
    const call = await this.client.calls.create(
      {
        task: req.task,
        recipient: {
          phone: req.recipient.phone,
          region: req.recipient.region,
          locale: req.recipient.locale,
        },
        resultSchema: req.resultSchema,
        ...(req.metadata ? { metadata: req.metadata } : {}),
        ...(req.webhookUrl ? { webhookUrl: req.webhookUrl } : {}),
      },
      { idempotencyKey: req.idempotencyKey },
    );
    return { callId: call.id, status: call.status };
  }

  async getCall(callId: string): Promise<CallSnapshot> {
    const call = await this.client.calls.get(callId);
    return mapCall(call);
  }
}

export function mapCall(call: Call): CallSnapshot {
  const recipient = call.recipients[0];
  const attempts = recipient?.attempts ?? [];
  const lastAttempt = attempts[attempts.length - 1];

  const transcript: TranscriptTurn[] = (lastAttempt?.transcriptTurns ?? []).map(
    (t) => ({
      offsetSeconds: t.offset_seconds,
      speaker: String(t.speaker),
      text: t.text,
    }),
  );

  const structuredResult =
    (call.structuredResult ?? recipient?.structuredResult ?? null) as
      | Record<string, unknown>
      | null;

  return {
    callId: call.id,
    status: call.status,
    taskCompleted: call.taskCompleted,
    completionConfidence: call.completionConfidence
      ? {
          score: call.completionConfidence.score,
          label: call.completionConfidence.label,
        }
      : null,
    structuredResult,
    evidence: call.evidence ?? [],
    summary: call.summary ?? lastAttempt?.summary ?? recipient?.summary ?? null,
    transcript,
    failureCode: call.failureCode ?? lastAttempt?.failureCode ?? null,
    failureMessage:
      call.failureMessage ?? lastAttempt?.failureMessage ?? null,
  };
}
