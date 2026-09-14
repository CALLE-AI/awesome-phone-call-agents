import { CalleClient } from "@call-e/calle";
import { buildRecipientBindings, verifyCallBinding, type CallStage } from "@/lib/live-binding";
import {
  createRateLimiter,
  hasDuplicatePhones,
  hasLiveCallConfiguration,
  isReservedDemoPhone,
  isValidOperationId,
  isValidPhone,
  normalizePhone,
  parseAllowedNumbers,
  secureEqual,
} from "@/lib/live-security";
import { CENTER_RESULT_SCHEMA, TOUR_RESULT_SCHEMA, parseCenterResult, parseTourResult } from "@/lib/result-schema";
import { WEEKDAYS, type AgeBand, type SearchBrief, type Weekday } from "@/lib/types";

type RecipientInput = {
  candidateId: string;
  name: string;
  phone: string;
  region: string;
  locale: string;
};

type CreateBody = {
  campaignId?: string;
  operationId?: string;
  stage?: CallStage;
  recipients?: RecipientInput[];
  brief?: SearchBrief;
  authorized?: boolean;
  tour?: {
    parentFirstName?: string;
    callbackPhone?: string;
    preferredWindow?: string;
    alternateWindow?: string;
  };
};

const supportedRoutes = new Set([
  "US|en-US",
  "GB|en-GB",
  "CA|en-CA",
  "AU|en-AU",
  "IN|en-IN",
  "SG|en-SG",
]);
const checkStartLimit = createRateLimiter(6, 10 * 60 * 1000);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function clientAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

function getConfig() {
  const apiKey = process.env.CALLE_API_KEY;
  const operatorKey = process.env.TINYSLOT_OPERATOR_KEY;
  if (!hasLiveCallConfiguration(process.env) || !apiKey || !operatorKey) return null;
  return {
    client: new CalleClient({ apiKey }),
    operatorKey,
    allowedNumbers: parseAllowedNumbers(process.env.CALLE_ALLOWED_NUMBERS),
  };
}

function validRecipient(value: unknown): value is RecipientInput {
  if (!value || typeof value !== "object") return false;
  const recipient = value as Record<string, unknown>;
  return typeof recipient.candidateId === "string"
    && /^[a-z0-9-]{3,80}$/.test(recipient.candidateId)
    && typeof recipient.name === "string"
    && recipient.name.trim().length >= 2
    && recipient.name.trim().length <= 100
    && typeof recipient.phone === "string"
    && typeof recipient.region === "string"
    && typeof recipient.locale === "string"
    && supportedRoutes.has(`${recipient.region}|${recipient.locale}`);
}

function validBrief(value: unknown): value is SearchBrief {
  if (!value || typeof value !== "object") return false;
  const brief = value as Record<string, unknown>;
  const ageBands: AgeBand[] = ["infant", "toddler", "preschool", "school-age"];
  return typeof brief.ageBand === "string"
    && ageBands.includes(brief.ageBand as AgeBand)
    && typeof brief.desiredStartDate === "string"
    && datePattern.test(brief.desiredStartDate)
    && Array.isArray(brief.requiredWeekdays)
    && brief.requiredWeekdays.length >= 1
    && brief.requiredWeekdays.every((day) => WEEKDAYS.includes(day as Weekday))
    && typeof brief.dropoffTime === "string"
    && timePattern.test(brief.dropoffTime)
    && typeof brief.pickupTime === "string"
    && timePattern.test(brief.pickupTime)
    && typeof brief.budgetMonthlyMinor === "number"
    && Number.isInteger(brief.budgetMonthlyMinor)
    && brief.budgetMonthlyMinor > 0
    && ["USD", "GBP", "CAD", "AUD"].includes(String(brief.currency))
    && typeof brief.subsidyRequired === "boolean"
    && typeof brief.targetMatches === "number"
    && Number.isInteger(brief.targetMatches)
    && brief.targetMatches >= 1
    && brief.targetMatches <= 3;
}

