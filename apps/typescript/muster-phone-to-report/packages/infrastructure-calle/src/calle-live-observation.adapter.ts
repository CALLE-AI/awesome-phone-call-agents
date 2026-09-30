import { CalleClient, type Call, type CreateCallInput } from "@call-e/calle";

import type { EvidenceCustodyPort } from "@muster/application";

export interface CalleLiveObservationDispatchRequest {
  readonly apiToken: string;
  readonly targetAddress: string;
  readonly endpointAlias: string;
  readonly operationId: string;
  readonly providerDispatchIdentity: string;
  readonly scenarioId: string;
  readonly scenarioRevision: number;
  readonly timeoutMs: number;
  readonly retryLimit: 0;
  readonly dtmfPolicy: Readonly<{ kind: "forbidden"; allowlist: readonly never[] }>;
  readonly traceContext: Readonly<{ traceparent: string; tracestate?: string }>;
  readonly signal: AbortSignal;
}

interface CalleSdkBoundary {
  readonly calls: Readonly<{
    create(
      input: CreateCallInput,
      options: Readonly<{ idempotencyKey: string }>,
    ): Promise<Call | unknown>;
    waitForResult(
      callId: string,
      options: Readonly<{ timeoutMs: number }>,
    ): Promise<Call | unknown>;
    listEvents?(callId: string, options: Readonly<{ limit: number }>): Promise<unknown>;
  }>;
}

interface CalleClientFactoryInput {
  readonly apiKey: string;
  readonly traceContext: CalleLiveObservationDispatchRequest["traceContext"];
  readonly signal: AbortSignal;
}

export interface CalleLiveObservationAdapter {
  dispatch(input: CalleLiveObservationDispatchRequest): Promise<unknown>;
  reconcile(input: CalleLiveObservationDispatchRequest): Promise<unknown>;
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const decimalTokenNeighborPattern = /[+\-.0-9]/u;
const rfc3339Pattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/u;
const traceparentPattern = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/u;
const maximumTranscriptBytes = 16_384;
const expectedZoneIds = Object.freeze(["zone-01", "zone-02", "zone-03", "zone-04"] as const);
const providerFailureClasses = new Map<string, string>([
  ["create_response_invalid", "provider_create_response_invalid"],
  ["invalid_request", "provider_request_invalid"],
  ["insufficient_balance", "provider_insufficient_balance"],
  ["recipient_blocked", "provider_recipient_blocked"],
  ["invalid_recipient", "provider_invalid_recipient"],
  ["invalid_phone", "provider_invalid_recipient"],
  ["unsupported_region", "provider_unsupported_region"],
  ["unsupported_language", "provider_unsupported_language"],
  ["policy_violation", "provider_policy_violation"],
  ["rate_limit_exceeded", "provider_rate_limited"],
  ["provider_unavailable", "provider_unavailable"],
  ["internal_error", "provider_internal_error"],
  ["call_not_ready", "provider_not_ready"],
  ["no_recipients", "provider_invalid_recipient"],
  ["result_schema_invalid", "provider_schema_invalid"],
  ["recipient_result_schema_invalid", "provider_schema_invalid"],
  ["idempotency_conflict", "provider_idempotency_conflict"],
  ["no_answer", "provider_no_answer"],
  ["busy", "provider_busy"],
  ["call_failed", "provider_call_failed"],
  ["declined", "provider_declined"],
  ["timed_out", "provider_timeout"],
  ["canceled", "provider_canceled"],
  ["result_invalid", "provider_evidence_invalid"],
  ["result_unavailable", "provider_evidence_unavailable"],
  ["result_failed", "provider_evidence_failed"],
  ["unauthorized", "provider_authentication"],
  ["forbidden", "provider_authentication"],
]);

type CalleCreateResponseContentType = "missing" | "json" | "text" | "other";
type CalleCreateResponseBody = "absent" | "present" | "unavailable";
type CalleCreateResponseLocation =
  "missing" | "invalid" | "cross_origin" | "invalid_call_resource" | "exact_call_resource";
const providerRequestIdHeaderNames = Object.freeze(["x-request-id"] as const);

interface CalleCreateResponseDiagnostics {
  readonly statusCode: number;
  readonly contentType: CalleCreateResponseContentType;
  readonly body: CalleCreateResponseBody;
  readonly location: CalleCreateResponseLocation;
  readonly requestIdPresent: boolean;
}

class CalleCreateResponseError extends Error {
  readonly code = "create_response_invalid";
  readonly diagnostics: CalleCreateResponseDiagnostics;

  constructor(diagnostics: CalleCreateResponseDiagnostics) {
    super("CALL-E create response is invalid");
    this.name = "CalleCreateResponseError";
    this.diagnostics = diagnostics;
  }
}

function createResponseContentType(response: Response): CalleCreateResponseContentType {
  const header = response.headers.get("content-type");
  if (header === null || header.trim() === "") return "missing";
  const mediaType = header.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType === "application/json" || mediaType.endsWith("+json")) return "json";
  return mediaType.startsWith("text/") ? "text" : "other";
}

function validatedResponseStatus(response: Response): number {
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
    throw new Error("CALL-E create response status is invalid");
  }
  return response.status;
}

function responseDiagnostics(
  response: Response,
  body: CalleCreateResponseBody,
  location: CalleCreateResponseLocation,
): CalleCreateResponseDiagnostics {
  return Object.freeze({
    statusCode: validatedResponseStatus(response),
    contentType: createResponseContentType(response),
    body,
    location,
    requestIdPresent: providerRequestIdHeaderNames.some((name) => response.headers.has(name)),
  });
}

function includesAsciiControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) return true;
  }
  return false;
}

