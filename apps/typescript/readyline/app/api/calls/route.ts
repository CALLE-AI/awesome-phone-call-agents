import { CalleClient } from "@call-e/calle";
import {
  buildRecipientBindings,
  verifyCallBinding,
  type CallStage,
} from "@/lib/live-call-binding";
import {
  createRateLimiter,
  hasDuplicateNormalizedPhones,
  hasLiveCallConfiguration,
  isValidOperationId,
  isValidPhone,
  isValidReadinessVenue,
  isReservedDemoPhone,
  normalizePhone,
  parseAllowedNumbers,
  secureEqual,
} from "@/lib/live-call-security";

const recipientResultSchema = {
  type: "object",
  required: [
    "readiness",
    "arrival_time",
    "setup_complete_time",
    "needs_loading_dock",
    "dock_start",
    "dock_end",
    "power_amps",
    "blocker",
    "evidence",
  ],
  properties: {
    readiness: {
      type: "string",
      enum: ["ready", "conditional", "blocked", "unknown"],
      description: "Use unknown when the person did not provide enough evidence.",
    },
    arrival_time: {
      type: "string",
      description: "Confirmed local arrival time in 24-hour HH:mm format, or an empty string when unknown.",
    },
    setup_complete_time: {
      type: "string",
      description: "Confirmed local setup completion time in 24-hour HH:mm format, or an empty string when unknown.",
    },
    needs_loading_dock: {
      type: "string",
      enum: ["yes", "no", "unknown"],
    },
    dock_start: {
      type: "string",
      description: "Confirmed dock start time in HH:mm, or an empty string when no dock is needed or the time is unknown.",
    },
    dock_end: {
      type: "string",
      description: "Confirmed dock end time in HH:mm, or an empty string when no dock is needed or the time is unknown.",
    },
    power_amps: {
      type: "integer",
      description: "Maximum amperage required. Use -1 when the requirement is unknown.",
    },
    blocker: {
      type: "string",
      description: "A concrete blocker stated by the recipient, or an empty string when none was stated.",
    },
    evidence: {
      type: "string",
      description: "One concise statement grounded in what the recipient said.",
    },
  },
  additionalProperties: false,
} as const;

type RecipientInput = {
  vendorId: string;
  phone: string;
  region?: string;
  locale?: string;
};

type CreateBody = {
  eventId?: string;
  operationId?: string;
  stage?: CallStage;
  venue?: {
    accessStart?: string;
    availablePowerAmps?: number;
    readyBy?: string;
  };
  recipients?: RecipientInput[];
  resolutionGoal?: string;
};

const supportedCallingRoutes = new Set(["GB|en-GB", "US|en-US", "DE|de-DE", "FR|fr-FR"]);
const checkCallStartLimit = createRateLimiter(5, 10 * 60 * 1000);

function json(data: unknown, status = 200, additionalHeaders?: Record<string, string>) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...additionalHeaders },
  });
}

