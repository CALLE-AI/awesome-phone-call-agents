import type {
  CallConnectionStatus,
  CallProvider,
  CallResult,
  JsonSchema,
  PlaceCallInput,
} from "./provider";

/**
 * Dry-run provider. This is the default everywhere (local dev and the Netlify deploy) so we
 * never burn one of the 20 real CALL-E calls by accident — see lib/call/index.ts for the guard
 * that decides when the real provider is used instead.
 */
export class FakeCallProvider implements CallProvider {
  /** Simulated ring + conversation time, in ms. Short enough to keep dry-run iteration fast. */
  private readonly delayMs: number;

  constructor(delayMs = 1500) {
    this.delayMs = delayMs;
  }

  async placeCall(input: PlaceCallInput): Promise<CallResult> {
    await sleep(this.delayMs);

    const connectionStatus = pickConnectionStatus();
    const callId = `fake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const durationS = Math.round(this.delayMs / 1000) + randomInt(10, 90);

    if (connectionStatus !== "completed") {
      return {
        connectionStatus,
        structuredResult: null,
        evidence: [connectionSummary(connectionStatus)],
        callId,
        durationS: connectionStatus === "no_answer" ? 0 : durationS,
      };
    }

    return {
      connectionStatus,
      structuredResult: fakeStructuredResult(input.resultSchema),
      evidence: ["Simulated conversation completed (dry-run — no real call was placed)."],
      callId,
      durationS,
      transcriptRef: `fake-transcript:${callId}`,
    };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Weighted toward a completed conversation, with occasional realistic misses. */
function pickConnectionStatus(): CallConnectionStatus {
  const roll = Math.random();
  if (roll < 0.7) return "completed";
  if (roll < 0.82) return "no_answer";
  if (roll < 0.9) return "voicemail";
  if (roll < 0.96) return "declined";
  return "wrong_number";
}

function connectionSummary(status: CallConnectionStatus): string {
  switch (status) {
    case "no_answer":
      return "Simulated: no answer after ringing (dry-run).";
    case "voicemail":
      return "Simulated: call went to voicemail (dry-run).";
    case "declined":
      return "Simulated: recipient declined to continue (dry-run).";
    case "wrong_number":
      return "Simulated: recipient said this is the wrong number (dry-run).";
    case "failed":
      return "Simulated: call failed to connect (dry-run).";
    default:
      return "Simulated call event (dry-run).";
  }
}

/** Generates a plausible fake answer for each property in a JSON Schema object. */
function fakeStructuredResult(schema: JsonSchema): Record<string, unknown> {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const result: Record<string, unknown> = {};

  for (const [key, propSchema] of Object.entries(properties)) {
    result[key] = fakeValueForSchema(key, propSchema);
  }

  return result;
}

/**
 * Meta-fields from task-builder.ts carry outsized weight in dispatch's outcome mapping, so they
 * need their own low/high probabilities rather than a flat coin flip — otherwise "declined"
 * would dominate every completed call instead of being the rare case it should be.
 */
const META_FIELD_TRUE_CHANCE: Record<string, number> = {
  reached_person: 0.95,
  declined_conversation: 0.08,
  wants_callback_later: 0.1,
};

function fakeValueForSchema(key: string, schema: JsonSchema): unknown {
  if (key in META_FIELD_TRUE_CHANCE) {
    return Math.random() < META_FIELD_TRUE_CHANCE[key];
  }

  const enumValues = schema.enum as unknown[] | undefined;
  if (enumValues && enumValues.length > 0) {
    return enumValues[randomInt(0, enumValues.length - 1)];
  }

  switch (schema.type) {
    case "boolean":
      return Math.random() < 0.6;
    case "number":
    case "integer":
      return randomInt(1, 10);
    default:
      return "Sounds good, that works for me.";
  }
}