function resolveCreateResponseLocation(
  value: string | null,
  requestUrl: string,
): Readonly<{
  classification: CalleCreateResponseLocation;
  callId?: string;
  url?: string;
}> {
  if (value === null) return Object.freeze({ classification: "missing" });
  if (value === "" || value !== value.trim() || includesAsciiControl(value)) {
    return Object.freeze({ classification: "invalid" });
  }
  if (
    value.includes("%") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    /\/(?:\.{1,2})(?:\/|$)/u.test(value)
  ) {
    return Object.freeze({ classification: "invalid_call_resource" });
  }
  let resolved: URL;
  let requestOrigin: string;
  try {
    resolved = new URL(value, requestUrl);
    requestOrigin = new URL(requestUrl).origin;
  } catch {
    return Object.freeze({ classification: "invalid" });
  }
  if (resolved.origin !== requestOrigin) {
    return Object.freeze({ classification: "cross_origin" });
  }
  if (
    resolved.username !== "" ||
    resolved.password !== "" ||
    resolved.search !== "" ||
    resolved.hash !== ""
  ) {
    return Object.freeze({ classification: "invalid_call_resource" });
  }
  const prefix = "/v1/calls/";
  if (!resolved.pathname.startsWith(prefix)) {
    return Object.freeze({ classification: "invalid_call_resource" });
  }
  const callId = resolved.pathname.slice(prefix.length);
  if (!identifierPattern.test(callId) || resolved.pathname !== `${prefix}${callId}`) {
    return Object.freeze({ classification: "invalid_call_resource" });
  }
  return Object.freeze({
    classification: "exact_call_resource",
    callId,
    url: resolved.href,
  });
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringOrNull(value: unknown): boolean {
  return typeof value === "string" || value === null;
}

function isRecordOrNull(value: unknown): boolean {
  return isRecordValue(value) || value === null;
}

function isCreateResponseTranscriptTurn(value: unknown): boolean {
  if (!isRecordValue(value)) return false;
  const offsetSeconds = value["offset_seconds"];
  return (
    (offsetSeconds === null ||
      (typeof offsetSeconds === "number" && Number.isFinite(offsetSeconds))) &&
    (value["speaker"] === "bot" || value["speaker"] === "user" || value["speaker"] === "unknown") &&
    typeof value["text"] === "string"
  );
}

function isCreateResponseAttempt(value: unknown): boolean {
  if (!isRecordValue(value)) return false;
  const transcriptTurns = value["transcript_turns"];
  return (
    typeof value["id"] === "string" &&
    typeof value["phone"] === "string" &&
    (value["status"] === "queued" ||
      value["status"] === "dialing" ||
      value["status"] === "in_progress" ||
      value["status"] === "completed" ||
      value["status"] === "failed" ||
      value["status"] === "canceled") &&
    isStringOrNull(value["started_at"]) &&
    isStringOrNull(value["completed_at"]) &&
    isStringOrNull(value["summary"]) &&
    Array.isArray(transcriptTurns) &&
    transcriptTurns.every(isCreateResponseTranscriptTurn) &&
    isStringOrNull(value["provider_call_id"]) &&
    isStringOrNull(value["failure_code"]) &&
    isStringOrNull(value["failure_message"])
  );
}

function isCreateResponseRecipient(value: unknown): boolean {
  if (!isRecordValue(value)) return false;
  const phones = value["phones"];
  const attempts = value["attempts"];
  return (
    typeof value["id"] === "string" &&
    Array.isArray(phones) &&
    phones.every((phone) => typeof phone === "string") &&
    isStringOrNull(value["locale"]) &&
    isStringOrNull(value["region"]) &&
    (value["status"] === "pending" ||
      value["status"] === "in_progress" ||
      value["status"] === "completed" ||
      value["status"] === "failed" ||
      value["status"] === "skipped") &&
    isRecordOrNull(value["structured_result"]) &&
    isStringOrNull(value["summary"]) &&
    Array.isArray(attempts) &&
    attempts.every(isCreateResponseAttempt)
  );
}

function validCreateResponseCallId(value: unknown): string | undefined {
  if (!isRecordValue(value)) return undefined;
  const id = value["id"];
  const recipients = value["recipients"];
  const evidence = value["evidence"];
  const completionConfidence = value["completion_confidence"];
  if (
    typeof id !== "string" ||
    !identifierPattern.test(id) ||
    (value["object"] !== "call" && value["object"] !== "call_task") ||
    (value["status"] !== "queued" &&
      value["status"] !== "in_progress" &&
      value["status"] !== "completed" &&
      value["status"] !== "failed" &&
      value["status"] !== "canceled") ||
    typeof value["task"] !== "string" ||
    !Array.isArray(recipients) ||
    !recipients.every(isCreateResponseRecipient) ||
    !isRecordOrNull(value["structured_result"]) ||
    !isStringOrNull(value["summary"]) ||
    (typeof value["task_completed"] !== "boolean" && value["task_completed"] !== null) ||
    !Array.isArray(evidence) ||
    !evidence.every((item) => typeof item === "string") ||
    !isRecordValue(value["metadata"]) ||
    !isStringOrNull(value["failure_code"]) ||
    !isStringOrNull(value["failure_message"]) ||
    typeof value["created_at"] !== "string" ||
    !isStringOrNull(value["completed_at"])
  ) {
    return undefined;
  }
  if (
    completionConfidence !== null &&
    (!isRecordValue(completionConfidence) ||
      typeof completionConfidence["score"] !== "number" ||
      !Number.isFinite(completionConfidence["score"]) ||
      typeof completionConfidence["label"] !== "string")
  ) {
    return undefined;
  }
  return id;
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
}

function safeProviderFailureClass(value: unknown): string {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    const code = candidate["code"];
    if (typeof code === "string") return providerFailureClasses.get(code) ?? "provider_failed";
    const name = candidate["name"];
    if (name === "CalleTimeoutError") return "provider_timeout";
    if (name === "CalleConnectionError") return "provider_unavailable";
  }
  return "provider_failed";
}

