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
import { assertValidE164, redactPhones } from "../util/phone.js";

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
    // Credentials may only be sent to an approved HTTPS origin. Accepting any
    // https:// URL is insufficient — a mistyped or hostile host would still
    // receive the API key. We enforce an allowlist of exact origins. The
    // default allows only the official CALL-E API; additional origins can be
    // added via CALLE_ALLOWED_ORIGINS (comma-separated) for self-hosted setups.
    if (options.baseUrl !== undefined) {
      let url: URL;
      try {
        url = new URL(options.baseUrl);
      } catch {
        throw new Error(`Invalid CALLE_BASE_URL: "${options.baseUrl}".`);
      }
      if (url.protocol !== "https:") {
        throw new Error(
          `Refusing to send CALL-E credentials over a non-HTTPS origin ` +
            `(${url.protocol}//). Use an https:// base URL.`
        );
      }
      const allowed = new Set(
        [
          "https://api.heycall-e.com",
          ...(process.env.CALLE_ALLOWED_ORIGINS ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        ].map((o) => o.replace(/\/$/, ""))
      );
      if (!allowed.has(url.origin)) {
        throw new Error(
          `Refusing to send CALL-E credentials to unapproved origin ` +
            `"${url.origin}". Approved: ${[...allowed].join(", ")}. ` +
            `Add it to CALLE_ALLOWED_ORIGINS if intended.`
        );
      }
    }
    this.sdk = new SdkClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
    });
  }

  async createAndWait(req: CalleCallRequest): Promise<CalleCallOutcome> {
    // Every live dial leg must be a valid, authorized E.164 number. This fails
    // closed for synthetic defaults, empty strings, or unvalidated numbers
    // discovered mid-call.
    const phone = assertValidE164(req.phone, `node ${req.nodeId ?? "?"}`);

    const call = await this.sdk.calls.createAndWait(
      {
        task: req.task,
        recipients: [
          {
            phones: [phone],
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
        // Idempotency key must be unique per distinct call attempt. It includes
        // the locale and attempt index so a language-retry (same node, new
        // locale) is treated as a genuinely new call rather than returning the
        // cached first-attempt result.
        idempotencyKey: req.idempotencyKey
          ? `${req.idempotencyKey}:${this.runToken}`
          : undefined,
        timeoutMs: this.options.timeoutMs,
        intervalMs: this.options.intervalMs,
      }
    );

    if (process.env.CALLE_DEBUG === "true") {
      // Debug dump with phone numbers redacted — never log raw personal data.
      console.error(
        `[CALLE_DEBUG] ${req.nodeId} raw response (phones redacted):\n` +
          redactPhones(JSON.stringify(call, null, 2))
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