function clientAddress(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function getLiveConfig() {
  const apiKey = process.env.CALLE_API_KEY;
  const operatorKey = process.env.READYLINE_OPERATOR_KEY;
  const allowedNumbers = parseAllowedNumbers(process.env.CALLE_ALLOWED_NUMBERS);
  if (!hasLiveCallConfiguration(process.env) || !apiKey || !operatorKey) {
    return null;
  }
  return { client: new CalleClient({ apiKey }), operatorKey, allowedNumbers };
}

async function hasOperatorAccess(request: Request, expectedKey: string) {
  return secureEqual(request.headers.get("x-readyline-operator-key") ?? "", expectedKey);
}

function validRecipient(value: unknown): value is RecipientInput {
  if (!value || typeof value !== "object") return false;
  const recipient = value as Record<string, unknown>;
  return (
    typeof recipient.phone === "string" &&
    typeof recipient.vendorId === "string" &&
    /^[a-z0-9-]{3,80}$/.test(recipient.vendorId) &&
    typeof recipient.region === "string" &&
    typeof recipient.locale === "string" &&
    supportedCallingRoutes.has(`${recipient.region}|${recipient.locale}`)
  );
}

export async function POST(request: Request) {
  const config = getLiveConfig();
  if (!config) {
    return json(
      {
        error: "live_call_unavailable",
        message: "Live calling is not enabled for this deployment. Fixture mode remains available.",
      },
      503,
    );
  }

  if (!(await hasOperatorAccess(request, config.operatorKey))) {
    return json({ error: "operator_access_denied", message: "The operator key is invalid." }, 401);
  }

  const rateLimit = checkCallStartLimit(clientAddress(request));
  if (!rateLimit.allowed) {
    return json(
      { error: "rate_limited", message: "Too many live-call starts. Try again later." },
      429,
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const eventId = body.eventId?.trim();
  const operationId = body.operationId?.trim();
  const stage = body.stage;
  const rawRecipients = Array.isArray(body.recipients) ? body.recipients : [];
  if (!eventId || !/^[a-z0-9-]{3,80}$/.test(eventId)) {
    return json({ error: "invalid_event_id" }, 400);
  }
  if (stage !== "readiness" && stage !== "resolution") {
    return json({ error: "invalid_stage" }, 400);
  }
  if (!isValidOperationId(operationId)) {
    return json({ error: "invalid_operation_id" }, 400);
  }
  if (
    rawRecipients.length < 1 ||
    rawRecipients.length > 10 ||
    rawRecipients.some((item) => !validRecipient(item))
  ) {
    return json({ error: "invalid_recipients" }, 400);
  }
  const recipients = rawRecipients.filter(validRecipient).map((recipient) => ({
    ...recipient,
    phone: normalizePhone(recipient.phone),
  }));
  if (recipients.some((item) => !isValidPhone(item.phone))) {
    return json({ error: "invalid_recipients" }, 400);
  }
  if (
    hasDuplicateNormalizedPhones(recipients.map((recipient) => recipient.phone)) ||
    new Set(recipients.map((recipient) => recipient.vendorId)).size !== recipients.length
  ) {
    return json(
      { error: "duplicate_recipients", message: "Each vendor and normalized phone number must be unique." },
      400,
    );
  }
  if (recipients.some((item) => isReservedDemoPhone(item.phone))) {
    return json(
      { error: "fictional_recipient", message: "Reserved demo numbers can only be used in Demo mode." },
      400,
    );
  }
  if (recipients.some((item) => !config.allowedNumbers.has(item.phone))) {
    return json(
      { error: "recipient_not_allowed", message: "Every live recipient must be on the server allowlist." },
      403,
    );
  }

  const venue = body.venue;
  if (stage === "readiness" && !isValidReadinessVenue(venue)) {
    return json({ error: "invalid_venue" }, 400);
  }
  const readinessGoal =
    `Call each authorized event vendor. Disclose that you are ReadyLine, an AI assistant calling for an event operations manager. ` +
    `Confirm their arrival time, setup completion time, loading-dock need and window, maximum power requirement in amps, and any blocker. ` +
    `The venue opens for access at ${venue?.accessStart ?? "an unconfirmed time"}, provides ${venue?.availablePowerAmps ?? "an unconfirmed amount of"} amps, ` +
    `and must be ready by ${venue?.readyBy ?? "an unconfirmed time"}. Do not negotiate, purchase, or commit on the manager's behalf.`;

  const resolutionGoal = body.resolutionGoal?.trim() ?? "";
  if (stage === "resolution" && (resolutionGoal.length < 20 || resolutionGoal.length > 1200)) {
    return json({ error: "invalid_resolution_goal" }, 400);
  }

  try {
    const recipientBindings = await buildRecipientBindings(recipients, config.operatorKey);
    const call = await config.client.calls.create(
      {
        task: stage === "readiness" ? readinessGoal : resolutionGoal,
        recipients: recipients.map((recipient) => ({
          phones: [recipient.phone],
          region: recipient.region,
          locale: recipient.locale,
        })),
        recipientResultSchema,
        metadata: {
          event_id: eventId,
          operation_id: operationId,
          stage,
          product: "readyline",
          recipient_bindings: recipientBindings,
        },
      },
      { idempotencyKey: `readyline:${eventId}:${stage}:${operationId}` },
    );

    return json({ callId: call.id, status: call.status, eventId, operationId, stage });
  } catch {
    return json(
      { error: "calle_request_failed", message: "CALL-E could not start this call. Retry with the same operation." },
      502,
    );
  }
}

export async function GET(request: Request) {
  const config = getLiveConfig();
  if (!config) return json({ error: "live_call_unavailable" }, 503);
  if (!(await hasOperatorAccess(request, config.operatorKey))) {
    return json({ error: "operator_access_denied", message: "The operator key is invalid." }, 401);
  }

  const searchParams = new URL(request.url).searchParams;
  const callId = searchParams.get("callId")?.trim();
  const eventId = searchParams.get("eventId")?.trim();
  const operationId = searchParams.get("operationId")?.trim();
  const stage = searchParams.get("stage")?.trim();
  if (!callId || callId.length > 160) return json({ error: "invalid_call_id" }, 400);
  if (!eventId || !/^[a-z0-9-]{3,80}$/.test(eventId)) {
    return json({ error: "invalid_event_id" }, 400);
  }
  if (!isValidOperationId(operationId)) {
    return json({ error: "invalid_operation_id" }, 400);
  }
  if (stage !== "readiness" && stage !== "resolution") {
    return json({ error: "invalid_stage" }, 400);
  }

  try {
    const call = await config.client.calls.get(callId);
    const verified = await verifyCallBinding(
      call,
      { callId, eventId, operationId, stage },
      config.operatorKey,
    );
    if (!verified.ok) {
      return json(
        {
          error: "call_binding_failed",
          message: "CALL-E returned a result that does not match the expected operation.",
          reason: verified.error,
        },
        409,
      );
    }
    return json({
      callId: call.id,
      eventId,
      operationId,
      stage,
      status: call.status,
      taskCompleted: call.taskCompleted,
      confidence: call.completionConfidence,
      evidence: call.evidence,
      failureCode: call.failureCode,
      recipients: call.status === "completed" ? verified.recipients : [],
    });
  } catch {
    return json(
      { error: "calle_status_failed", message: "CALL-E could not return this call status." },
      502,
    );
  }
}