function safeProviderTerminalClass(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "provider_failed";
  }
  const call = value as Record<string, unknown>;
  const codes: unknown[] = [];
  if (Array.isArray(call["recipients"])) {
    for (const recipientValue of call["recipients"]) {
      if (recipientValue === null || typeof recipientValue !== "object") continue;
      const recipient = recipientValue as Record<string, unknown>;
      if (!Array.isArray(recipient["attempts"])) continue;
      for (const attemptValue of recipient["attempts"]) {
        if (attemptValue === null || typeof attemptValue !== "object") continue;
        const attempt = attemptValue as Record<string, unknown>;
        codes.push(attempt["failureCode"], attempt["status"]);
      }
    }
  }
  codes.push(call["failureCode"], call["status"]);
  for (const code of codes) {
    if (typeof code !== "string") continue;
    const safeClass = providerFailureClasses.get(code);
    if (safeClass !== undefined) return safeClass;
  }
  return "provider_failed";
}

const providerDiagnosticCodeKeys = new Set([
  "code",
  "error_code",
  "errorCode",
  "failure_code",
  "failureCode",
  "reason",
]);

function safeProviderDetailClass(
  value: unknown,
  depth = 0,
  budget: { remaining: number } = { remaining: 256 },
): string | undefined {
  if (depth > 4 || budget.remaining <= 0 || value === null || typeof value !== "object") {
    return undefined;
  }
  budget.remaining -= 1;
  if (Array.isArray(value)) {
    for (const item of value) {
      const safeClass = safeProviderDetailClass(item, depth + 1, budget);
      if (safeClass !== undefined) return safeClass;
    }
    return undefined;
  }
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (providerDiagnosticCodeKeys.has(key) && typeof candidate === "string") {
      const safeClass = providerFailureClasses.get(candidate);
      if (safeClass !== undefined) return safeClass;
    }
    const nestedClass = safeProviderDetailClass(candidate, depth + 1, budget);
    if (nestedClass !== undefined) return nestedClass;
  }
  return undefined;
}

function safeProviderEventClass(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "provider_failed";
  }
  const data = (value as Record<string, unknown>)["data"];
  if (!Array.isArray(data) || data.length > 100) return "provider_failed";
  let terminalEventClass: string | undefined;
  for (const eventValue of [...data].reverse()) {
    if (eventValue === null || typeof eventValue !== "object" || Array.isArray(eventValue))
      continue;
    const event = eventValue as Record<string, unknown>;
    const detailClass = safeProviderDetailClass(event["details"]);
    if (detailClass !== undefined) return detailClass;
    if (event["type"] === "call.result_validation_failed") {
      terminalEventClass = "provider_evidence_invalid";
    } else if (event["type"] === "call.failed" && terminalEventClass === undefined) {
      terminalEventClass = "provider_call_failed";
    }
  }
  return terminalEventClass ?? "provider_failed";
}

async function diagnoseTerminalClass(
  client: CalleSdkBoundary,
  call: Record<string, unknown>,
): Promise<string> {
  const directClass = safeProviderTerminalClass(call);
  if (directClass !== "provider_failed") return directClass;
  const callId = call["id"];
  if (
    typeof callId !== "string" ||
    !identifierPattern.test(callId) ||
    client.calls.listEvents === undefined
  ) {
    return directClass;
  }
  try {
    const events = await client.calls.listEvents(callId, { limit: 100 });
    return safeProviderEventClass(events);
  } catch {
    return directClass;
  }
}

const resultSchema = Object.freeze({
  type: "object",
  description:
    "Extract the four greenhouse readings and the four auxiliary statuses from the device's spoken report.",
  additionalProperties: false,
  required: Object.freeze(["readings", "auxiliary_status"]),
  properties: Object.freeze({
    readings: Object.freeze({
      type: "array",
      description:
        "Exactly four entries, one each for zone-01, zone-02, zone-03, and zone-04. Extract only facts spoken by the device.",
      items: Object.freeze({
        type: "object",
        description: "One device-reported greenhouse zone reading.",
        additionalProperties: false,
        required: Object.freeze(["zone_id", "value_token", "spoken_unit_token", "reading_status"]),
        properties: Object.freeze({
          zone_id: Object.freeze({
            type: "string",
            enum: Object.freeze(["zone-01", "zone-02", "zone-03", "zone-04"]),
            description:
              "Select the zone identifier that corresponds to the zone number in the device's spoken report.",
          }),
          value_token: Object.freeze({
            type: "string",
            description:
              "Copy the complete numeric token exactly as spoken for this zone, preserving decimal spelling.",
          }),
          spoken_unit_token: Object.freeze({
            type: "string",
            enum: Object.freeze(["degrees Fahrenheit", "percent", "%"]),
            description:
              "Copy or canonically select the unit spoken for this value. Temperature zones use degrees Fahrenheit; percentage zones use percent or %.",
          }),
          reading_status: Object.freeze({
            type: "string",
            enum: Object.freeze(["OK", "ALARM", "LOW", "UNKNOWN"]),
            description:
              "Select the status spoken for this same zone. Use UNKNOWN only when the device explicitly reports that status as unknown.",
          }),
        }),
      }),
    }),
    auxiliary_status: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["sound", "power", "battery", "output"]),
      properties: Object.freeze({
        sound: Object.freeze({
          type: "string",
          enum: Object.freeze(["normal", "alarm", "unknown"]),
          description:
            "Select normal, alarm, or unknown only when that status is spoken by the device.",
        }),
        power: Object.freeze({
          type: "string",
          enum: Object.freeze(["mains_available", "mains_failed", "unknown"]),
          description:
            "Select mains_available, mains_failed, or unknown only when that status is spoken by the device.",
        }),
        battery: Object.freeze({
          type: "string",
          enum: Object.freeze(["normal", "low", "unknown"]),
          description:
            "Select normal, low, or unknown only when that status is spoken by the device.",
        }),
        output: Object.freeze({
          type: "string",
          enum: Object.freeze(["off", "on", "unknown"]),
          description: "Select off, on, or unknown only when that status is spoken by the device.",
        }),
      }),
    }),
  }),
});

