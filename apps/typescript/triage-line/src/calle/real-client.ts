/**
 * Real CALL-E client — wraps @call-e/calle behind Switchboard's CalleClient
 * interface so the executor drives it identically to the mock.
 *
 * Verified against @call-e/calle@0.7.0 type definitions:
 *   - new CalleClient({ apiKey, baseUrl }).calls.createAndWait(input, opts)
 *   - input: { task, recipients[], resultSchema, recipientResultSchema, metadata }
 *   - returns Call: { status, structuredResult, taskCompleted, completionConfidence,
 *                     evidence, recipients[] { status, structuredResult, attempts[]
 *                     { status, transcriptTurns[] { speaker, text, offsetSeconds } } } }
 *
 * Switchboard runs one node = one recipient per call, so we read the result
 * from the single recipient (with the top-level call as a fallback) and derive
 * our simplified outcome status from the recipient/attempt lifecycle states.
 */

import { CalleClient as SdkClient } from "@call-e/calle";
import type { Call, CallRecipient } from "@call-e/calle";
import type { CalleClient, CalleCallRequest } from "./client.js";
import type {
  CalleCallOutcome,
  StructuredResult,
  TranscriptTurn,
} from "../graph/types.js";

export interface RealCalleClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Passed through to createAndWait to bound how long we wait. */
  timeoutMs?: number;
  intervalMs?: number;
}

/** Map the SDK's transcript speaker labels to our internal ones. */
function mapSpeaker(speaker: string): TranscriptTurn["speaker"] {
  switch (speaker) {
    case "bot":
      return "agent";
    case "user":
      return "callee";
    default:
      return "system";
  }
}

/**
 * Derive Switchboard's simplified status from a recipient's lifecycle state and
 * its dial attempts. The SDK doesn't have discrete "no_answer"/"voicemail"
 * statuses, so we infer them from attempt failure codes when present.
 */
function deriveStatus(
  call: Call,
  recipient: CallRecipient | undefined
): CalleCallOutcome["status"] {
  const recipientStatus = recipient?.status ?? call.status;

  if (recipientStatus === "completed") return "completed";

  // Inspect the latest attempt's failure signal for a finer-grained reason.
  const attempts = recipient?.attempts ?? [];
  const lastFailed = [...attempts]
    .reverse()
    .find((a) => a.status === "failed");
  const code = (lastFailed?.failureCode ?? call.failureCode ?? "").toLowerCase();
  const message = (
    lastFailed?.failureMessage ??
    call.failureMessage ??
    ""
  ).toLowerCase();
  const haystack = `${code} ${message}`;

  if (/voicemail|voice_mail|machine/.test(haystack)) return "voicemail";
  if (/no[_\s-]?answer|noanswer|unanswered|no reply/.test(haystack)) {
    return "no_answer";
  }

  return "failed";
}

/** Pick the structured result: prefer the recipient's, fall back to the call. */
function pickResult(
  call: Call,
  recipient: CallRecipient | undefined
): StructuredResult | undefined {
  const fromRecipient = recipient?.structuredResult ?? undefined;
  const fromCall = call.structuredResult ?? undefined;
  return (fromRecipient ?? fromCall) as StructuredResult | undefined;
}

/** Flatten a recipient's attempts into a single ordered transcript. */
function collectTranscript(recipient: CallRecipient | undefined): TranscriptTurn[] {
  if (!recipient) return [];
  const turns: TranscriptTurn[] = [];
  for (const attempt of recipient.attempts ?? []) {
    for (const t of attempt.transcriptTurns ?? []) {
      turns.push({
        speaker: mapSpeaker(t.speaker),
        text: t.text,
        // Schema field is snake_case (offset_seconds), nullable.
        at: t.offset_seconds ?? undefined,
      });
    }
  }
  return turns;
}

export class RealCalleClient implements CalleClient {
  private readonly sdk: SdkClient;

  /** Unique per client instance so idempotency keys differ between runs. */
  private readonly runToken = Date.now().toString(36);

  constructor(private readonly options: RealCalleClientOptions) {
    if (!options.apiKey) {
      throw new Error("RealCalleClient requires a CALL-E apiKey.");
    }
    this.sdk = new SdkClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
    });
  }

  async createAndWait(req: CalleCallRequest): Promise<CalleCallOutcome> {
    const call = await this.sdk.calls.createAndWait(
      {
        task: req.task,
        recipients: [
          {
            phones: [req.phone],
            region: req.region,
            locale: req.locale,
          },
        ],
        // resultSchema shapes the per-recipient result for our single recipient.
        recipientResultSchema: req.resultSchema as unknown as Record<
          string,
          unknown
        >,
        resultSchema: req.resultSchema as unknown as Record<string, unknown>,
        metadata: req.nodeId ? { switchboard_node_id: req.nodeId } : undefined,
      },
      {
        // Unique per run so a fresh call is always placed (reusing a fixed key
        // like the node id makes CALL-E return the prior call's result).
        idempotencyKey: req.nodeId
          ? `${req.nodeId}:${this.runToken}`
          : undefined,
        timeoutMs: this.options.timeoutMs,
        intervalMs: this.options.intervalMs,
      }
    );

    if (process.env.CALLE_DEBUG === "true") {
      // Full raw response so we can see exactly what CALL-E returned.
      console.error(
        `[CALLE_DEBUG] ${req.nodeId} raw response:\n` +
          JSON.stringify(call, null, 2)
      );
    }

    const recipient = call.recipients?.[0];
    const confidence = call.completionConfidence;

    return {
      status: deriveStatus(call, recipient),
      taskCompleted: call.taskCompleted ?? false,
      completionConfidence: {
        score: confidence?.score ?? 0,
        // The SDK provides a label ("low"/"medium"/"high"); surface it as reason.
        reason: confidence?.label,
      },
      structuredResult: pickResult(call, recipient),
      evidence: call.evidence ?? [],
      transcript: collectTranscript(recipient),
    };
  }
}
