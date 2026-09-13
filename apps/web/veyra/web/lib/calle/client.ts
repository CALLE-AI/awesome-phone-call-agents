import type { JsonObject, SafeCallDraft, SafeCallPreview } from "./safety";
import type { CallMode } from "./safety";
import { maskPhone } from "./safety";
import { CallConfigurationError } from "./client-error";
import { liveCalleWebhookUrl } from "./webhook-url";

export { CallConfigurationError } from "./client-error";

const OFFICIAL_CALLE_BASE_URL = "https://api.heycall-e.com";

export interface SafeCallExecution {
  mode: CallMode;
  callId: string;
  status: string;
  structuredResult: JsonObject | null;
  qualified?: boolean | null;
  summary?: string | null;
  transcript?: string | null;
  idempotencyKey: string;
  externalSideEffect: boolean;
}

export function getCallMode(): CallMode {
  const configured = (process.env.CALL_MODE ?? "fake").trim().toLowerCase();
  if (configured === "fake" || configured === "live") return configured;
  throw new CallConfigurationError('CALL_MODE must be either "fake" or "live"');
}

function liveConfig(): { apiKey: string; baseUrl: string } {
  if (process.env.CALLE_LIVE_ENABLED !== "true") {
    throw new CallConfigurationError("Live calling is disabled by CALLE_LIVE_ENABLED");
  }

  const apiKey = process.env.CALLE_API_KEY;
  if (!apiKey) throw new CallConfigurationError("CALLE_API_KEY is required in live mode");

  const configuredBaseUrl = (process.env.CALLE_BASE_URL ?? OFFICIAL_CALLE_BASE_URL).replace(
    /\/$/,
    "",
  );
  if (configuredBaseUrl !== OFFICIAL_CALLE_BASE_URL) {
    throw new CallConfigurationError("Live credentials may only be sent to the official CALL-E origin");
  }

  return { apiKey, baseUrl: configuredBaseUrl };
}

export function assertApprovedCallReady(
  _draft: SafeCallDraft,
  preview: SafeCallPreview,
): void {
  const currentMode = getCallMode();
  if (currentMode !== preview.mode) {
    throw new CallConfigurationError("CALL_MODE changed after preview; generate a new preview");
  }
  if (currentMode === "live") {
    liveConfig();
    liveCalleWebhookUrl();
  }
}

function preferredEnumValue(values: unknown[]): unknown {
  const preference = [
    "balanced",
    "book_advisor",
    "booked",
    "scheduled",
    "qualified",
    "follow_up",
    "interested",
    "yes",
    "completed",
  ];
  return (
    preference
      .map((preferred) => values.find((item) => item === preferred))
      .find((item) => item !== undefined) ?? values[0]
  );
}

function fakeString(fieldName: string): string {
  const key = fieldName.toLowerCase();
  if (key.includes("goal")) return "Retirement planning and long-term wealth growth";
  if (key.includes("risk")) return "Balanced";
  if (key.includes("date") || key.includes("time") || key.includes("slot")) {
    return "Next Tuesday at 3:00 PM";
  }
  if (key.includes("feedback") || key.includes("experience")) {
    return "Positive previous experience and interested in visiting again";
  }
  if (key.includes("interest")) return "High interest";
  if (key.includes("reason")) return "Interested and ready for a follow-up conversation";
  return "Captured successfully during the conversation";
}

function fakeNumber(schema: Record<string, unknown>, fieldName: string): number {
  const key = fieldName.toLowerCase();
  let candidate = key.includes("horizon") || key.includes("year") ? 7 : 8;
  const minimum = typeof schema.minimum === "number" ? schema.minimum : undefined;
  const maximum = typeof schema.maximum === "number" ? schema.maximum : undefined;
  if (minimum !== undefined) candidate = Math.max(candidate, minimum);
  if (maximum !== undefined) candidate = Math.min(candidate, maximum);
  return schema.type === "integer" ? Math.round(candidate) : candidate;
}