function invalid(): never {
  throw new Error("CALL-E result is invalid");
}

type StructuredAdmissionClass =
  | "terminal_shape"
  | "reading_shape"
  | "zone_identity"
  | "anchor_value"
  | "anchor_unit"
  | "anchor_status"
  | "auxiliary_status";

class StructuredAdmissionError extends Error {
  constructor(readonly admissionClass: StructuredAdmissionClass) {
    super("CALL-E structured result is inadmissible");
    this.name = "StructuredAdmissionError";
  }
}

function safeStructuredAdmissionFailure(error: unknown): Error {
  const admissionClass =
    error instanceof StructuredAdmissionError ? error.admissionClass : "terminal_shape";
  return new Error("CALL-E provider terminal: provider_evidence_invalid", {
    cause: admissionClass,
  });
}

function admitStructured<T>(admissionClass: StructuredAdmissionClass, admission: () => T): T {
  try {
    return admission();
  } catch (error: unknown) {
    if (error instanceof StructuredAdmissionError) throw error;
    throw new StructuredAdmissionError(admissionClass);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const candidate = record(value);
  const actual = Object.keys(candidate);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) invalid();
  return candidate;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) invalid();
  return value;
}

function boundedText(value: unknown, maximum = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) invalid();
  return value;
}

function terminalTime(value: unknown): string {
  const text = boundedText(value, 64);
  const match = rfc3339Pattern.exec(text);
  if (match === null) invalid();
  const year = Number(match[1]!);
  const month = Number(match[2]!);
  const day = Number(match[3]!);
  const hour = Number(match[4]!);
  const minute = Number(match[5]!);
  const second = Number(match[6]!);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute ||
    calendar.getUTCSeconds() !== second ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    invalid();
  }
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) invalid();
  return new Date(timestamp).toISOString();
}

interface RetainedTranscriptTurn {
  readonly index: number;
  readonly offsetSeconds: number | null;
  readonly speaker: "bot" | "user" | "unknown";
  readonly text: string;
}

function enumValue<const T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid();
  return value as T;
}

function canonicalDecimalText(value: string): string {
  if (!decimalPattern.test(value)) invalid();
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const decimalPoint = unsigned.indexOf(".");
  const integer = decimalPoint === -1 ? unsigned : unsigned.slice(0, decimalPoint);
  const fraction = decimalPoint === -1 ? "" : unsigned.slice(decimalPoint + 1).replace(/0+$/u, "");
  const magnitude = fraction.length === 0 ? integer : `${integer}.${fraction}`;
  return negative && magnitude !== "0" ? `-${magnitude}` : magnitude;
}

function hasCompleteDecimalAnchor(turnText: string, valueToken: string): boolean {
  let index = turnText.indexOf(valueToken);
  while (index !== -1) {
    const previous = index === 0 ? undefined : turnText[index - 1];
    const nextIndex = index + valueToken.length;
    const next = nextIndex === turnText.length ? undefined : turnText[nextIndex];
    if (
      (previous === undefined || !decimalTokenNeighborPattern.test(previous)) &&
      (next === undefined || !decimalTokenNeighborPattern.test(next))
    ) {
      return true;
    }
    index = turnText.indexOf(valueToken, index + 1);
  }
  return false;
}

const spokenCardinals = Object.freeze({
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
} as const);
const spokenTens = Object.freeze({
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
} as const);
const maximumSpokenNumberTokens = 12;

function ownNumberValue(
  values: Readonly<Record<string, number>>,
  token: string,
): number | undefined {
  return Object.hasOwn(values, token) ? values[token] : undefined;
}

function parseSpokenUnderOneHundred(tokens: readonly string[]): number | undefined {
  if (tokens.length === 1) {
    return ownNumberValue(spokenCardinals, tokens[0]!) ?? ownNumberValue(spokenTens, tokens[0]!);
  }
  if (tokens.length !== 2) return undefined;
  const tens = ownNumberValue(spokenTens, tokens[0]!);
  const ones = ownNumberValue(spokenCardinals, tokens[1]!);
  return tens === undefined || ones === undefined || ones < 1 || ones > 9 ? undefined : tens + ones;
}

function parseSpokenInteger(tokens: readonly string[]): string | undefined {
  if (tokens.length === 1 && /^(?:0|[1-9]\d*)$/u.test(tokens[0]!)) return tokens[0];
  const underOneHundred = parseSpokenUnderOneHundred(tokens);
  if (underOneHundred !== undefined) return String(underOneHundred);
  if (tokens.length < 2 || tokens.length > 5 || tokens[1] !== "hundred") return undefined;
  const hundreds = ownNumberValue(spokenCardinals, tokens[0]!);
  if (hundreds === undefined || hundreds < 1 || hundreds > 9) return undefined;
  const remainderTokens = tokens.slice(tokens[2] === "and" ? 3 : 2);
  if (remainderTokens.length === 0) return String(hundreds * 100);
  const remainder = parseSpokenUnderOneHundred(remainderTokens);
  return remainder === undefined ? undefined : String(hundreds * 100 + remainder);
}

function parseSpokenFraction(tokens: readonly string[]): string | undefined {
  if (tokens.length === 0) return undefined;
  let fraction = "";
  for (const token of tokens) {
    if (/^\d+$/u.test(token)) {
      fraction += token;
      continue;
    }
    const digit = ownNumberValue(spokenCardinals, token);
    if (digit === undefined || digit > 9) return undefined;
    fraction += String(digit);
  }
  return fraction;
}

