export interface SimulatorLiveResponseHeaders {
  readonly location: string | null;
  readonly retryAfterSeconds: number | null;
  readonly review?: SimulatorLiveReviewMetadata | null;
}

export interface SimulatorLiveReviewMetadata {
  readonly capabilityClosed: true;
  readonly reviewReadyAt: string;
  readonly reviewExpiresAt: string;
  readonly cleanupPath: string;
}

export interface SimulatorLiveAvailability {
  readonly enabled: boolean;
  readonly runtimeProfile: "demo" | "development" | "test";
  readonly supportedScenarioRevisions: readonly Readonly<{
    scenarioId: string;
    revision: number;
  }>[];
}

export interface SimulatorLiveAccepted {
  readonly operationId: string;
  readonly resourceVersion: number;
  readonly statusLocation: string;
}

export interface SimulatorLiveTranscriptTurn {
  readonly speaker: "agent" | "device" | "system";
  readonly text: string;
}

export interface SimulatorLiveReading {
  readonly zoneId: string;
  readonly label: string;
  readonly value: string | null;
  readonly unit: string | null;
  readonly status: "OK" | "ALARM" | "LOW" | "UNKNOWN";
  readonly disposition: "grounded" | "missing" | "ambiguous" | "contradictory" | "invalid";
}

export interface SimulatorLiveProjection {
  readonly operationId: string;
  readonly resourceVersion: number;
  readonly stage: "scheduled" | "calling" | "extracting" | "terminal";
  readonly terminal: boolean;
  readonly terminalOutcome:
    | "observation_recorded"
    | "evidence_incomplete"
    | "recovery_candidate"
    | "provider_failed"
    | "provider_timeout"
    | "blocked"
    | "no_answer"
    | "busy"
    | "evidence_unavailable"
    | null;
  readonly scenarioId: string;
  readonly scenarioRevision: number;
  readonly provenance: "SIMULATED";
  readonly transcript: readonly SimulatorLiveTranscriptTurn[];
  readonly evidence: Readonly<{
    quality: "complete" | "partial" | "unknown" | "invalid";
    opaqueReference?: string;
  }> | null;
  readonly readings: readonly SimulatorLiveReading[];
  readonly reconciliation: readonly Readonly<{
    zoneId: string;
    disposition: "matched" | "missing" | "ambiguous" | "contradictory" | "invalid";
  }>[];
  readonly auxiliaryStatus: Readonly<{
    sound: "normal" | "alarm" | "unknown";
    power: "mains_available" | "mains_failed" | "unknown";
    battery: "normal" | "low" | "unknown";
    output: "off" | "on" | "unknown";
  }> | null;
  readonly predecessorOperationId: string | null;
  readonly dtmfActions?: 0;
  readonly twilioReconciliation?: "1 matching call";
}

export interface SimulatorLiveSafeError {
  readonly code:
    | "authorization_invalid"
    | "validation_error"
    | "not_found"
    | "conflict"
    | "dependency_unavailable"
    | "unexpected_error";
  readonly message: string;
}

type FailureStatus = 400 | 404 | 409 | 500 | 503;
type SimulatorLiveResult<T, S extends number> =
  | Readonly<{
      ok: true;
      status: S;
      data: T;
      headers: SimulatorLiveResponseHeaders;
    }>
  | Readonly<{
      ok: false;
      status: FailureStatus | "transport_error";
      error: SimulatorLiveSafeError | null;
      headers: SimulatorLiveResponseHeaders;
    }>;

export type SimulatorLiveAvailabilityResult = SimulatorLiveResult<SimulatorLiveAvailability, 200>;
export type SimulatorLiveRequestResult = SimulatorLiveResult<SimulatorLiveAccepted, 202>;
export type SimulatorLiveStatusResult = SimulatorLiveResult<SimulatorLiveProjection, 200>;
export interface SimulatorLiveReviewCleanup {
  readonly outcome: "deleted";
  readonly message: "Protected demo result deleted";
}
export type SimulatorLiveReviewCleanupResult = SimulatorLiveResult<SimulatorLiveReviewCleanup, 200>;