function fakeValue(schema: unknown, fieldName = ""): unknown {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return null;
  const value = schema as Record<string, unknown>;
  if (Array.isArray(value.enum) && value.enum.length) return preferredEnumValue(value.enum);

  switch (value.type) {
    case "object": {
      const properties =
        typeof value.properties === "object" && value.properties !== null
          ? (value.properties as Record<string, unknown>)
          : {};
      return Object.fromEntries(
        Object.entries(properties).map(([key, item]) => [key, fakeValue(item, key)]),
      );
    }
    case "array":
      return value.items ? [fakeValue(value.items, fieldName)] : [];
    case "boolean": {
      const key = fieldName.toLowerCase();
      return !(
        key.includes("declined") ||
        key.includes("opt_out") ||
        key.includes("do_not_contact")
      );
    }
    case "integer":
    case "number":
      return fakeNumber(value, fieldName);
    case "string":
      return fakeString(fieldName);
    default:
      return null;
  }
}

/** Exactly one create call, with no SDK or application retry path. */
export async function executeApprovedCall(
  draft: SafeCallDraft,
  preview: SafeCallPreview,
): Promise<SafeCallExecution> {
  assertApprovedCallReady(draft, preview);
  const currentMode = preview.mode;

  if (currentMode === "fake") {
    const structuredResult = fakeValue(draft.resultSchema);
    const contactName =
      typeof draft.metadata?.contactName === "string" && draft.metadata.contactName.trim()
        ? draft.metadata.contactName.trim().replace(/\s+/g, " ").slice(0, 80)
        : "The contact";
    const execution: SafeCallExecution = {
      mode: "fake",
      callId: `fake_${preview.approvalDigest.slice(0, 16)}`,
      status: "completed",
      structuredResult:
        typeof structuredResult === "object" && structuredResult !== null && !Array.isArray(structuredResult)
          ? (structuredResult as JsonObject)
          : null,
      qualified: true,
      summary:
        `${contactName} consented to the conversation, answered the qualification ` +
        "questions, and expressed clear interest in the recommended follow-up. A next step was captured successfully.",
      transcript:
        "[Simulated transcript — fake mode; no phone call was placed]\n\n" +
        "AI Agent: Hello, I’m an AI assistant calling on behalf of the team. Is now a good time for a brief conversation?\n" +
        "Contact: Yes, I have a few minutes.\n" +
        "AI Agent: Thank you. Could you share what you’re hoping to achieve and what matters most to you?\n" +
        "Contact: I’m interested and would like to understand the available options and next steps.\n" +
        "AI Agent: That sounds like a good fit. May I arrange a follow-up with the appropriate specialist?\n" +
        "Contact: Yes, next Tuesday afternoon would work well.\n" +
        "AI Agent: Perfect. I’ve recorded that preference. Thank you for your time.",
      idempotencyKey: preview.idempotencyKey,
      externalSideEffect: false,
    };
    console.log(
      `[calle] fake mode — no request sent. phone=${maskPhone(draft.phone)} locale=${draft.locale} ` +
        `callId=${execution.callId} status=${execution.status}`,
    );
    return execution;
  }

  const config = liveConfig();
  const hasWebhook = typeof draft.metadata?.veyraCallResultId === "string";
  const requestBody = {
    task: draft.task,
    recipient: { phone: draft.phone, locale: draft.locale },
    resultSchema: draft.resultSchema,
    ...(hasWebhook ? { webhookUrl: liveCalleWebhookUrl() } : {}),
    metadata: {
      ...(draft.metadata ?? {}),
      veyraApprovalDigest: preview.approvalDigest,
      veyraCallMode: "live",
    },
  };
  console.log(
    `[calle] → calls.create phone=${maskPhone(draft.phone)} locale=${draft.locale} ` +
      `idempotencyKey=${preview.idempotencyKey} taskChars=${draft.task.length} hasWebhook=${hasWebhook}`,
  );

  // Keep fake mode entirely credential-free and side-effect-free. The official SDK is
  // not loaded until every live gate above has passed.
  const { CalleClient } = await import("@call-e/calle");
  const client = new CalleClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  const call = await client.calls.create(requestBody, { idempotencyKey: preview.idempotencyKey });

  console.log(
    `[calle] ← calls.create responded callId=${call.id} status=${call.status} ` +
      `taskCompleted=${call.taskCompleted ?? "n/a"} confidence=${call.completionConfidence?.label ?? "n/a"} ` +
      `structuredResult=${call.structuredResult ? "present" : "null"} ` +
      `failure=${call.failureCode ? "present" : "none"}`,
  );

  return {
    mode: "live",
    callId: call.id,
    status: call.status,
    structuredResult: call.structuredResult,
    idempotencyKey: preview.idempotencyKey,
    externalSideEffect: true,
  };
}