function parseSpokenDecimal(tokens: readonly string[]): string | undefined {
  if (tokens.length === 0 || tokens.length > maximumSpokenNumberTokens) return undefined;
  const negative = tokens[0] === "minus" || tokens[0] === "negative";
  const unsigned = negative ? tokens.slice(1) : tokens;
  if (unsigned.length === 0) return undefined;
  const pointIndexes = unsigned.flatMap((token, index) =>
    token === "point" || token === "dot" ? [index] : [],
  );
  if (pointIndexes.length > 1) return undefined;
  const pointIndex = pointIndexes[0];
  const integer = parseSpokenInteger(
    pointIndex === undefined ? unsigned : unsigned.slice(0, pointIndex),
  );
  if (integer === undefined) return undefined;
  if (pointIndex === undefined) return `${negative && integer !== "0" ? "-" : ""}${integer}`;
  const fraction = parseSpokenFraction(unsigned.slice(pointIndex + 1));
  if (fraction === undefined) return undefined;
  return `${negative && (integer !== "0" || /[^0]/u.test(fraction)) ? "-" : ""}${integer}.${fraction}`;
}

function hasEquivalentSpokenDecimalAnchor(turnText: string, valueToken: string): boolean {
  const tokens =
    turnText
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/[\u2010-\u2015-]/gu, " ")
      .match(/\p{L}+|[+-]?(?:\d+\.\d+|\d+)/gu) ?? [];
  for (let start = 0; start < tokens.length; start += 1) {
    const maximumEnd = Math.min(tokens.length, start + maximumSpokenNumberTokens);
    for (let end = start + 1; end <= maximumEnd; end += 1) {
      if (parseSpokenDecimal(tokens.slice(start, end)) === valueToken) return true;
    }
  }
  return false;
}

function canonicalUnitText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\bpercentage\b/gu, " percent ")
    .replace(/\bper\s+cent\b/gu, " percent ")
    .replace(/%/gu, " percent ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function hasEquivalentUnitAnchor(turnText: string, spokenUnitToken: string): boolean {
  const turn = canonicalUnitText(turnText);
  const token = canonicalUnitText(spokenUnitToken);
  return token.length > 0 && ` ${turn} `.includes(` ${token} `);
}

const zoneContracts = Object.freeze({
  "zone-01": Object.freeze({
    zonePattern: /\bzone\s*(?:0?1|one)\b/iu,
    spokenUnit: "degrees Fahrenheit",
    normalizedUnit: "degF",
  }),
  "zone-02": Object.freeze({
    zonePattern: /\bzone\s*(?:0?2|two)\b/iu,
    spokenUnit: "degrees Fahrenheit",
    normalizedUnit: "degF",
  }),
  "zone-03": Object.freeze({
    zonePattern: /\bzone\s*(?:0?3|three)\b/iu,
    spokenUnit: "percent",
    normalizedUnit: "percent",
  }),
  "zone-04": Object.freeze({
    zonePattern: /\bzone\s*(?:0?4|four)\b/iu,
    spokenUnit: "percent",
    normalizedUnit: "percent",
  }),
});

function groundedZoneSegment(
  turns: readonly RetainedTranscriptTurn[],
  zoneId: (typeof expectedZoneIds)[number],
): Readonly<{ turn: RetainedTranscriptTurn; segment: string }> {
  const matches: Array<{ turn: RetainedTranscriptTurn; segment: string }> = [];
  for (const turn of turns) {
    if (turn.speaker !== "user") continue;
    const occurrences: Array<{ zoneId: (typeof expectedZoneIds)[number]; index: number }> = [];
    for (const candidateZoneId of expectedZoneIds) {
      const matcher = new RegExp(zoneContracts[candidateZoneId].zonePattern.source, "giu");
      let match = matcher.exec(turn.text);
      while (match !== null) {
        occurrences.push({ zoneId: candidateZoneId, index: match.index });
        match = matcher.exec(turn.text);
      }
    }
    occurrences.sort((left, right) => left.index - right.index);
    for (let index = 0; index < occurrences.length; index += 1) {
      const occurrence = occurrences[index]!;
      if (occurrence.zoneId !== zoneId) continue;
      matches.push({
        turn,
        segment: turn.text.slice(
          occurrence.index,
          occurrences[index + 1]?.index ?? turn.text.length,
        ),
      });
    }
  }
  if (matches.length === 0) throw new StructuredAdmissionError("anchor_value");
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new StructuredAdmissionError("zone_identity");
  }
  return matches[0];
}

function hasStatusAnchor(evidenceSegment: string, status: string): boolean {
  const phrase = canonicalUnitText(evidenceSegment).replace(/\bokay\b/gu, "ok");
  return ` ${phrase} `.includes(` ${status.toLocaleLowerCase("en-US")} `);
}

function hasAllWords(evidencePhrase: string, words: readonly string[]): boolean {
  const phrase = ` ${canonicalUnitText(evidencePhrase)} `;
  return words.every((word) => phrase.includes(` ${word} `));
}

function auxiliaryStatusGrounded(
  evidenceSegment: string,
  auxiliary: Readonly<Record<"sound" | "power" | "battery" | "output", string>>,
): boolean {
  const requiredWords = [
    ["sound", auxiliary.sound],
    ["power", ...auxiliary.power.split("_")],
    ["battery", auxiliary.battery],
    ["output", auxiliary.output],
  ];
  return requiredWords.every((words) => hasAllWords(evidenceSegment, words));
}