export interface SimulatorLiveClient {
  getAvailability(): Promise<SimulatorLiveAvailabilityResult>;
  requestLiveObservation(input: {
    readonly scenarioId: string;
    readonly scenarioRevision: number;
    readonly permit: string;
  }): Promise<SimulatorLiveRequestResult>;
  getLiveObservation(
    operationId: string,
    options?: {
      readonly signal?: AbortSignal;
      readonly scenarioId?: string;
      readonly scenarioRevision?: number;
    },
  ): Promise<SimulatorLiveStatusResult>;
  finishLiveDemoReview(
    cleanupPath: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<SimulatorLiveReviewCleanupResult>;
}

const opaqueIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const safeCodes = new Set<SimulatorLiveSafeError["code"]>([
  "authorization_invalid",
  "validation_error",
  "not_found",
  "conflict",
  "dependency_unavailable",
  "unexpected_error",
]);
const safeMessages: Readonly<Record<SimulatorLiveSafeError["code"], string>> = Object.freeze({
  authorization_invalid: "Permit rejected. Mint a fresh scenario-bound permit.",
  validation_error: "Live observation request is invalid.",
  not_found: "Live observation was not found.",
  conflict: "This live observation request conflicts with its permit.",
  dependency_unavailable: "The live observation dependency is temporarily unavailable.",
  unexpected_error: "Live observation could not be completed safely.",
});
const MAX_RESPONSE_BYTES = 65_536;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function headers(response?: Response): SimulatorLiveResponseHeaders {
  const location = response?.headers.get("location") ?? null;
  const retryAfter = response?.headers.get("retry-after") ?? null;
  const capability = response?.headers.get("x-muster-review-capability") ?? null;
  const reviewReadyAt = response?.headers.get("x-muster-review-ready-at") ?? null;
  const reviewExpiresAt = response?.headers.get("x-muster-review-expires-at") ?? null;
  const cleanupPath = response?.headers.get("x-muster-review-cleanup-path") ?? null;
  const hasReviewHeaders = [capability, reviewReadyAt, reviewExpiresAt, cleanupPath].some(
    (value) => value !== null,
  );
  let review: SimulatorLiveReviewMetadata | null = null;
  if (
    capability === "closed" &&
    reviewReadyAt !== null &&
    reviewExpiresAt !== null &&
    cleanupPath !== null &&
    /^\/api\/v1\/live-demo-review\/sessions\/review-[A-Za-z0-9._:-]{1,127}$/u.test(cleanupPath)
  ) {
    const ready = Date.parse(reviewReadyAt);
    const expires = Date.parse(reviewExpiresAt);
    if (
      Number.isFinite(ready) &&
      Number.isFinite(expires) &&
      new Date(ready).toISOString() === reviewReadyAt &&
      new Date(expires).toISOString() === reviewExpiresAt &&
      expires === ready + 30 * 60 * 1_000
    ) {
      review = Object.freeze({
        capabilityClosed: true,
        reviewReadyAt,
        reviewExpiresAt,
        cleanupPath,
      });
    }
  }
  return Object.freeze({
    location:
      location !== null &&
      /^\/api\/v1\/live-simulator\/operations\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(location)
        ? location
        : null,
    retryAfterSeconds:
      retryAfter !== null && /^[1-9][0-9]?$/u.test(retryAfter) ? Number(retryAfter) : null,
    ...(hasReviewHeaders ? { review } : {}),
  });
}

function safeError(value: unknown): SimulatorLiveSafeError | null {
  if (!isRecord(value) || !isRecord(value["error"])) return null;
  const code = value["error"]["code"];
  if (typeof code !== "string" || !safeCodes.has(code as SimulatorLiveSafeError["code"])) {
    return null;
  }
  const safeCode = code as SimulatorLiveSafeError["code"];
  return Object.freeze({ code: safeCode, message: safeMessages[safeCode] });
}

function failureStatus(value: number): value is FailureStatus {
  return value === 400 || value === 404 || value === 409 || value === 500 || value === 503;
}

function availability(value: unknown): SimulatorLiveAvailability | null {
  if (!isRecord(value) || typeof value["enabled"] !== "boolean") return null;
  const runtimeProfile = value["runtimeProfile"];
  const supported = value["supportedScenarioRevisions"];
  if (
    (runtimeProfile !== "demo" && runtimeProfile !== "development" && runtimeProfile !== "test") ||
    !Array.isArray(supported) ||
    supported.length > 16
  ) {
    return null;
  }
  const revisions: Array<{ scenarioId: string; revision: number }> = [];
  for (const item of supported) {
    if (
      !isRecord(item) ||
      typeof item["scenarioId"] !== "string" ||
      !opaqueIdentifier.test(item["scenarioId"]) ||
      !Number.isSafeInteger(item["revision"]) ||
      Number(item["revision"]) < 1 ||
      Number(item["revision"]) > 100
    ) {
      return null;
    }
    revisions.push({ scenarioId: item["scenarioId"], revision: Number(item["revision"]) });
  }
  return Object.freeze({
    enabled: value["enabled"],
    runtimeProfile,
    supportedScenarioRevisions: Object.freeze(revisions),
  });
}

function accepted(value: unknown): SimulatorLiveAccepted | null {
  if (
    !isRecord(value) ||
    typeof value["operationId"] !== "string" ||
    !opaqueIdentifier.test(value["operationId"]) ||
    !Number.isSafeInteger(value["resourceVersion"]) ||
    Number(value["resourceVersion"]) < 0
  ) {
    return null;
  }
  return Object.freeze({
    operationId: value["operationId"],
    resourceVersion: Number(value["resourceVersion"]),
    statusLocation: "",
  });
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function projection(
  value: unknown,
  expected?: Readonly<{
    operationId: string;
    scenarioId?: string;
    scenarioRevision?: number;
  }>,
): SimulatorLiveProjection | null {
  if (!isRecord(value)) return null;
  const stage = value["stage"];
  const terminalOutcome = value["terminalOutcome"];
  const allowedOutcomes: ReadonlySet<unknown> = new Set([
    null,
    "observation_recorded",
    "evidence_incomplete",
    "recovery_candidate",
    "provider_failed",
    "provider_timeout",
    "blocked",
    "no_answer",
    "busy",
    "evidence_unavailable",
  ]);
  const terminal = value["terminal"];
  if (
    !boundedString(value["operationId"], 128) ||
    !opaqueIdentifier.test(value["operationId"]) ||
    !Number.isSafeInteger(value["resourceVersion"]) ||
    Number(value["resourceVersion"]) < 0 ||
    (stage !== "scheduled" &&
      stage !== "calling" &&
      stage !== "extracting" &&
      stage !== "terminal") ||
    typeof terminal !== "boolean" ||
    !allowedOutcomes.has(terminalOutcome) ||
    !boundedString(value["scenarioId"], 128) ||
    !Number.isSafeInteger(value["scenarioRevision"]) ||
    value["provenance"] !== "SIMULATED" ||
    !Array.isArray(value["transcript"]) ||
    value["transcript"].length > 100 ||
    !Array.isArray(value["readings"]) ||
    value["readings"].length > 32 ||
    !Array.isArray(value["reconciliation"]) ||
    value["reconciliation"].length > 32
  ) {
    return null;
  }
  if (
    expected !== undefined &&
    (value["operationId"] !== expected.operationId ||
      (expected.scenarioId !== undefined && value["scenarioId"] !== expected.scenarioId) ||
      (expected.scenarioRevision !== undefined &&
        value["scenarioRevision"] !== expected.scenarioRevision))
  ) {
    return null;
  }
  if (
    (stage === "terminal") !== terminal ||
    (terminalOutcome === null) === terminal ||
    (terminalOutcome === "recovery_candidate" && value["predecessorOperationId"] === null)
  ) {
    return null;
  }
  const transcript: SimulatorLiveTranscriptTurn[] = [];
  for (const turn of value["transcript"]) {
    if (
      !isRecord(turn) ||
      (turn["speaker"] !== "agent" &&
        turn["speaker"] !== "device" &&
        turn["speaker"] !== "system") ||
      !boundedString(turn["text"], 2_000)
    ) {
      return null;
    }
    transcript.push({ speaker: turn["speaker"], text: turn["text"] });
  }
  const readings: SimulatorLiveReading[] = [];
  const readingStatuses = new Set(["OK", "ALARM", "LOW", "UNKNOWN"]);
  const readingDispositions = new Set([
    "grounded",
    "missing",
    "ambiguous",
    "contradictory",
    "invalid",
  ]);
  for (const reading of value["readings"]) {
    if (
      !isRecord(reading) ||
      !boundedString(reading["zoneId"], 64) ||
      !boundedString(reading["label"], 128) ||
      (reading["value"] !== null && !boundedString(reading["value"], 64)) ||
      (reading["unit"] !== null && !boundedString(reading["unit"], 32)) ||
      !readingStatuses.has(reading["status"] as string) ||
      !readingDispositions.has(reading["disposition"] as string)
    ) {
      return null;
    }
    readings.push({
      zoneId: reading["zoneId"],
      label: reading["label"],
      value: reading["value"],
      unit: reading["unit"],
      status: reading["status"] as SimulatorLiveReading["status"],
      disposition: reading["disposition"] as SimulatorLiveReading["disposition"],
    });
  }
  const reconciliation: Array<{
    zoneId: string;
    disposition: SimulatorLiveProjection["reconciliation"][number]["disposition"];
  }> = [];
  const reconciliationDispositions = new Set([
    "matched",
    "missing",
    "ambiguous",
    "contradictory",
    "invalid",
  ]);
  for (const item of value["reconciliation"]) {
    if (
      !isRecord(item) ||
      !boundedString(item["zoneId"], 64) ||
      !reconciliationDispositions.has(item["disposition"] as string)
    ) {
      return null;
    }
    reconciliation.push({
      zoneId: item["zoneId"],
      disposition: item[
        "disposition"
      ] as SimulatorLiveProjection["reconciliation"][number]["disposition"],
    });
  }
  const evidenceValue = value["evidence"];
  const evidence =
    evidenceValue === null
      ? null
      : isRecord(evidenceValue) &&
          (evidenceValue["quality"] === "complete" ||
            evidenceValue["quality"] === "partial" ||
            evidenceValue["quality"] === "unknown" ||
            evidenceValue["quality"] === "invalid") &&
          (evidenceValue["opaqueReference"] === undefined ||
            boundedString(evidenceValue["opaqueReference"], 256))
        ? Object.freeze({
            quality: evidenceValue["quality"],
            ...(evidenceValue["opaqueReference"] === undefined
              ? {}
              : { opaqueReference: evidenceValue["opaqueReference"] }),
          })
        : undefined;
  const predecessor = value["predecessorOperationId"];
  const dtmfActions = value["dtmfActions"];
  const twilioReconciliation = value["twilioReconciliation"];
  const auxiliaryValue = value["auxiliaryStatus"];
  const auxiliaryStatus =
    auxiliaryValue === null
      ? null
      : isRecord(auxiliaryValue) &&
          (auxiliaryValue["sound"] === "normal" ||
            auxiliaryValue["sound"] === "alarm" ||
            auxiliaryValue["sound"] === "unknown") &&
          (auxiliaryValue["power"] === "mains_available" ||
            auxiliaryValue["power"] === "mains_failed" ||
            auxiliaryValue["power"] === "unknown") &&
          (auxiliaryValue["battery"] === "normal" ||
            auxiliaryValue["battery"] === "low" ||
            auxiliaryValue["battery"] === "unknown") &&
          (auxiliaryValue["output"] === "off" ||
            auxiliaryValue["output"] === "on" ||
            auxiliaryValue["output"] === "unknown")
        ? Object.freeze({
            sound: auxiliaryValue["sound"],
            power: auxiliaryValue["power"],
            battery: auxiliaryValue["battery"],
            output: auxiliaryValue["output"],
          })
        : undefined;
  if (
    evidence === undefined ||
    auxiliaryStatus === undefined ||
    (predecessor !== null &&
      (!boundedString(predecessor, 128) || !opaqueIdentifier.test(predecessor))) ||
    (dtmfActions !== undefined && dtmfActions !== 0) ||
    (twilioReconciliation !== undefined && twilioReconciliation !== "1 matching call")
  ) {
    return null;
  }
  const expectedReadingIdentity = Object.freeze([
    Object.freeze({
      zoneId: "zone-01",
      label: "North house air temperature",
      unit: "degF",
    }),
    Object.freeze({
      zoneId: "zone-02",
      label: "Propagation bench temperature",
      unit: "degF",
    }),
    Object.freeze({
      zoneId: "zone-03",
      label: "Greenhouse relative humidity",
      unit: "percent",
    }),
    Object.freeze({
      zoneId: "zone-04",
      label: "Irrigation reservoir level",
      unit: "percent",
    }),
  ]);
  const exactInventory =
    readings.length === 4 &&
    reconciliation.length === 4 &&
    expectedReadingIdentity.every(
      (identity, index) =>
        readings[index]?.zoneId === identity.zoneId &&
        readings[index]?.label === identity.label &&
        (readings[index]?.disposition === "grounded"
          ? readings[index]?.unit === identity.unit
          : readings[index]?.unit === null) &&
        reconciliation[index]?.zoneId === identity.zoneId,
    );
  if (evidence !== null && !exactInventory) return null;
  const pairwiseConsistent = readings.every((reading, index) => {
    const reconciliationDisposition = reconciliation[index]?.disposition;
    if (reading.disposition === "grounded") {
      return (
        reading.status !== "UNKNOWN" &&
        reading.value !== null &&
        reading.unit !== null &&
        reconciliationDisposition === "matched"
      );
    }
    return (
      reading.status === "UNKNOWN" &&
      reading.value === null &&
      reading.unit === null &&
      reconciliationDisposition === reading.disposition
    );
  });
  if (evidence !== null && !pairwiseConsistent) return null;
  const isClosedCompleteProjection =
    evidence?.quality === "complete" &&
    transcript.length > 0 &&
    auxiliaryStatus !== null &&
    !Object.values(auxiliaryStatus).includes("unknown") &&
    readings.every(
      (reading) =>
        reading.disposition === "grounded" &&
        reading.status !== "UNKNOWN" &&
        reading.value !== null &&
        reading.unit !== null,
    ) &&
    reconciliation.every((item) => item.disposition === "matched");
  if (
    (terminalOutcome === "observation_recorded" || terminalOutcome === "recovery_candidate") &&
    !isClosedCompleteProjection
  ) {
    return null;
  }
  if (
    terminalOutcome === "evidence_incomplete" &&
    (evidence === null || evidence.quality === "complete" || isClosedCompleteProjection)
  ) {
    return null;
  }
  if (
    [
      "provider_failed",
      "provider_timeout",
      "blocked",
      "no_answer",
      "busy",
      "evidence_unavailable",
    ].includes(String(terminalOutcome)) &&
    (evidence !== null ||
      transcript.length > 0 ||
      readings.length > 0 ||
      reconciliation.length > 0 ||
      auxiliaryStatus !== null)
  ) {
    return null;
  }
  if (
    terminalOutcome === null &&
    (evidence !== null ||
      transcript.length > 0 ||
      readings.length > 0 ||
      reconciliation.length > 0 ||
      auxiliaryStatus !== null)
  ) {
    return null;
  }
  if (
    (terminalOutcome === "observation_recorded" && predecessor !== null) ||
    (terminalOutcome === "recovery_candidate" && predecessor === null)
  ) {
    return null;
  }
  return Object.freeze({
    operationId: value["operationId"],
    resourceVersion: Number(value["resourceVersion"]),
    stage,
    terminal: terminal as boolean,
    terminalOutcome: terminalOutcome as SimulatorLiveProjection["terminalOutcome"],
    scenarioId: value["scenarioId"],
    scenarioRevision: Number(value["scenarioRevision"]),
    provenance: "SIMULATED",
    transcript: Object.freeze(transcript),
    evidence,
    readings: Object.freeze(readings),
    reconciliation: Object.freeze(reconciliation),
    auxiliaryStatus,
    predecessorOperationId: predecessor,
    ...(dtmfActions === 0 ? { dtmfActions: 0 as const } : {}),
    ...(twilioReconciliation === "1 matching call"
      ? { twilioReconciliation: "1 matching call" as const }
      : {}),
  });
}

async function json(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json"))
    return null;
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return null;
  try {
    if (response.body === null) return null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let text = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          return null;
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function createSimulatorLiveClient(options: {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
}): SimulatorLiveClient {
  const baseUrl = options.baseUrl.replace(/\/$/u, "");
  if (baseUrl !== "" && !/^https?:\/\//u.test(baseUrl)) {
    throw new Error("Invalid Simulator Lab host base URL");
  }
  const request = options.fetch ?? globalThis.fetch;
  const statusLocations = new Map<
    string,
    Readonly<{ location: string; scenarioId: string; scenarioRevision: number }>
  >();
  const call = async <T, S extends number>(input: {
    readonly path: string;
    readonly successStatus: S;
    readonly validate: (value: unknown) => T | null;
    readonly init?: RequestInit;
  }): Promise<SimulatorLiveResult<T, S>> => {
    let response: Response;
    try {
      response = await request(`${baseUrl}${input.path}`, input.init);
    } catch {
      return Object.freeze({
        ok: false,
        status: "transport_error",
        error: null,
        headers: headers(),
      });
    }
    const boundedHeaders = headers(response);
    const body = await json(response);
    if (response.status === input.successStatus) {
      const data = input.validate(body);
      if (data !== null) {
        return Object.freeze({
          ok: true,
          status: input.successStatus,
          data,
          headers: boundedHeaders,
        });
      }
      return Object.freeze({
        ok: false,
        status: "transport_error",
        error: null,
        headers: headers(),
      });
    }
    if (failureStatus(response.status)) {
      return Object.freeze({
        ok: false,
        status: response.status,
        error: safeError(body),
        headers: boundedHeaders,
      });
    }
    return Object.freeze({ ok: false, status: "transport_error", error: null, headers: headers() });
  };
  return Object.freeze({
    getAvailability: async () =>
      await call({
        path: "/api/v1/live-simulator/capability",
        successStatus: 200,
        validate: availability,
      }),
    requestLiveObservation: async (input: {
      readonly scenarioId: string;
      readonly scenarioRevision: number;
      readonly permit: string;
    }) => {
      if (
        !opaqueIdentifier.test(input.scenarioId) ||
        !Number.isSafeInteger(input.scenarioRevision) ||
        input.scenarioRevision < 1 ||
        input.scenarioRevision > 100 ||
        input.permit.length < 1 ||
        input.permit.length > 4_096
      ) {
        return Object.freeze({
          ok: false,
          status: 400,
          error: Object.freeze({
            code: "validation_error" as const,
            message: "Live observation request is invalid.",
          }),
          headers: headers(),
        });
      }
      const result = await call({
        path: "/api/v1/live-simulator/operations",
        successStatus: 202,
        validate: accepted,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scenarioId: input.scenarioId,
            scenarioRevision: input.scenarioRevision,
            permit: input.permit,
          }),
        },
      });
      if (!result.ok) return result;
      const expectedLocation = `/api/v1/live-simulator/operations/${result.data.operationId}`;
      if (result.headers.location !== expectedLocation) {
        return Object.freeze({
          ok: false,
          status: "transport_error" as const,
          error: null,
          headers: headers(),
        });
      }
      statusLocations.set(
        result.data.operationId,
        Object.freeze({
          location: result.headers.location,
          scenarioId: input.scenarioId,
          scenarioRevision: input.scenarioRevision,
        }),
      );
      return Object.freeze({
        ...result,
        data: Object.freeze({ ...result.data, statusLocation: result.headers.location }),
      });
    },
    getLiveObservation: async (
      operationId: string,
      requestOptions?: {
        readonly signal?: AbortSignal;
        readonly scenarioId?: string;
        readonly scenarioRevision?: number;
      },
    ) => {
      if (!opaqueIdentifier.test(operationId)) {
        return Object.freeze({
          ok: false,
          status: 400,
          error: Object.freeze({
            code: "validation_error" as const,
            message: "Live operation identity is invalid.",
          }),
          headers: headers(),
        });
      }
      const admitted = statusLocations.get(operationId);
      return await call({
        path:
          admitted?.location ??
          `/api/v1/live-simulator/operations/${encodeURIComponent(operationId)}`,
        successStatus: 200,
        validate: (value) =>
          projection(value, {
            operationId,
            ...((requestOptions?.scenarioId ?? admitted?.scenarioId) === undefined
              ? {}
              : { scenarioId: requestOptions?.scenarioId ?? admitted?.scenarioId }),
            ...((requestOptions?.scenarioRevision ?? admitted?.scenarioRevision) === undefined
              ? {}
              : {
                  scenarioRevision: requestOptions?.scenarioRevision ?? admitted?.scenarioRevision,
                }),
          }),
        init: {
          method: "GET",
          headers: { "cache-control": "no-store" },
          ...(requestOptions?.signal === undefined ? {} : { signal: requestOptions.signal }),
        },
      });
    },
    finishLiveDemoReview: async (
      cleanupPath: string,
      requestOptions?: { readonly signal?: AbortSignal },
    ) => {
      if (
        !/^\/api\/v1\/live-demo-review\/sessions\/review-[A-Za-z0-9._:-]{1,127}$/u.test(cleanupPath)
      ) {
        return Object.freeze({
          ok: false as const,
          status: 400 as const,
          error: Object.freeze({
            code: "validation_error" as const,
            message: "Live observation request is invalid." as const,
          }),
          headers: headers(),
        });
      }
      return await call({
        path: cleanupPath,
        successStatus: 200,
        validate: (value): SimulatorLiveReviewCleanup | null =>
          isRecord(value) &&
          value["outcome"] === "deleted" &&
          value["message"] === "Protected demo result deleted"
            ? Object.freeze({
                outcome: "deleted" as const,
                message: "Protected demo result deleted" as const,
              })
            : null,
        init: {
          method: "DELETE",
          headers: { "cache-control": "no-store" },
          ...(requestOptions?.signal === undefined ? {} : { signal: requestOptions.signal }),
        },
      });
    },
  });
}