function validTour(value: CreateBody["tour"]) {
  return value
    && typeof value.parentFirstName === "string"
    && /^[A-Za-z][A-Za-z '-]{0,39}$/.test(value.parentFirstName)
    && typeof value.callbackPhone === "string"
    && isValidPhone(normalizePhone(value.callbackPhone))
    && !isReservedDemoPhone(normalizePhone(value.callbackPhone))
    && typeof value.preferredWindow === "string"
    && value.preferredWindow.trim().length >= 4
    && value.preferredWindow.trim().length <= 120
    && typeof value.alternateWindow === "string"
    && value.alternateWindow.trim().length <= 120;
}

function buildSearchTask(recipients: RecipientInput[], brief: SearchBrief) {
  const centerDirectory = recipients.map((recipient) => `${recipient.phone} is ${recipient.name}`).join("; ");
  const days = brief.requiredWeekdays.join(", ");
  return [
    "Call each authorized childcare center in this task.",
    `The reviewed destination mapping is: ${centerDirectory}.`,
    "Begin by saying you are TinySlot, an AI assistant making a childcare availability enquiry for a parent, and ask whether staff are willing to continue.",
    `Confirm the business identity, whether it serves the ${brief.ageBand} age band, and whether it has a real opening by ${brief.desiredStartDate}.`,
    `Ask whether ${days} are all available and whether care covers ${brief.dropoffTime} to ${brief.pickupTime}.`,
    `Ask for current monthly tuition in ${brief.currency}, one-time registration fees, subsidy acceptance, and up to two tour windows. Do not reveal the parent's budget or negotiate.`,
    "Preserve uncertainty. A waitlist is not an opening. If staff correct an earlier answer, return the final answer and quote it.",
    "Do not share a child's name, collect medical information, enroll anyone, accept terms, pay fees, or make a commitment.",
  ].join(" ");
}

function buildTourTask(recipient: RecipientInput, brief: SearchBrief, tour: NonNullable<CreateBody["tour"]>) {
  return [
    `Call ${recipient.name} at ${recipient.phone}.`,
    "Begin by saying you are TinySlot, an AI assistant calling with the parent's explicit approval to request a childcare tour.",
    `The parent is ${tour.parentFirstName}; their callback number is ${tour.callbackPhone}.`,
    `The enquiry concerns ${brief.ageBand} care starting by ${brief.desiredStartDate}.`,
    `Request ${tour.preferredWindow}${tour.alternateWindow ? `, with ${tour.alternateWindow} as an alternative` : ""}.`,
    "Read back any confirmed time and ask for the next step or a non-sensitive reference.",
    "Do not enroll the child, accept policies, pay fees, share the child's identity, or agree to any other commitment.",
  ].join(" ");
}

export async function POST(request: Request) {
  const config = getConfig();
  if (!config) return json({ error: "live_call_unavailable", message: "Live calling is not configured. Demo mode remains available." }, 503);
  if (!(await secureEqual(request.headers.get("x-tinyslot-operator-key") ?? "", config.operatorKey))) {
    return json({ error: "operator_access_denied", message: "The operator key is invalid." }, 401);
  }
  const rateLimit = checkStartLimit(clientAddress(request));
  if (!rateLimit.allowed) return json({ error: "rate_limited", message: "Too many live-call starts." }, 429, { "Retry-After": String(rateLimit.retryAfterSeconds) });

  let body: CreateBody;
  try {
    body = await request.json() as CreateBody;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const campaignId = body.campaignId?.trim();
  const operationId = body.operationId?.trim();
  const stage = body.stage;
  const rawRecipients = Array.isArray(body.recipients) ? body.recipients : [];
  if (!campaignId || !/^[a-z0-9-]{3,80}$/.test(campaignId)) return json({ error: "invalid_campaign_id" }, 400);
  if (!isValidOperationId(operationId)) return json({ error: "invalid_operation_id" }, 400);
  if (stage !== "search" && stage !== "tour") return json({ error: "invalid_stage" }, 400);
  if (body.authorized !== true) return json({ error: "authorization_required", message: "Explicit per-run call authorization is required." }, 400);
  if (!validBrief(body.brief)) return json({ error: "invalid_brief" }, 400);
  const maxRecipients = stage === "tour" ? 1 : 3;
  if (rawRecipients.length < 1 || rawRecipients.length > maxRecipients || rawRecipients.some((recipient) => !validRecipient(recipient))) {
    return json({ error: "invalid_recipients" }, 400);
  }
  const recipients = rawRecipients.filter(validRecipient).map((recipient) => ({ ...recipient, name: recipient.name.trim(), phone: normalizePhone(recipient.phone) }));
  if (recipients.some((recipient) => !isValidPhone(recipient.phone) || isReservedDemoPhone(recipient.phone))) {
    return json({ error: "invalid_live_recipient", message: "Live recipients must be valid non-demo E.164 numbers." }, 400);
  }
  if (hasDuplicatePhones(recipients.map((recipient) => recipient.phone)) || new Set(recipients.map((recipient) => recipient.candidateId)).size !== recipients.length) {
    return json({ error: "duplicate_recipients" }, 400);
  }
  if (recipients.some((recipient) => !config.allowedNumbers.has(recipient.phone))) {
    return json({ error: "recipient_not_allowed", message: "Every live destination must be on the server allowlist." }, 403);
  }
  if (stage === "tour" && !validTour(body.tour)) return json({ error: "invalid_tour_request" }, 400);

  const task = stage === "search"
    ? buildSearchTask(recipients, body.brief)
    : buildTourTask(recipients[0], body.brief, body.tour!);

  try {
    const bindings = await buildRecipientBindings(recipients, config.operatorKey);
    const call = await config.client.calls.create(
      {
        task,
        recipients: recipients.map((recipient) => ({ phones: [recipient.phone], region: recipient.region, locale: recipient.locale })),
        recipientResultSchema: stage === "search" ? CENTER_RESULT_SCHEMA : TOUR_RESULT_SCHEMA,
        metadata: {
          product: "tinyslot",
          campaign_id: campaignId,
          operation_id: operationId,
          stage,
          recipient_bindings: bindings,
        },
      },
      { idempotencyKey: `tinyslot:${campaignId}:${stage}:${operationId}` },
    );
    return json({ callId: call.id, status: call.status, campaignId, operationId, stage });
  } catch {
    return json({ error: "calle_request_failed", message: "CALL-E could not start this call. Retry only with the same operation ID." }, 502);
  }
}

export async function GET(request: Request) {
  const config = getConfig();
  if (!config) return json({ error: "live_call_unavailable" }, 503);
  if (!(await secureEqual(request.headers.get("x-tinyslot-operator-key") ?? "", config.operatorKey))) {
    return json({ error: "operator_access_denied", message: "The operator key is invalid." }, 401);
  }
  const params = new URL(request.url).searchParams;
  const callId = params.get("callId")?.trim();
  const campaignId = params.get("campaignId")?.trim();
  const operationId = params.get("operationId")?.trim();
  const stage = params.get("stage")?.trim();
  if (!callId || callId.length > 160) return json({ error: "invalid_call_id" }, 400);
  if (!campaignId || !/^[a-z0-9-]{3,80}$/.test(campaignId)) return json({ error: "invalid_campaign_id" }, 400);
  if (!isValidOperationId(operationId)) return json({ error: "invalid_operation_id" }, 400);
  if (stage !== "search" && stage !== "tour") return json({ error: "invalid_stage" }, 400);

  try {
    const call = await config.client.calls.get(callId);
    const verified = await verifyCallBinding(call, { callId, campaignId, operationId, stage }, config.operatorKey);
    if (!verified.ok) return json({ error: "call_binding_failed", reason: verified.error, message: "The result does not match the expected TinySlot operation." }, 409);
    return json({
      callId: call.id,
      campaignId,
      operationId,
      stage,
      status: call.status,
      taskCompleted: call.taskCompleted,
      confidence: call.completionConfidence,
      evidence: call.evidence,
      failureCode: call.failureCode,
      recipients: call.status === "completed" ? verified.recipients.map((recipient) => ({
        candidateId: recipient.candidateId,
        status: recipient.status,
        summary: recipient.summary,
        structuredResult: stage === "search" ? parseCenterResult(recipient.structuredResult) : parseTourResult(recipient.structuredResult),
      })) : [],
    });
  } catch {
    return json({ error: "calle_status_failed", message: "CALL-E could not return this call status." }, 502);
  }
}