function parseStructuredResult(
  value: unknown,
  turns: readonly RetainedTranscriptTurn[],
  opaqueCustodyRef: string,
  providerTaskId: string,
): Readonly<{
  providerRevisionId: string;
  sourceCompleteness: "complete" | "truncated" | "unknown";
  readings: readonly Record<string, unknown>[];
  auxiliaryStatus: Readonly<Record<"sound" | "power" | "battery" | "output", string>>;
}> {
  const structured = admitStructured("terminal_shape", () =>
    exact(value, ["readings", "auxiliary_status"]),
  );
  if (!Array.isArray(structured["readings"]) || structured["readings"].length !== 4) {
    throw new StructuredAdmissionError("zone_identity");
  }
  const providerReadings = structured["readings"].map((rawReading) =>
    admitStructured("reading_shape", () =>
      exact(rawReading, ["zone_id", "value_token", "spoken_unit_token", "reading_status"]),
    ),
  );
  const zoneIds = providerReadings.map((reading) =>
    admitStructured("zone_identity", () => enumValue(reading["zone_id"], expectedZoneIds)),
  );
  const observedZoneIds = new Set(zoneIds);
  if (
    observedZoneIds.size !== expectedZoneIds.length ||
    expectedZoneIds.some((zoneId) => !observedZoneIds.has(zoneId))
  ) {
    throw new StructuredAdmissionError("zone_identity");
  }
  const readings = providerReadings.map((reading, readingIndex) => {
    const zoneId = zoneIds[readingIndex]!;
    const valueToken = admitStructured("anchor_value", () =>
      boundedText(reading["value_token"], 32),
    );
    admitStructured("anchor_value", () => canonicalDecimalText(valueToken));
    const grounded = groundedZoneSegment(turns, zoneId);
    if (
      !hasCompleteDecimalAnchor(grounded.segment, valueToken) &&
      !hasEquivalentSpokenDecimalAnchor(grounded.segment, valueToken)
    ) {
      throw new StructuredAdmissionError("anchor_value");
    }
    const spokenUnitToken = admitStructured("anchor_unit", () =>
      boundedText(reading["spoken_unit_token"], 128),
    );
    const zoneContract = zoneContracts[zoneId];
    if (
      canonicalUnitText(spokenUnitToken) !== canonicalUnitText(zoneContract.spokenUnit) ||
      !hasEquivalentUnitAnchor(grounded.segment, spokenUnitToken)
    ) {
      throw new StructuredAdmissionError("anchor_unit");
    }
    const status = admitStructured("reading_shape", () =>
      enumValue(reading["reading_status"], ["OK", "ALARM", "LOW", "UNKNOWN"] as const),
    );
    if (!hasStatusAnchor(grounded.segment, status)) {
      throw new StructuredAdmissionError("anchor_status");
    }
    return Object.freeze({
      zoneId,
      value: valueToken,
      spokenUnit: zoneContract.spokenUnit,
      normalizedUnit: zoneContract.normalizedUnit,
      status,
      confidenceToken: "provider-observed",
      sourceAnchor: Object.freeze({
        anchorId: `turn-${String(grounded.turn.index)}-${zoneId}`,
        valueToken,
        spokenUnitToken,
        opaqueSourceRef: `${opaqueCustodyRef}#turn=${String(grounded.turn.index)}&offset=${grounded.turn.offsetSeconds === null ? "unknown" : String(grounded.turn.offsetSeconds)}`,
      }),
    });
  });
  const auxiliaryStatus = admitStructured("auxiliary_status", () => {
    const auxiliary = exact(structured["auxiliary_status"], [
      "sound",
      "power",
      "battery",
      "output",
    ]);
    return Object.freeze({
      sound: enumValue(auxiliary["sound"], ["normal", "alarm", "unknown"] as const),
      power: enumValue(auxiliary["power"], ["mains_available", "mains_failed", "unknown"] as const),
      battery: enumValue(auxiliary["battery"], ["normal", "low", "unknown"] as const),
      output: enumValue(auxiliary["output"], ["off", "on", "unknown"] as const),
    });
  });
  const auxiliaryTurns = turns.filter(
    (turn) => turn.speaker === "user" && auxiliaryStatusGrounded(turn.text, auxiliaryStatus),
  );
  if (auxiliaryTurns.length !== 1) {
    throw new StructuredAdmissionError("auxiliary_status");
  }
  const sourceCompleteness =
    readings.some((reading) => reading.status === "UNKNOWN") ||
    Object.values(auxiliaryStatus).includes("unknown")
      ? "unknown"
      : "complete";
  return Object.freeze({
    providerRevisionId: providerTaskId,
    sourceCompleteness,
    readings: Object.freeze(readings),
    auxiliaryStatus,
  });
}

function transcriptFrom(value: unknown): Readonly<{
  transcript: string;
  turns: readonly RetainedTranscriptTurn[];
  taskStructuredResult: unknown;
}> {
  const call = record(value);
  if (!Array.isArray(call["recipients"]) || call["recipients"].length !== 1) invalid();
  const recipient = record(call["recipients"][0]);
  if (!Array.isArray(recipient["attempts"]) || recipient["attempts"].length !== 1) invalid();
  const attempt = record(recipient["attempts"][0]);
  if (!Array.isArray(attempt["transcriptTurns"]) || attempt["transcriptTurns"].length > 64)
    invalid();
  let bytes = 0;
  const turns = attempt["transcriptTurns"].map((turnValue, index) => {
    const turn = exact(turnValue, ["offset_seconds", "speaker", "text"]);
    if (
      turn["offset_seconds"] !== null &&
      (typeof turn["offset_seconds"] !== "number" || !Number.isFinite(turn["offset_seconds"]))
    ) {
      invalid();
    }
    if (turn["speaker"] !== "bot" && turn["speaker"] !== "user" && turn["speaker"] !== "unknown") {
      invalid();
    }
    const text = boundedText(turn["text"], 2_000);
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > maximumTranscriptBytes) invalid();
    return Object.freeze({
      index,
      offsetSeconds: turn["offset_seconds"] as number | null,
      speaker: turn["speaker"] as "bot" | "user" | "unknown",
      text,
    });
  });
  if (turns.length === 0) invalid();
  const transcript = turns
    .map(
      (turn) =>
        `[${turn.offsetSeconds === null ? "?" : String(turn.offsetSeconds)}] ${turn.speaker}: ${turn.text}`,
    )
    .join("\n");
  if (Buffer.byteLength(transcript, "utf8") > maximumTranscriptBytes) invalid();
  return Object.freeze({
    transcript,
    turns: Object.freeze(turns),
    taskStructuredResult: call["structuredResult"],
  });
}

