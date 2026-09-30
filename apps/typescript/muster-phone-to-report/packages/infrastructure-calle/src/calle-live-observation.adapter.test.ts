import { afterEach, describe, expect, it, vi } from "vitest";

async function loadAdapterApi(): Promise<Record<string, unknown>> {
  try {
    return (await import("./calle-live-observation.adapter.js")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const request = Object.freeze({
  apiToken: "test-only-provider-key",
  targetAddress: "test-only-synthetic-target",
  endpointAlias: "greenhouse-synthetic",
  operationId: "operation-live-001",
  providerDispatchIdentity: "provider-dispatch-live-001",
  scenarioId: "synthetic-normal",
  scenarioRevision: 2,
  timeoutMs: 60_000,
  retryLimit: 0 as const,
  dtmfPolicy: Object.freeze({ kind: "forbidden" as const, allowlist: Object.freeze([]) }),
  traceContext: Object.freeze({
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  }),
  signal: new AbortController().signal,
});

function completedSdkResult() {
  const values = [
    ["zone-01", "71.5", "degrees Fahrenheit", "OK"],
    ["zone-02", "68.0", "degrees Fahrenheit", "OK"],
    ["zone-03", "68", "percent", "OK"],
    ["zone-04", "82", "percent", "OK"],
  ] as const;
  return {
    id: "provider-call-opaque",
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.96, label: "high" },
    evidence: ["Four zone report was observed."],
    structuredResult: {
      readings: values.map(([zone_id, value_token, spoken_unit_token, reading_status]) => ({
        zone_id,
        value_token,
        spoken_unit_token,
        reading_status,
      })),
      auxiliary_status: {
        sound: "normal",
        power: "mains_available",
        battery: "normal",
        output: "off",
      },
    },
    recipients: [
      {
        structuredResult: null,
        attempts: [
          {
            transcriptTurns: [
              { offset_seconds: 0, speaker: "bot", text: "Please provide the report." },
              {
                offset_seconds: 2,
                speaker: "user",
                text:
                  "Zone 1 is 71.5 degrees Fahrenheit, status OK. " +
                  "Zone 2 is 68.0 degrees Fahrenheit, status OK. " +
                  "Zone 3 is 68 percent, status OK. " +
                  "Zone 4 is 82 percent, status OK.",
              },
              { offset_seconds: 8, speaker: "bot", text: "Please provide auxiliary status." },
              {
                offset_seconds: 10,
                speaker: "user",
                text: "Sound is normal. Power is mains available. Battery is normal. Output is off.",
              },
            ],
          },
        ],
      },
    ],
    completedAt: "2026-08-10T12:00:00.000Z",
  };
}

function completedApiCall(callId = "provider-call-opaque") {
  const result = completedSdkResult();
  return {
    id: callId,
    object: "call",
    status: "completed",
    task: "test-only documented task",
    recipients: result.recipients.map((recipient, recipientIndex) => ({
      id: `recipient-${String(recipientIndex + 1)}`,
      phones: ["test-only-synthetic-target"],
      locale: "en-US",
      region: "US",
      status: "completed",
      structured_result: recipient.structuredResult,
      summary: null,
      attempts: recipient.attempts.map((attempt, attemptIndex) => ({
        id: `attempt-${String(attemptIndex + 1)}`,
        phone: "test-only-synthetic-target",
        status: "completed",
        started_at: "2026-08-10T11:59:55.000Z",
        completed_at: result.completedAt,
        summary: null,
        transcript_turns: attempt.transcriptTurns,
        provider_call_id: null,
        failure_code: null,
        failure_message: null,
      })),
    })),
    structured_result: result.structuredResult,
    summary: null,
    task_completed: result.taskCompleted,
    completion_confidence: result.completionConfidence,
    evidence: result.evidence,
    metadata: {},
    failure_code: null,
    failure_message: null,
    created_at: "2026-08-10T11:59:50.000Z",
    completed_at: result.completedAt,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function defaultFetchAdapter(api: Record<string, unknown>) {
  return (api["createCalleLiveObservationAdapter"] as CallableFunction)({
    custody: {
      writeProviderTaskReference: taskReferenceWriter(),
      write: vi.fn().mockResolvedValue({
        opaqueReference: "custody-fetch-boundary",
        integritySha256: "d".repeat(64),
        byteLength: 64,
      }),
    },
  }) as { dispatch(input: unknown): Promise<unknown> };
}

function createResponseDiagnostics(value: unknown): unknown {
  if (!(value instanceof Error) || value.cause === null || typeof value.cause !== "object") {
    return undefined;
  }
  return (value.cause as Record<string, unknown>)["diagnostics"];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function sdkCalls(result: ReturnType<typeof completedSdkResult>) {
  return {
    create: async () => ({ id: result.id }),
    waitForResult: async () => result,
  };
}

function taskReferenceWriter() {
  return vi.fn(async () => undefined);
}

const admissionDiagnosticClasses = Object.freeze([
  "terminal_shape",
  "reading_shape",
  "zone_identity",
  "anchor_value",
  "anchor_unit",
  "anchor_status",
  "auxiliary_status",
] as const);

type AdmissionDiagnosticClass = (typeof admissionDiagnosticClasses)[number];
type CompletedSdkResult = ReturnType<typeof completedSdkResult>;

const protectedSentinels = Object.freeze({
  value: "private-value-sentinel",
  zone: "private-zone-sentinel",
  transcript: "private-transcript-sentinel",
  target: "private-target-sentinel",
  identifier: "private-provider-identifier-sentinel",
  credential: "private-credential-sentinel",
  permit: "private-permit-sentinel",
  custody: "private-custody-sentinel",
  rawPayload: "private-raw-payload-sentinel",
});

function structuredResultRecord(result: CompletedSdkResult): Record<string, unknown> {
  return result.structuredResult as unknown as Record<string, unknown>;
}

function readingRecords(result: CompletedSdkResult): Record<string, unknown>[] {
  return structuredResultRecord(result)["readings"] as Record<string, unknown>[];
}

interface HostileAdmissionVariant {
  readonly label: string;
  readonly expected: AdmissionDiagnosticClass;
  readonly mutate: (result: CompletedSdkResult) => void;
}

interface HostileAdmissionCase {
  readonly label: string;
  readonly variants: readonly HostileAdmissionVariant[];
}

interface CapturedCreateInput {
  readonly task: string;
  readonly resultSchema: Readonly<{
    properties: Readonly<{
      readings: Readonly<{
        description?: string;
        items: Readonly<{
          required: readonly string[];
          properties: Readonly<{
            zone_id: Readonly<{ enum?: readonly string[] }>;
            reading_status: Readonly<{ enum?: readonly string[] }>;
            value_token: Readonly<{ type: string; description?: string }>;
          }>;
        }>;
      }>;
    }>;
  }>;
  readonly recipientResultSchema?: unknown;
}

async function captureCreateInput(): Promise<CapturedCreateInput> {
  const api = await loadAdapterApi();
  const result = completedSdkResult();
  const create = vi.fn(async () => ({ id: result.id }));
  const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
    createClient: () => ({ calls: { create, waitForResult: async () => result } }),
    custody: {
      writeProviderTaskReference: taskReferenceWriter(),
      write: vi.fn().mockResolvedValue({
        opaqueReference: "custody-schema",
        integritySha256: "f".repeat(64),
        byteLength: 64,
      }),
    },
  }) as { dispatch(input: unknown): Promise<unknown> };

  await adapter.dispatch(request);

  return create.mock.calls[0]![0] as unknown as CapturedCreateInput;
}

describe("CALL-E live observation adapter", () => {
  it("disables redirects on the create POST so it cannot be repeated", async () => {
    const api = await loadAdapterApi();
    const networkRequests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (providerRequest: Request) => {
        networkRequests.push(providerRequest);
        return jsonResponse(completedApiCall(), providerRequest.method === "POST" ? 201 : 200);
      }),
    );

    await expect(defaultFetchAdapter(api).dispatch(request)).resolves.toMatchObject({
      providerCallId: "provider-call-opaque",
    });

    expect(networkRequests[0]).toMatchObject({ method: "POST", redirect: "error" });
    expect(networkRequests.filter(({ method }) => method === "POST")).toHaveLength(1);
  });

  it("preserves the documented JSON create response without a recovery request", async () => {
    const api = await loadAdapterApi();
    const networkRequests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (providerRequest: Request) => {
        networkRequests.push(providerRequest);
        return jsonResponse(completedApiCall(), providerRequest.method === "POST" ? 201 : 200);
      }),
    );

    await expect(defaultFetchAdapter(api).dispatch(request)).resolves.toMatchObject({
      providerCallId: "provider-call-opaque",
      terminalStatus: "completed",
    });

    expect(networkRequests.map(({ method }) => method)).toEqual(["POST", "GET"]);
    expect(networkRequests.filter(({ method }) => method === "POST")).toHaveLength(1);
  });

  it("leaves non-success create responses under the existing SDK classification", async () => {
    const api = await loadAdapterApi();
    const networkRequests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (providerRequest: Request) => {
        networkRequests.push(providerRequest);
        return jsonResponse(
          {
            error: {
              code: "rate_limit_exceeded",
              message: "private provider explanation",
            },
          },
          429,
        );
      }),
    );

    const failure = await defaultFetchAdapter(api)
      .dispatch(request)
      .catch((error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("CALL-E provider terminal: provider_rate_limited");
    expect(networkRequests.map(({ method }) => method)).toEqual(["POST"]);
    expect(JSON.stringify(failure)).not.toContain("private provider explanation");
  });

  it("recovers empty successful 201 and 204 creates with one same-context GET", async () => {
    for (const createResponse of [
      () =>
        new Response(null, {
          status: 201,
          headers: {
            location: "/v1/calls/provider-call-opaque",
            "x-request-id": "private-provider-request-id",
          },
        }),
      () =>
        new Response(null, {
          status: 204,
          headers: {
            location: "https://api.heycall-e.com/v1/calls/provider-call-opaque",
            "content-length": "0",
            "x-request-id": "private-provider-request-id",
          },
        }),
    ]) {
      const api = await loadAdapterApi();
      const abortController = new AbortController();
      const networkRequests: Request[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (providerRequest: Request) => {
          networkRequests.push(providerRequest);
          return providerRequest.method === "POST"
            ? createResponse()
            : jsonResponse(completedApiCall());
        }),
      );

      await expect(
        defaultFetchAdapter(api).dispatch({
          ...request,
          traceContext: {
            ...request.traceContext,
            tracestate: "vendor=test-only-opaque-state",
          },
          signal: abortController.signal,
        }),
      ).resolves.toMatchObject({
        providerCallId: "provider-call-opaque",
        terminalStatus: "completed",
      });

      expect(networkRequests.map(({ method }) => method)).toEqual(["POST", "GET"]);
      const [createRequest, recoveryRequest] = networkRequests;
      expect(createRequest?.headers.get("idempotency-key")).toBe("provider-dispatch-live-001");
      expect(recoveryRequest?.url).toBe("https://api.heycall-e.com/v1/calls/provider-call-opaque");
      expect(recoveryRequest?.redirect).toBe("error");
      expect(recoveryRequest?.headers.get("authorization")).toBe("Bearer test-only-provider-key");
      expect(recoveryRequest?.headers.get("traceparent")).toBe(request.traceContext.traceparent);
      expect(recoveryRequest?.headers.get("tracestate")).toBe("vendor=test-only-opaque-state");
      expect(recoveryRequest?.headers.has("idempotency-key")).toBe(false);
      abortController.abort();
      expect(networkRequests.every(({ signal }) => signal.aborted)).toBe(true);
    }
  });

  it("rejects whitespace and JSON-null success bodies without treating other id headers as request ids", async () => {
    for (const body of ["  \r\n  ", "null"]) {
      const api = await loadAdapterApi();
      const networkRequests: Request[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (providerRequest: Request) => {
          networkRequests.push(providerRequest);
          return new Response(body, {
            status: 201,
            headers: {
              "content-type": "application/json",
              location: "/v1/calls/provider-call-opaque",
              "x-correlation-id": "private-correlation-id",
              "x-provider-debug-id": "private-debug-id",
            },
          });
        }),
      );

      const failure = await defaultFetchAdapter(api)
        .dispatch(request)
        .catch((error) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        "CALL-E provider terminal: provider_create_response_invalid",
      );
      expect(networkRequests.map(({ method }) => method)).toEqual(["POST"]);
      expect(createResponseDiagnostics(failure)).toEqual({
        statusCode: 201,
        contentType: "json",
        body: "present",
        location: "exact_call_resource",
        requestIdPresent: false,
      });
      expect(JSON.stringify(createResponseDiagnostics(failure))).not.toMatch(
        /private-correlation-id|private-debug-id/iu,
      );
    }
  });

  it("rejects malformed or identity-free non-empty success bodies before the SDK maps them", async () => {
    for (const body of [
      "{",
      JSON.stringify({ object: "call", status: "queued" }),
      JSON.stringify({ id: "unsafe/provider-call", object: "call", status: "queued" }),
    ]) {
      const api = await loadAdapterApi();
      const networkRequests: Request[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (providerRequest: Request) => {
          networkRequests.push(providerRequest);
          return new Response(body, {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }),
      );

      const failure = await defaultFetchAdapter(api)
        .dispatch(request)
        .catch((error) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        "CALL-E provider terminal: provider_create_response_invalid",
      );
      expect(networkRequests.map(({ method }) => method)).toEqual(["POST"]);
      expect(createResponseDiagnostics(failure)).toEqual({
        statusCode: 201,
        contentType: "json",
        body: "present",
        location: "missing",
        requestIdPresent: false,
      });
      expect(JSON.stringify(failure)).not.toContain("unsafe/provider-call");
    }
  });

  it("classifies a safe-id response with a malformed remaining call shape without provider data", async () => {
    const api = await loadAdapterApi();
    const networkRequests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (providerRequest: Request) => {
        networkRequests.push(providerRequest);
        return jsonResponse(
          {
            id: "provider-call-opaque",
            recipients: "private-provider-recipient-identifier",
          },
          201,
        );
      }),
    );

    const failure = await defaultFetchAdapter(api)
      .dispatch(request)
      .catch((error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "CALL-E provider terminal: provider_create_response_invalid",
    );
    expect(networkRequests.map(({ method }) => method)).toEqual(["POST"]);
    expect(createResponseDiagnostics(failure)).toEqual({
      statusCode: 201,
      contentType: "json",
      body: "present",
      location: "missing",
      requestIdPresent: false,
    });
    expect(JSON.stringify(failure)).not.toMatch(
      /provider-call-opaque|private-provider-recipient-identifier/iu,
    );
  });

  it("classifies a JSON call body under a non-JSON content type before SDK mapping", async () => {
    const api = await loadAdapterApi();
    const networkRequests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (providerRequest: Request) => {
        networkRequests.push(providerRequest);
        return new Response(JSON.stringify(completedApiCall()), {
          status: 201,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }),
    );

    const failure = await defaultFetchAdapter(api)
      .dispatch(request)
      .catch((error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "CALL-E provider terminal: provider_create_response_invalid",
    );
    expect(networkRequests.map(({ method }) => method)).toEqual(["POST"]);
    expect(createResponseDiagnostics(failure)).toEqual({
      statusCode: 201,
      contentType: "text",
      body: "present",
      location: "missing",
      requestIdPresent: false,
    });
  });

  it("propagates AbortError unchanged during create body inspection and the recovery GET", async () => {
    for (const abortPoint of ["body", "recovery"] as const) {
      const api = await loadAdapterApi();
      const abortError = new DOMException(`test-only-${abortPoint}-abort`, "AbortError");
      const networkRequests: Request[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (providerRequest: Request) => {
          networkRequests.push(providerRequest);
          if (abortPoint === "body") {
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(abortError);
                },
              }),
              { status: 201, headers: { "content-type": "application/json" } },
            );
          }
          if (providerRequest.method === "POST") {
            return new Response(null, {
              status: 204,
              headers: { location: "/v1/calls/provider-call-opaque" },
            });
          }
          throw abortError;
        }),
      );

      const failure = await defaultFetchAdapter(api)
        .dispatch(request)
        .catch((error) => error);

      expect(failure).toBe(abortError);
      expect(networkRequests.map(({ method }) => method)).toEqual(
        abortPoint === "body" ? ["POST"] : ["POST", "GET"],
      );
    }
  });

  it("rejects ASCII controls in Location before URL normalization without a recovery GET", async () => {
    for (const control of ["\t", "\u0001", "\u001f", "\u007f"]) {
      const api = await loadAdapterApi();
      const networkRequests: Request[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (providerRequest: Request) => {
          networkRequests.push(providerRequest);
          return providerRequest.method === "POST"
            ? new Response(null, {
                status: 201,
                headers: { location: `/v1/calls/provider${control}-call` },
              })
            : jsonResponse(completedApiCall("provider-call"));
        }),
      );

      const failure = await defaultFetchAdapter(api)
        .dispatch(request)
        .catch((error) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        "CALL-E provider terminal: provider_create_response_invalid",
      );
      expect(networkRequests.map(({ method }) => method)).toEqual(["POST"]);
      expect(createResponseDiagnostics(failure)).toEqual({
        statusCode: 201,
        contentType: "missing",
        body: "absent",
        location: "invalid",
        requestIdPresent: false,
      });
      expect(JSON.stringify(createResponseDiagnostics(failure))).not.toContain(control);
    }
  });

  it("rejects missing, malformed, cross-origin, encoded, or non-resource Locations without GET", async () => {
    const cases = [
      { location: undefined, classification: "missing" },
      { location: "http://[", classification: "invalid" },
      {
        location: "https://example.invalid/v1/calls/provider-call-opaque",
        classification: "cross_origin",
      },
      {
        location: "https://test-user@api.heycall-e.com/v1/calls/provider-call-opaque",
        classification: "invalid_call_resource",
      },
      { location: "/v1/goals/provider-call-opaque", classification: "invalid_call_resource" },
      {
        location: "/v1/calls/provider%2Dcall%2Dopaque",
        classification: "invalid_call_resource",
      },
      {
        location: "/v1/calls/provider-call-opaque/events",
        classification: "invalid_call_resource",
      },
      {
        location: "/v1/calls/provider-call-opaque?token=private-location-value",
        classification: "invalid_call_resource",
      },
      { location: "/v1/calls/provider-call-opaque#", classification: "invalid_call_resource" },
    ] as const;

    for (const testCase of cases) {
      const api = await loadAdapterApi();
      const networkRequests: Request[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (providerRequest: Request) => {
          networkRequests.push(providerRequest);
          return new Response(null, {
            status: 201,
            headers: {
              ...(testCase.location === undefined ? {} : { location: testCase.location }),
              "content-length": "0",
              "content-type": "text/plain; charset=utf-8",
              "x-request-id": "private-provider-request-id",
            },
          });
        }),
      );

      const failure = await defaultFetchAdapter(api)
        .dispatch(request)
        .catch((error) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        "CALL-E provider terminal: provider_create_response_invalid",
      );
      expect(networkRequests.map(({ method }) => method)).toEqual(["POST"]);
      expect(createResponseDiagnostics(failure)).toEqual({
        statusCode: 201,
        contentType: "text",
        body: "absent",
        location: testCase.classification,
        requestIdPresent: true,
      });
      expect(JSON.stringify(createResponseDiagnostics(failure))).not.toMatch(
        /private|provider-call|token=|example\.invalid/iu,
      );
    }
  });

  it("fails closed when the bounded recovery GET fails or returns a mismatched call id", async () => {
    for (const recoveryResponse of [
      () =>
        new Response("private provider failure", {
          status: 503,
          headers: { "content-type": "text/plain" },
        }),
      () => jsonResponse(completedApiCall("private-mismatched-provider-call")),
      () => jsonResponse({ id: "provider-call-opaque" }),
    ]) {
      const api = await loadAdapterApi();
      const networkRequests: Request[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (providerRequest: Request) => {
          networkRequests.push(providerRequest);
          return providerRequest.method === "POST"
            ? new Response(null, {
                status: 204,
                headers: {
                  location: "/v1/calls/provider-call-opaque",
                  "x-request-id": "private-provider-request-id",
                },
              })
            : recoveryResponse();
        }),
      );

      const failure = await defaultFetchAdapter(api)
        .dispatch(request)
        .catch((error) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        "CALL-E provider terminal: provider_create_response_invalid",
      );
      expect(networkRequests.map(({ method }) => method)).toEqual(["POST", "GET"]);
      expect(createResponseDiagnostics(failure)).toEqual({
        statusCode: 204,
        contentType: "missing",
        body: "absent",
        location: "exact_call_resource",
        requestIdPresent: true,
      });
      expect(JSON.stringify(failure)).not.toMatch(
        /private provider failure|private-mismatched-provider-call|private-provider-request-id/iu,
      );
    }
  });

  it("uses only the documented CALL-E schema subset with extraction descriptions", async () => {
    const createInput = await captureCreateInput();
    const allowedKeywords = new Set([
      "type",
      "properties",
      "required",
      "enum",
      "items",
      "description",
      "additionalProperties",
    ]);
    const visit = (value: unknown, path: string): void => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return;
      for (const [key, child] of Object.entries(value)) {
        if (path.endsWith(".properties")) {
          visit(child, `${path}.${key}`);
          continue;
        }
        expect(allowedKeywords, `${path}.${key}`).toContain(key);
        visit(child, `${path}.${key}`);
      }
    };

    visit(createInput.resultSchema, "resultSchema");
    expect(JSON.stringify(createInput.resultSchema)).not.toMatch(
      /maxLength|minItems|maxItems|minimum|maximum/u,
    );
    expect(JSON.stringify(createInput.resultSchema)).not.toMatch(
      /provider_?revision|confidence_?token|normalized_?unit|source_?completeness|turn_?index/iu,
    );
    expect(createInput.resultSchema.properties.readings.description).toBeTypeOf("string");
    expect(createInput.recipientResultSchema).toBeUndefined();
  });

  it("constrains provider zones to the exact runtime contract", async () => {
    const createInput = await captureCreateInput();
    const readingProperties = createInput.resultSchema.properties.readings.items.properties;

    expect(readingProperties.zone_id.enum).toEqual(["zone-01", "zone-02", "zone-03", "zone-04"]);
  });

  it("includes LOW in the provider status schema", async () => {
    const createInput = await captureCreateInput();
    const readingProperties = createInput.resultSchema.properties.readings.items.properties;

    expect(readingProperties.reading_status.enum).toEqual(["OK", "ALARM", "LOW", "UNKNOWN"]);
  });

  it("requests only observable reading tokens that Muster can ground locally", async () => {
    const createInput = await captureCreateInput();
    const readingSchema = createInput.resultSchema.properties.readings.items;

    expect(readingSchema.required).toEqual([
      "zone_id",
      "value_token",
      "spoken_unit_token",
      "reading_status",
    ]);
    expect(readingSchema.properties.value_token).toMatchObject({
      type: "string",
      description: expect.stringMatching(/complete numeric token/iu),
    });
  });

  it("instructs the provider to use exact zones and copy complete transcript tokens", async () => {
    const createInput = await captureCreateInput();

    expect(createInput.task).toMatch(/zone-01.*zone-02.*zone-03.*zone-04/su);
    expect(createInput.task).toMatch(
      /copy.*complete numeric token.*Muster grounds.*device transcript/isu,
    );
    expect(createInput.task).toMatch(/do not invent.*revision.*confidence.*normal/isu);
    expect(createInput.task).toContain('When connected, say "Hello" once, then listen silently.');
    expect(createInput.task).toContain("Do not speak again while the report is playing.");
    expect(createInput.task).not.toContain("Remain silent while it speaks.");
    expect(createInput.task).toContain("Do not press any keys or send DTMF.");
    expect(createInput.task).toContain(
      "continues after Zone 4 with sound, power, battery, and output statuses",
    );
    expect(createInput.task).toContain("remote endpoint ends the call");
    expect(createInput.task).toContain("never infer missing statuses");
  });

  it("persists the created task id before waiting on the documented SDK contract", async () => {
    const api = await loadAdapterApi();
    expect(api["createCalleLiveObservationAdapter"]).toBeTypeOf("function");
    const order: string[] = [];
    const create = vi.fn(async () => {
      order.push("create");
      return { id: "provider-call-opaque" };
    });
    const waitForResult = vi.fn(async () => {
      order.push("wait");
      return completedSdkResult();
    });
    const writeProviderTaskReference = vi.fn(async () => {
      order.push("persist-task");
    });
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: vi.fn(() => ({ calls: { create, waitForResult } })),
      custody: {
        writeProviderTaskReference,
        write: vi.fn().mockResolvedValue({
          opaqueReference: "custody-opaque",
          integritySha256: "a".repeat(64),
          byteLength: 32,
        }),
      },
    }) as { dispatch(input: unknown): Promise<unknown> };

    await adapter.dispatch(request);

    expect(order.slice(0, 3)).toEqual(["create", "persist-task", "wait"]);
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.stringMatching(/exactly one outbound dial attempt.*do not redial or retry/iu),
        recipients: [{ phones: ["test-only-synthetic-target"], region: "US", locale: "en-US" }],
        resultSchema: expect.objectContaining({
          type: "object",
          additionalProperties: false,
          required: ["readings", "auxiliary_status"],
        }),
      }),
      { idempotencyKey: "provider-dispatch-live-001" },
    );
    expect(waitForResult).toHaveBeenCalledWith("provider-call-opaque", { timeoutMs: 60_000 });
    expect(writeProviderTaskReference).toHaveBeenCalledWith({
      operationId: "operation-live-001",
      providerTaskId: "provider-call-opaque",
    });
    expect(create.mock.calls[0]![0].task).not.toContain("test-only-synthetic-target");
    expect(create.mock.calls[0]![0]).not.toHaveProperty("recipientResultSchema");
    expect(JSON.stringify(create.mock.calls[0])).not.toMatch(/runAuthorization|permit/iu);
  });

  it("reconciles the persisted provider task without creating another call", async () => {
    const api = await loadAdapterApi();
    const result = completedSdkResult();
    const create = vi.fn();
    const waitForResult = vi.fn(async () => result);
    const readProviderTaskReference = vi.fn(async () => "provider-call-opaque");
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: vi.fn(() => ({ calls: { create, waitForResult } })),
      custody: {
        readProviderTaskReference,
        writeProviderTaskReference: taskReferenceWriter(),
        write: vi.fn().mockResolvedValue({
          opaqueReference: "custody-reconciled",
          integritySha256: "b".repeat(64),
          byteLength: 64,
        }),
      },
    }) as {
      dispatch(input: unknown): Promise<unknown>;
      reconcile(input: unknown): Promise<unknown>;
    };

    await expect(adapter.reconcile(request)).resolves.toMatchObject({
      providerCallId: "provider-call-opaque",
      terminalStatus: "completed",
    });

    expect(readProviderTaskReference).toHaveBeenCalledWith({ operationId: "operation-live-001" });
    expect(waitForResult).toHaveBeenCalledWith("provider-call-opaque", { timeoutMs: 60_000 });
    expect(create).not.toHaveBeenCalled();
  });

  it("waits for provider terminal before safely reporting unavailable task-reference custody", async () => {
    const api = await loadAdapterApi();
    const order: string[] = [];
    const transcriptWrite = vi.fn();
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: () => ({
        calls: {
          create: async () => {
            order.push("create");
            return { id: "provider-call-opaque" };
          },
          waitForResult: async () => {
            order.push("wait");
            return completedSdkResult();
          },
        },
      }),
      custody: {
        writeProviderTaskReference: async () => {
          order.push("persist-task");
          throw new Error("private custody path");
        },
        write: transcriptWrite,
      },
    }) as { dispatch(input: unknown): Promise<unknown> };

    const failure = await adapter.dispatch(request).catch((error: unknown) => error);

    expect(order).toEqual(["create", "persist-task", "wait"]);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "CALL-E provider terminal: provider_evidence_unavailable",
    );
    expect(JSON.stringify(failure)).not.toContain("private custody path");
    expect(transcriptWrite).not.toHaveBeenCalled();
  });

  it("reduces provider API failures to an allowlisted safe terminal class", async () => {
    const api = await loadAdapterApi();
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: () => ({
        calls: {
          create: async () =>
            await Promise.reject(
              Object.assign(new Error("private provider explanation"), {
                name: "CalleAPIError",
                code: "insufficient_balance",
                status: 402,
              }),
            ),
          waitForResult: vi.fn(),
        },
      }),
      custody: { writeProviderTaskReference: taskReferenceWriter(), write: vi.fn() },
    }) as { dispatch(input: unknown): Promise<unknown> };

    await expect(adapter.dispatch(request)).rejects.toThrowError(
      /^CALL-E provider terminal: provider_insufficient_balance$/u,
    );
    await expect(adapter.dispatch(request)).rejects.not.toThrowError(/private provider/iu);
  });

  it("reduces a terminal failed call and attempt to the same safe classification", async () => {
    const api = await loadAdapterApi();
    const failed = {
      ...completedSdkResult(),
      status: "failed",
      taskCompleted: false,
      completedAt: null,
      failureCode: "internal_error",
      recipients: [
        {
          attempts: [
            {
              ...completedSdkResult().recipients[0]!.attempts[0],
              status: "failed",
              failureCode: "recipient_blocked",
            },
          ],
        },
      ],
    };
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: () => ({ calls: sdkCalls(failed) }),
      custody: { writeProviderTaskReference: taskReferenceWriter(), write: vi.fn() },
    }) as { dispatch(input: unknown): Promise<unknown> };

    await expect(adapter.dispatch(request)).rejects.toThrowError(
      /^CALL-E provider terminal: provider_recipient_blocked$/u,
    );
  });

  it("reads terminal events by transient call id and retains only an allowlisted class", async () => {
    const api = await loadAdapterApi();
    const failed = {
      ...completedSdkResult(),
      status: "failed",
      taskCompleted: false,
      completedAt: null,
      failureCode: null,
      recipients: [
        {
          attempts: [
            {
              ...completedSdkResult().recipients[0]!.attempts[0],
              status: "failed",
              failureCode: null,
            },
          ],
        },
      ],
    };
    const listEvents = vi.fn().mockResolvedValue({
      object: "list",
      data: [
        {
          id: "private-event-id",
          type: "call.failed",
          call_id: "provider-call-opaque",
          status: "failed",
          message: "private provider explanation",
          details: { routing: { failure_code: "unsupported_region" } },
        },
      ],
      nextCursor: null,
    });
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: () => ({ calls: { ...sdkCalls(failed), listEvents } }),
      custody: { writeProviderTaskReference: taskReferenceWriter(), write: vi.fn() },
    }) as { dispatch(input: unknown): Promise<unknown> };

    const failure = await adapter.dispatch(request).catch((error: unknown) => error);

    expect(listEvents).toHaveBeenCalledOnce();
    expect(listEvents).toHaveBeenCalledWith("provider-call-opaque", { limit: 100 });
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "CALL-E provider terminal: provider_unsupported_region",
    );
    expect(JSON.stringify(failure)).not.toMatch(
      /provider-call-opaque|private-event-id|private provider explanation/iu,
    );
  });

  it("fails closed when terminal event diagnostics are unavailable", async () => {
    const api = await loadAdapterApi();
    const failed = {
      ...completedSdkResult(),
      status: "failed",
      taskCompleted: false,
      completedAt: null,
      failureCode: null,
      recipients: [{ attempts: [] }],
    };
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: () => ({
        calls: {
          ...sdkCalls(failed),
          listEvents: async () =>
            await Promise.reject(new Error("private event API diagnostic failure")),
        },
      }),
      custody: { writeProviderTaskReference: taskReferenceWriter(), write: vi.fn() },
    }) as { dispatch(input: unknown): Promise<unknown> };

    await expect(adapter.dispatch(request)).rejects.toThrowError(
      /^CALL-E provider terminal: provider_failed$/u,
    );
    await expect(adapter.dispatch(request)).rejects.not.toThrowError(/private event API/iu);
  });

  it("stores bounded transcript custody before returning admitted provider evidence", async () => {
    const api = await loadAdapterApi();
    expect(api["createCalleLiveObservationAdapter"]).toBeTypeOf("function");
    const order: string[] = [];
    const custodyWrite = vi.fn(async () => {
      order.push("custody");
      return { opaqueReference: "custody-opaque", integritySha256: "b".repeat(64), byteLength: 75 };
    });
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: () => ({
        calls: {
          create: async () => ({ id: "provider-call-opaque" }),
          waitForResult: async () => {
            order.push("provider");
            return completedSdkResult();
          },
        },
      }),
      custody: { writeProviderTaskReference: taskReferenceWriter(), write: custodyWrite },
    }) as { dispatch(input: unknown): Promise<Record<string, unknown>> };

    const output = await adapter.dispatch(request);
    order.push("returned");

    expect(order).toEqual(["provider", "custody", "returned"]);
    expect(custodyWrite).toHaveBeenCalledWith({
      operationId: "operation-live-001",
      transcript: expect.stringContaining("Zone 1 is 71.5 degrees Fahrenheit, status OK."),
    });
    expect(output).toMatchObject({
      providerCallId: "provider-call-opaque",
      terminalStatus: "completed",
      evidence: {
        providerRevisionId: "provider-call-opaque",
        opaqueCustodyRef: "custody-opaque",
        sourceCompleteness: "complete",
      },
    });
    expect(output.evidence).toMatchObject({
      auxiliaryStatus: {
        sound: "normal",
        power: "mains_available",
        battery: "normal",
        output: "off",
      },
    });
    expect((output.evidence as { readings: readonly unknown[] }).readings[0]).toMatchObject({
      zoneId: "zone-01",
      status: "OK",
      sourceAnchor: {
        opaqueSourceRef: expect.stringMatching(/^custody-opaque#turn=1/u),
      },
    });
  });

  it("admits a percent unit anchor when ASR retained the equivalent percent sign", async () => {
    const api = await loadAdapterApi();
    const result = completedSdkResult();
    result.structuredResult.readings[2]!.spoken_unit_token = "%";
    result.structuredResult.readings[3]!.spoken_unit_token = "%";
    result.recipients[0]!.attempts[0]!.transcriptTurns[1]!.text =
      "Zone 1 is 71.5 degrees Fahrenheit, status OK. " +
      "Zone 2 is 68.0 degrees Fahrenheit, status OK. " +
      "Zone 3 is 68%, status OK. Zone 4 is 82%, status OK.";
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: () => ({ calls: sdkCalls(result) }),
      custody: {
        writeProviderTaskReference: taskReferenceWriter(),
        write: vi.fn().mockResolvedValue({
          opaqueReference: "custody-percent-sign",
          integritySha256: "d".repeat(64),
          byteLength: 96,
        }),
      },
    }) as { dispatch(input: unknown): Promise<Record<string, unknown>> };

    await expect(adapter.dispatch(request)).resolves.toMatchObject({
      terminalStatus: "completed",
      evidence: {
        readings: [
          expect.anything(),
          expect.anything(),
          expect.objectContaining({
            zoneId: "zone-03",
            sourceAnchor: expect.objectContaining({ spokenUnitToken: "%" }),
          }),
          expect.objectContaining({
            zoneId: "zone-04",
            sourceAnchor: expect.objectContaining({ spokenUnitToken: "%" }),
          }),
        ],
      },
    });
  });

  it("admits an integer reading and persists the exact grounded anchor token", async () => {
    const api = await loadAdapterApi();
    const result = completedSdkResult();
    result.structuredResult.readings[1]!.value_token = "68";
    result.recipients[0]!.attempts[0]!.transcriptTurns[1]!.text =
      "Zone 1 is 71.5 degrees Fahrenheit, status OK. " +
      "Zone 2 is 68 degrees Fahrenheit, status OK. " +
      "Zone 3 is 68 percent, status OK. Zone 4 is 82 percent, status OK.";
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: () => ({ calls: sdkCalls(result) }),
      custody: {
        writeProviderTaskReference: taskReferenceWriter(),
        write: vi.fn().mockResolvedValue({
          opaqueReference: "custody-decimal-equivalent",
          integritySha256: "1".repeat(64),
          byteLength: 96,
        }),
      },
    }) as { dispatch(input: unknown): Promise<Record<string, unknown>> };

    const output = await adapter.dispatch(request);
    const readings = (output.evidence as { readings: readonly Record<string, unknown>[] }).readings;

    expect(readings[1]).toMatchObject({
      zoneId: "zone-02",
      value: "68",
      sourceAnchor: expect.objectContaining({ valueToken: "68" }),
    });
  });

  it("admits isolated ASR okay as the grounding equivalent for structured OK status", async () => {
    const api = await loadAdapterApi();
    const result = completedSdkResult();
    result.recipients[0]!.attempts[0]!.transcriptTurns[1]!.text =
      result.recipients[0]!.attempts[0]!.transcriptTurns[1]!.text.replaceAll(
        "status OK",
        "status okay",
      );
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: () => ({ calls: sdkCalls(result) }),
      custody: {
        writeProviderTaskReference: taskReferenceWriter(),
        write: vi.fn().mockResolvedValue({
          opaqueReference: "custody-asr-okay-status",
          integritySha256: "6".repeat(64),
          byteLength: 96,
        }),
      },
    }) as { dispatch(input: unknown): Promise<Record<string, unknown>> };

    const output = await adapter.dispatch(request);
    const readings = (output.evidence as { readings: readonly Record<string, unknown>[] }).readings;

    expect(readings).toHaveLength(4);
    expect(readings.every((reading) => reading["status"] === "OK")).toBe(true);
  });

  it("grounds exact structured decimals against equivalent ASR number words", async () => {
    const api = await loadAdapterApi();
    const result = completedSdkResult();
    result.recipients[0]!.attempts[0]!.transcriptTurns[1]!.text =
      "Zone one is seventy-one point five degrees Fahrenheit, status okay. " +
      "Zone two is sixty-eight point zero degrees Fahrenheit, status okay. " +
      "Zone three is sixty-eight percent, status okay. " +
      "Zone four is eighty-two percent, status okay.";
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: () => ({ calls: sdkCalls(result) }),
      custody: {
        writeProviderTaskReference: taskReferenceWriter(),
        write: vi.fn().mockResolvedValue({
          opaqueReference: "custody-asr-number-words",
          integritySha256: "8".repeat(64),
          byteLength: 128,
        }),
      },
    }) as { dispatch(input: unknown): Promise<Record<string, unknown>> };

    const output = await adapter.dispatch(request);
    const readings = (output.evidence as { readings: readonly Record<string, unknown>[] }).readings;

    expect(readings.map((reading) => reading["value"])).toEqual(["71.5", "68.0", "68", "82"]);
  });

  it("does not invent decimal precision from a less precise ASR number phrase", async () => {
    const api = await loadAdapterApi();
    const result = completedSdkResult();
    result.recipients[0]!.attempts[0]!.transcriptTurns[1]!.text =
      result.recipients[0]!.attempts[0]!.transcriptTurns[1]!.text.replace(
        "68.0 degrees Fahrenheit",
        "sixty-eight degrees Fahrenheit",
      );
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: () => ({ calls: sdkCalls(result) }),
      custody: {
        writeProviderTaskReference: taskReferenceWriter(),
        write: vi.fn().mockResolvedValue({
          opaqueReference: "custody-asr-missing-precision",
          integritySha256: "9".repeat(64),
          byteLength: 128,
        }),
      },
    }) as { dispatch(input: unknown): Promise<unknown> };

    const failure = await adapter
      .dispatch(request)
      .catch((error: unknown) => error as Error & { readonly cause?: unknown });

    expect(failure).toBeInstanceOf(Error);
    expect(failure.cause).toBe("anchor_value");
  });

  it("rejects ASR number words taken from a different zone segment", async () => {
    const api = await loadAdapterApi();
    const result = completedSdkResult();
    result.recipients[0]!.attempts[0]!.transcriptTurns[1]!.text =
      "Zone one is seventy-one point five degrees Fahrenheit, status okay. " +
      "Zone two is sixty-eight point zero degrees Fahrenheit, status okay. " +
      "Zone three is sixty-eight percent, status okay. " +
      "Zone four is eighty-two percent, status okay.";
    result.structuredResult.readings[0]!.value_token = "68.0";
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: () => ({ calls: sdkCalls(result) }),
      custody: {
        writeProviderTaskReference: taskReferenceWriter(),
        write: vi.fn().mockResolvedValue({
          opaqueReference: "custody-asr-swapped-zone",
          integritySha256: "a".repeat(64),
          byteLength: 128,
        }),
      },
    }) as { dispatch(input: unknown): Promise<unknown> };

    const failure = await adapter
      .dispatch(request)
      .catch((error: unknown) => error as Error & { readonly cause?: unknown });

    expect(failure).toBeInstanceOf(Error);
    expect(failure.cause).toBe("anchor_value");
  });

  it("admits LOW status when all source evidence is conforming", async () => {
    const api = await loadAdapterApi();
    const result = completedSdkResult();
    result.structuredResult.readings[0]!.reading_status = "LOW";
    result.recipients[0]!.attempts[0]!.transcriptTurns[1]!.text =
      "Zone 1 is 71.5 degrees Fahrenheit, status LOW. " +
      "Zone 2 is 68.0 degrees Fahrenheit, status OK. " +
      "Zone 3 is 68 percent, status OK. Zone 4 is 82 percent, status OK.";
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: () => ({ calls: sdkCalls(result) }),
      custody: {
        writeProviderTaskReference: taskReferenceWriter(),
        write: vi.fn().mockResolvedValue({
          opaqueReference: "custody-low-status",
          integritySha256: "4".repeat(64),
          byteLength: 96,
        }),
      },
    }) as { dispatch(input: unknown): Promise<Record<string, unknown>> };

    const output = await adapter.dispatch(request);
    const readings = (output.evidence as { readings: readonly Record<string, unknown>[] }).readings;

    expect(readings[0]).toMatchObject({ zoneId: "zone-01", status: "LOW" });
  });

  it("normalizes a valid provider RFC3339 timestamp with microsecond precision", async () => {
    const api = await loadAdapterApi();
    const result = completedSdkResult();
    result.completedAt = "2026-08-10T12:00:00.123456Z";
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: () => ({ calls: sdkCalls(result) }),
      custody: {
        writeProviderTaskReference: taskReferenceWriter(),
        write: vi.fn().mockResolvedValue({
          opaqueReference: "custody-microseconds",
          integritySha256: "5".repeat(64),
          byteLength: 96,
        }),
      },
    }) as { dispatch(input: unknown): Promise<Record<string, unknown>> };

    await expect(adapter.dispatch(request)).resolves.toMatchObject({
      observedAt: "2026-08-10T12:00:00.123Z",
    });
  });

  it("rejects swapped same-turn values because every token is grounded to its own zone segment", async () => {
    const api = await loadAdapterApi();
    const result = completedSdkResult();
    result.structuredResult.readings[0]!.value_token = "68.0";
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: () => ({ calls: sdkCalls(result) }),
      custody: {
        writeProviderTaskReference: taskReferenceWriter(),
        write: vi.fn().mockResolvedValue({
          opaqueReference: "custody-swapped-zone",
          integritySha256: "6".repeat(64),
          byteLength: 96,
        }),
      },
    }) as { dispatch(input: unknown): Promise<unknown> };

    const failure = await adapter
      .dispatch(request)
      .catch((error: unknown) => error as Error & { readonly cause?: unknown });

    expect(failure).toBeInstanceOf(Error);
    expect(failure.cause).toBe("anchor_value");
  });

  it("rejects zone readings spoken by the bot instead of the device", async () => {
    const api = await loadAdapterApi();
    const result = completedSdkResult();
    result.recipients[0]!.attempts[0]!.transcriptTurns[1]!.speaker = "bot";
    const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
      createClient: () => ({ calls: sdkCalls(result) }),
      custody: {
        writeProviderTaskReference: taskReferenceWriter(),
        write: vi.fn().mockResolvedValue({
          opaqueReference: "custody-bot-evidence",
          integritySha256: "7".repeat(64),
          byteLength: 96,
        }),
      },
    }) as { dispatch(input: unknown): Promise<unknown> };

    const failure = await adapter
      .dispatch(request)
      .catch((error: unknown) => error as Error & { readonly cause?: unknown });

    expect(failure).toBeInstanceOf(Error);
    expect(failure.cause).toBe("anchor_value");
  });

  const hostileAdmissionCases: readonly HostileAdmissionCase[] = [
    {
      label: "terminal and reading shape failures",
      variants: [
        {
          label: "malformed terminal shape",
          expected: "terminal_shape",
          mutate: (result) => {
            structuredResultRecord(result)["unexpected_payload"] = protectedSentinels.rawPayload;
          },
        },
        {
          label: "missing terminal member",
          expected: "terminal_shape",
          mutate: (result) => {
            delete structuredResultRecord(result)["auxiliary_status"];
          },
        },
        {
          label: "malformed reading shape",
          expected: "reading_shape",
          mutate: (result) => {
            readingRecords(result)[0]!["unexpected_payload"] = protectedSentinels.rawPayload;
          },
        },
        {
          label: "unexpected duplicated reading value",
          expected: "reading_shape",
          mutate: (result) => {
            readingRecords(result)[0]!["value"] = "71.5";
          },
        },
        {
          label: "missing reading member",
          expected: "reading_shape",
          mutate: (result) => {
            delete readingRecords(result)[0]!["reading_status"];
          },
        },
      ],
    },
    {
      label: "invalid zone identity and cardinality failures",
      variants: [
        {
          label: "protected invalid zone",
          expected: "zone_identity",
          mutate: (result) => {
            readingRecords(result)[0]!["zone_id"] = protectedSentinels.zone;
          },
        },
        {
          label: "free-form zone alias",
          expected: "zone_identity",
          mutate: (result) => {
            readingRecords(result)[0]!["zone_id"] = "greenhouse-north";
          },
        },
        {
          label: "duplicate zone",
          expected: "zone_identity",
          mutate: (result) => {
            readingRecords(result)[1]!["zone_id"] = "zone-01";
          },
        },
        {
          label: "missing zone cardinality",
          expected: "zone_identity",
          mutate: (result) => {
            const readings = readingRecords(result);
            structuredResultRecord(result)["readings"] = readings.slice(0, 3);
          },
        },
        {
          label: "unexpected zone",
          expected: "zone_identity",
          mutate: (result) => {
            readingRecords(result)[3]!["zone_id"] = "zone-05";
          },
        },
        {
          label: "unexpected reading cardinality",
          expected: "zone_identity",
          mutate: (result) => {
            const readings = readingRecords(result);
            structuredResultRecord(result)["readings"] = [...readings, { ...readings[3]! }];
          },
        },
      ],
    },
    {
      label: "bad value anchors",
      variants: [
        {
          label: "protected non-decimal value token",
          expected: "anchor_value",
          mutate: (result) => {
            readingRecords(result)[1]!["value_token"] = protectedSentinels.value;
          },
        },
        {
          label: "exponent notation",
          expected: "anchor_value",
          mutate: (result) => {
            readingRecords(result)[1]!["value_token"] = "6.8e1";
          },
        },
        {
          label: "partial transcript token",
          expected: "anchor_value",
          mutate: (result) => {
            readingRecords(result)[1]!["value_token"] = "68";
          },
        },
        {
          label: "missing anchor token",
          expected: "reading_shape",
          mutate: (result) => {
            delete readingRecords(result)[1]!["value_token"];
          },
        },
        {
          label: "value absent from its zone segment",
          expected: "anchor_value",
          mutate: (result) => {
            readingRecords(result)[1]!["value_token"] = "67.9";
          },
        },
      ],
    },
    {
      label: "bad unit anchors",
      variants: [
        {
          label: "protected unit token",
          expected: "anchor_unit",
          mutate: (result) => {
            readingRecords(result)[2]!["spoken_unit_token"] = protectedSentinels.value;
          },
        },
        {
          label: "unit missing from cited turn",
          expected: "anchor_unit",
          mutate: (result) => {
            readingRecords(result)[2]!["spoken_unit_token"] = "degrees Fahrenheit";
          },
        },
        {
          label: "missing spoken unit anchor member",
          expected: "reading_shape",
          mutate: (result) => {
            delete readingRecords(result)[2]!["spoken_unit_token"];
          },
        },
      ],
    },
    {
      label: "bad status anchors",
      variants: [
        {
          label: "status missing from zone transcript segment",
          expected: "anchor_status",
          mutate: (result) => {
            readingRecords(result)[0]!["reading_status"] = "LOW";
          },
        },
      ],
    },
    {
      label: "invalid auxiliary status",
      variants: [
        {
          label: "protected auxiliary status",
          expected: "auxiliary_status",
          mutate: (result) => {
            const auxiliary = structuredResultRecord(result)["auxiliary_status"] as Record<
              string,
              unknown
            >;
            auxiliary["sound"] = protectedSentinels.value;
          },
        },
        {
          label: "auxiliary statuses absent from device transcript",
          expected: "auxiliary_status",
          mutate: (result) => {
            result.recipients[0]!.attempts[0]!.transcriptTurns[3]!.text =
              "Sound alarm is active. Power is mains failed. Battery is low. Output is on.";
          },
        },
        {
          label: "report cut off before battery and output",
          expected: "auxiliary_status",
          mutate: (result) => {
            result.recipients[0]!.attempts[0]!.transcriptTurns[3]!.text =
              "Sound is normal. Power is mains available.";
          },
        },
      ],
    },
  ];

  it.each(hostileAdmissionCases)(
    "classifies $label with one closed diagnostic and no protected evidence",
    async ({ variants }) => {
      const api = await loadAdapterApi();

      for (const variant of variants) {
        const result = completedSdkResult();
        result.id = protectedSentinels.identifier;
        result.recipients[0]!.attempts[0]!.transcriptTurns[0]!.text = [
          protectedSentinels.transcript,
          protectedSentinels.permit,
          protectedSentinels.rawPayload,
        ].join(" ");
        variant.mutate(result);
        const custodyWrite = vi.fn().mockResolvedValue({
          opaqueReference: protectedSentinels.custody,
          integritySha256: "e".repeat(64),
          byteLength: 96,
        });
        const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
          createClient: () => ({ calls: sdkCalls(result) }),
          custody: { writeProviderTaskReference: taskReferenceWriter(), write: custodyWrite },
        }) as { dispatch(input: unknown): Promise<unknown> };
        const protectedRequest = {
          ...request,
          apiToken: protectedSentinels.credential,
          targetAddress: protectedSentinels.target,
          operationId: "private-operation-identifier-sentinel",
          providerDispatchIdentity: "private-provider-dispatch-sentinel",
        };

        const failure = await adapter
          .dispatch(protectedRequest)
          .catch((error: unknown) => error as Error & { readonly cause?: unknown });

        expect(failure, variant.label).toBeInstanceOf(Error);
        expect(failure.message, variant.label).toBe(
          "CALL-E provider terminal: provider_evidence_invalid",
        );
        expect(failure.cause, variant.label).toBe(variant.expected);
        const exposed = [
          failure.message,
          String(failure.cause),
          failure.stack ?? "",
          JSON.stringify(failure),
        ].join("\n");
        expect(
          admissionDiagnosticClasses.filter((diagnostic) => exposed.includes(diagnostic)),
          variant.label,
        ).toEqual([variant.expected]);
        for (const sentinel of Object.values(protectedSentinels)) {
          expect(exposed, `${variant.label}: ${sentinel}`).not.toContain(sentinel);
        }
        expect(custodyWrite, variant.label).toHaveBeenCalledOnce();
      }
    },
  );

  it.each([
    [
      "multiple recipients",
      {
        ...completedSdkResult(),
        recipients: [...completedSdkResult().recipients, ...completedSdkResult().recipients],
      },
      undefined,
    ],
    [
      "multiple attempts",
      {
        ...completedSdkResult(),
        recipients: [
          {
            attempts: [
              ...completedSdkResult().recipients[0]!.attempts,
              ...completedSdkResult().recipients[0]!.attempts,
            ],
          },
        ],
      },
      undefined,
    ],
    [
      "provider task ID mismatch",
      {
        ...completedSdkResult(),
        id: protectedSentinels.identifier,
      },
      "provider-call-opaque",
    ],
    [
      "malformed transcript turn",
      (() => {
        const result = completedSdkResult();
        const turn = result.recipients[0]!.attempts[0]!.transcriptTurns[0]! as unknown as Record<
          string,
          unknown
        >;
        turn["speaker"] = protectedSentinels.transcript;
        return result;
      })(),
      undefined,
    ],
  ])(
    "rejects %s before custody admission with a closed terminal-shape diagnostic",
    async (_label, result, createdId) => {
      const api = await loadAdapterApi();
      const custodyWrite = vi.fn();
      const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
        createClient: () => ({
          calls: {
            create: async () => ({ id: createdId ?? result.id }),
            waitForResult: async () => result,
          },
        }),
        custody: { writeProviderTaskReference: taskReferenceWriter(), write: custodyWrite },
      }) as { dispatch(input: unknown): Promise<unknown> };

      const failure = await adapter
        .dispatch(request)
        .catch((error: unknown) => error as Error & { readonly cause?: unknown });

      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).toBe("CALL-E provider terminal: provider_evidence_invalid");
      expect(failure.cause).toBe("terminal_shape");
      const exposed = [failure.message, String(failure.cause), JSON.stringify(failure)].join("\n");
      for (const sentinel of Object.values(protectedSentinels)) {
        expect(exposed).not.toContain(sentinel);
      }
      expect(exposed).not.toMatch(/provider-call-opaque|Zone 1 is 71\.5/iu);
      expect(custodyWrite).not.toHaveBeenCalled();
    },
  );

  it.each([
    { label: "malformed", completedAt: protectedSentinels.value },
    { label: "impossible calendar", completedAt: "2026-02-30T12:00:00.000Z" },
  ])(
    "classifies $label terminal time after custody without disclosing protected content",
    async ({ completedAt }) => {
      const api = await loadAdapterApi();
      const result = completedSdkResult();
      result.completedAt = completedAt;
      const custodyWrite = vi.fn().mockResolvedValue({
        opaqueReference: protectedSentinels.custody,
        integritySha256: "f".repeat(64),
        byteLength: 96,
      });
      const adapter = (api["createCalleLiveObservationAdapter"] as CallableFunction)({
        createClient: () => ({ calls: sdkCalls(result) }),
        custody: { writeProviderTaskReference: taskReferenceWriter(), write: custodyWrite },
      }) as { dispatch(input: unknown): Promise<unknown> };

      const failure = await adapter
        .dispatch(request)
        .catch((error: unknown) => error as Error & { readonly cause?: unknown });

      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).toBe("CALL-E provider terminal: provider_evidence_invalid");
      expect(failure.cause).toBe("terminal_shape");
      const exposed = [failure.message, String(failure.cause), JSON.stringify(failure)].join("\n");
      for (const sentinel of Object.values(protectedSentinels)) {
        expect(exposed).not.toContain(sentinel);
      }
      expect(exposed).not.toMatch(
        /provider-call-opaque|test-only-synthetic-target|test-only-provider-key/iu,
      );
      expect(custodyWrite).toHaveBeenCalledOnce();
    },
  );
});