function defaultClientFactory(input: CalleClientFactoryInput): CalleSdkBoundary {
  if (!traceparentPattern.test(input.traceContext.traceparent)) {
    throw new Error("CALL-E trace context is invalid");
  }
  let recoveredCall: Readonly<{ readonly url: string; readonly response: Response }> | undefined;
  let recoveredCreateDiagnostics: CalleCreateResponseDiagnostics | undefined;
  const contextualRequest = (request: Request, redirect?: RequestInit["redirect"]): Request => {
    const headers = new Headers(request.headers);
    headers.set("traceparent", input.traceContext.traceparent);
    if (input.traceContext.tracestate !== undefined) {
      headers.set("tracestate", input.traceContext.tracestate);
    }
    return new Request(request, {
      headers,
      signal: input.signal,
      ...(redirect === undefined ? {} : { redirect }),
    });
  };
  const tracedFetch = async (request: Request): Promise<Response> => {
    const requestUrl = new URL(request.url);
    const isCreateRequest =
      request.method === "POST" && requestUrl.pathname === "/v1/calls" && requestUrl.search === "";
    const providerRequest = contextualRequest(request, isCreateRequest ? "error" : undefined);
    if (input.signal.aborted) throw new DOMException("This operation was aborted", "AbortError");
    if (
      recoveredCall !== undefined &&
      providerRequest.method === "GET" &&
      providerRequest.url === recoveredCall.url
    ) {
      const response = recoveredCall.response;
      recoveredCall = undefined;
      return response;
    }
    const response = await fetch(providerRequest);
    if (!isCreateRequest || !response.ok) {
      return response;
    }
    const location = resolveCreateResponseLocation(
      response.headers.get("location"),
      providerRequest.url,
    );
    let body: string;
    try {
      body = await response.clone().text();
    } catch (error: unknown) {
      if (isAbortError(error)) throw error;
      throw new CalleCreateResponseError(
        responseDiagnostics(response, "unavailable", location.classification),
      );
    }
    if (body.length > 0) {
      const diagnostics = responseDiagnostics(response, "present", location.classification);
      if (diagnostics.contentType !== "json") {
        throw new CalleCreateResponseError(diagnostics);
      }
      let created: unknown;
      try {
        created = JSON.parse(body) as unknown;
      } catch {
        throw new CalleCreateResponseError(diagnostics);
      }
      if (validCreateResponseCallId(created) === undefined) {
        throw new CalleCreateResponseError(diagnostics);
      }
      return response;
    }
    const diagnostics = responseDiagnostics(response, "absent", location.classification);
    if (
      location.classification !== "exact_call_resource" ||
      location.callId === undefined ||
      location.url === undefined
    ) {
      throw new CalleCreateResponseError(diagnostics);
    }
    const authorization = providerRequest.headers.get("authorization");
    if (authorization === null) throw new CalleCreateResponseError(diagnostics);
    const recoveryHeaders = new Headers({
      accept: "application/json",
      authorization,
      traceparent: input.traceContext.traceparent,
    });
    if (input.traceContext.tracestate !== undefined) {
      recoveryHeaders.set("tracestate", input.traceContext.tracestate);
    }
    const recoveryRequest = new Request(location.url, {
      method: "GET",
      headers: recoveryHeaders,
      redirect: "error",
      signal: input.signal,
    });
    let recoveryResponse: Response;
    try {
      recoveryResponse = await fetch(recoveryRequest);
    } catch (error: unknown) {
      if (isAbortError(error)) throw error;
      throw new CalleCreateResponseError(diagnostics);
    }
    if (!recoveryResponse.ok) throw new CalleCreateResponseError(diagnostics);
    let recovered: unknown;
    try {
      recovered = await recoveryResponse.clone().json();
    } catch (error: unknown) {
      if (isAbortError(error)) throw error;
      throw new CalleCreateResponseError(diagnostics);
    }
    if (validCreateResponseCallId(recovered) !== location.callId) {
      throw new CalleCreateResponseError(diagnostics);
    }
    recoveredCreateDiagnostics = diagnostics;
    recoveredCall = Object.freeze({ url: location.url, response: recoveryResponse.clone() });
    return recoveryResponse;
  };
  const sdkClient = new CalleClient({ apiKey: input.apiKey, fetch: tracedFetch });
  return Object.freeze({
    calls: Object.freeze({
      create: async (
        createInput: CreateCallInput,
        options: Readonly<{ idempotencyKey: string }>,
      ): Promise<Call | unknown> => {
        try {
          return await sdkClient.calls.create(createInput, options);
        } catch (error: unknown) {
          if (
            recoveredCreateDiagnostics !== undefined &&
            !(error instanceof CalleCreateResponseError) &&
            !isAbortError(error)
          ) {
            throw new CalleCreateResponseError(recoveredCreateDiagnostics);
          }
          throw error;
        }
      },
      waitForResult: async (
        callId: string,
        options: Readonly<{ timeoutMs: number }>,
      ): Promise<Call | unknown> => await sdkClient.calls.waitForResult(callId, options),
      listEvents: async (callId: string, options: Readonly<{ limit: number }>): Promise<unknown> =>
        await sdkClient.calls.listEvents(callId, options),
    }),
  });
}

export function createCalleLiveObservationAdapter(input: {
  readonly custody: Pick<
    EvidenceCustodyPort,
    "readProviderTaskReference" | "write" | "writeProviderTaskReference"
  >;
  readonly createClient?: (input: CalleClientFactoryInput) => CalleSdkBoundary;
}): CalleLiveObservationAdapter {
  const createClient = input.createClient ?? defaultClientFactory;
  const validateRequest = (request: CalleLiveObservationDispatchRequest): void => {
    if (
      request.retryLimit !== 0 ||
      request.dtmfPolicy.kind !== "forbidden" ||
      request.dtmfPolicy.allowlist.length !== 0 ||
      request.signal.aborted
    ) {
      throw new Error("CALL-E dispatch safety contract is invalid");
    }
    identifier(request.operationId);
    identifier(request.providerDispatchIdentity);
  };
  const clientFor = (request: CalleLiveObservationDispatchRequest): CalleSdkBoundary =>
    createClient({
      apiKey: boundedText(request.apiToken, 512),
      traceContext: request.traceContext,
      signal: request.signal,
    });
  const waitForAdmittedResult = async (
    client: CalleSdkBoundary,
    request: CalleLiveObservationDispatchRequest,
    providerTaskId: string,
    taskReferencePersisted: boolean,
  ): Promise<unknown> => {
    let result: Call | unknown;
    try {
      result = await client.calls.waitForResult(providerTaskId, {
        timeoutMs: request.timeoutMs,
      });
    } catch (error: unknown) {
      throw new Error(`CALL-E provider terminal: ${safeProviderFailureClass(error)}`, {
        cause: error,
      });
    }
    if (!taskReferencePersisted) {
      throw new Error("CALL-E provider terminal: provider_evidence_unavailable");
    }
    if (request.signal.aborted) throw new Error("CALL-E dispatch was aborted");
    let call: Record<string, unknown>;
    try {
      call = record(result);
      if (identifier(call["id"]) !== providerTaskId) {
        throw new StructuredAdmissionError("terminal_shape");
      }
    } catch (error: unknown) {
      throw safeStructuredAdmissionFailure(error);
    }
    if (call["status"] !== "completed" || call["taskCompleted"] !== true) {
      throw new Error(`CALL-E provider terminal: ${await diagnoseTerminalClass(client, call)}`);
    }
    let retained: ReturnType<typeof transcriptFrom>;
    try {
      retained = transcriptFrom(call);
    } catch (error: unknown) {
      throw safeStructuredAdmissionFailure(error);
    }
    const custody = await input.custody.write({
      operationId: request.operationId,
      transcript: retained.transcript,
    });
    const opaqueCustodyRef = boundedText(custody.opaqueReference, 256);
    let structured: ReturnType<typeof parseStructuredResult>;
    try {
      structured = parseStructuredResult(
        retained.taskStructuredResult,
        retained.turns,
        opaqueCustodyRef,
        providerTaskId,
      );
    } catch (error: unknown) {
      throw safeStructuredAdmissionFailure(error);
    }
    let observedAt: string;
    try {
      observedAt = terminalTime(call["completedAt"]);
    } catch (error: unknown) {
      throw safeStructuredAdmissionFailure(error);
    }
    return Object.freeze({
      providerCallId: providerTaskId,
      terminalStatus: "completed",
      observedAt,
      evidence: Object.freeze({
        providerRevisionId: structured.providerRevisionId,
        opaqueCustodyRef,
        sourceCompleteness: structured.sourceCompleteness,
        transcript: Object.freeze(
          retained.turns.map((turn) =>
            Object.freeze({
              speaker:
                turn.speaker === "bot"
                  ? ("agent" as const)
                  : turn.speaker === "user"
                    ? ("device" as const)
                    : ("system" as const),
              text: turn.text,
            }),
          ),
        ),
        readings: structured.readings,
        auxiliaryStatus: structured.auxiliaryStatus,
      }),
    });
  };
  return Object.freeze({
    async dispatch(request: CalleLiveObservationDispatchRequest): Promise<unknown> {
      validateRequest(request);
      const client = clientFor(request);
      const targetAddress = boundedText(request.targetAddress, 256);
      let created: Call | unknown;
      try {
        created = await client.calls.create(
          {
            task:
              "Make exactly one outbound dial attempt to the configured synthetic endpoint and " +
              "listen to the complete greenhouse report. Do not redial or retry for any reason. " +
              'When connected, say "Hello" once, then listen silently. ' +
              "This endpoint is an automated greenhouse report, not a person. " +
              "Do not speak again while the report is playing. " +
              "The report continues after Zone 4 with sound, power, battery, and output statuses. " +
              "Do not say thank you or goodbye, interrupt, or end the call after the zone readings. " +
              "Wait through pauses until all four auxiliary statuses have been spoken and the " +
              "remote endpoint ends the call. If the report ends early, leave missing evidence unknown; " +
              "never infer missing statuses from the other readings. " +
              "Do not press any keys or send DTMF. Return only provider-observed evidence under the supplied strict schema. " +
              "Use exactly four readings with zone_id values zone-01, zone-02, zone-03, and zone-04, " +
              "each exactly once. Copy each complete numeric token without normalizing its decimal spelling, " +
              "and select only the unit and status spoken for that same zone. Muster grounds every returned " +
              "token to its zone segment in the device transcript. Do not invent provider " +
              "revision identifiers, confidence tokens, normalized units, source completeness, or turn indices.",
            recipients: [{ phones: [targetAddress], region: "US", locale: "en-US" }],
            resultSchema,
            metadata: Object.freeze({
              operation_id: request.operationId,
              scenario_id: request.scenarioId,
              scenario_revision: request.scenarioRevision,
              endpoint_alias: request.endpointAlias,
            }),
          },
          { idempotencyKey: request.providerDispatchIdentity },
        );
      } catch (error: unknown) {
        if (isAbortError(error)) throw error;
        throw new Error(`CALL-E provider terminal: ${safeProviderFailureClass(error)}`, {
          cause: error,
        });
      }
      const providerTaskId = identifier(record(created)["id"]);
      let taskReferencePersisted = true;
      try {
        await input.custody.writeProviderTaskReference({
          operationId: request.operationId,
          providerTaskId,
        });
      } catch {
        taskReferencePersisted = false;
      }
      return await waitForAdmittedResult(client, request, providerTaskId, taskReferencePersisted);
    },
    async reconcile(request: CalleLiveObservationDispatchRequest): Promise<unknown> {
      validateRequest(request);
      const client = clientFor(request);
      let providerTaskId: string;
      try {
        providerTaskId = identifier(
          await input.custody.readProviderTaskReference({
            operationId: request.operationId,
          }),
        );
      } catch {
        throw new Error("CALL-E provider terminal: provider_evidence_unavailable");
      }
      return await waitForAdmittedResult(client, request, providerTaskId, true);
    },
  });
}
