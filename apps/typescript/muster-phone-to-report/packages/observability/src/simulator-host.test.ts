import { describe, expect, it, vi } from "vitest";

import { createSimulatorHostObservability } from "./simulator-host.js";
import { sanitizeLogEvent } from "./redaction.js";

describe("simulator-host observability", () => {
  it.each([
    "evidence_timestamp_invalid",
    "application_persistence_failed",
    "provider_insufficient_balance",
    "provider_evidence_invalid",
    "provider_evidence_invalid_terminal_shape",
    "provider_evidence_invalid_reading_shape",
    "provider_evidence_invalid_zone_identity",
    "provider_evidence_invalid_anchor_value",
    "provider_evidence_invalid_anchor_unit",
    "provider_evidence_invalid_anchor_status",
    "provider_evidence_invalid_auxiliary_status",
    "provider_evidence_unavailable",
    "provider_create_response_invalid",
  ] as const)(
    "retains the allowlisted %s reason through the production log sanitizer",
    (safeReason) => {
      expect(
        sanitizeLogEvent({
          event: "simulator.live_smoke",
          outcome: "failed",
          reason: safeReason,
        }),
      ).toEqual({
        event: "simulator.live_smoke",
        outcome: "failed",
        reason: safeReason,
      });
    },
  );
  it("allowlists categorical create-response diagnostics for logs but never metric labels", () => {
    const logs: unknown[] = [];
    const metrics: unknown[] = [];
    const observability = createSimulatorHostObservability({
      logger: {
        debug: vi.fn(),
        info: vi.fn((event: unknown) => logs.push(event)),
        warn: vi.fn((event: unknown) => logs.push(event)),
        error: vi.fn(),
        child: vi.fn(),
      },
      meter: {
        createCounter: (name: string) => ({
          add: (value: number, attributes: unknown) => metrics.push({ name, value, attributes }),
        }),
        createHistogram: vi.fn(() => ({ record: vi.fn() })),
      },
    } as never);

    const safeCreateResponseEvent = {
      event: "simulator.live_smoke",
      outcome: "failed",
      reason: "provider_create_response_invalid",
      providerResponseStatusCode: 204,
      providerResponseContentType: "missing",
      providerResponseBody: "absent",
      providerResponseLocation: "exact_call_resource",
      providerRequestIdPresent: true,
      rawLocation: "https://private.example/v1/calls/private-provider-call",
      rawHeaders: "authorization=Bearer private-provider-credential",
      rawBody: "private provider body",
      operationId: "private-operation-id",
      providerCallId: "private-provider-call",
      targetAddress: "private-target-address",
    } as const;
    observability.record(safeCreateResponseEvent as never);

    expect(logs).toContainEqual({
      event: "simulator.live_smoke",
      outcome: "failed",
      reason: "provider_create_response_invalid",
      providerResponseStatusCode: 204,
      providerResponseContentType: "missing",
      providerResponseBody: "absent",
      providerResponseLocation: "exact_call_resource",
      providerRequestIdPresent: true,
    });
    expect(metrics).toContainEqual({
      name: "muster.simulator.live.operations",
      value: 1,
      attributes: { event: "simulator.live_smoke", outcome: "failed" },
    });
    expect(sanitizeLogEvent(safeCreateResponseEvent)).toEqual({
      event: "simulator.live_smoke",
      outcome: "failed",
      reason: "provider_create_response_invalid",
      providerResponseStatusCode: 204,
      providerResponseContentType: "missing",
      providerResponseBody: "absent",
      providerResponseLocation: "exact_call_resource",
      providerRequestIdPresent: true,
    });
    expect(JSON.stringify({ logs, metrics })).not.toMatch(
      /private\.example|private provider body|private-provider-credential|private-operation-id|private-provider-call|private-target-address/iu,
    );
  });
  it("preserves sanitized W3C state and records bounded lifecycle, Twilio, and HTTP telemetry", async () => {
    const logs: unknown[] = [];
    const logger = {
      debug: vi.fn((event: unknown) => logs.push(event)),
      info: vi.fn((event: unknown) => logs.push(event)),
      warn: vi.fn((event: unknown) => logs.push(event)),
      error: vi.fn((event: unknown) => logs.push(event)),
      child: vi.fn(),
    };
    const metrics: Array<{
      readonly name: string;
      readonly value: number;
      readonly attributes: Readonly<Record<string, string | number>>;
    }> = [];
    const meter = {
      createCounter: (name: string) => ({
        add: (value: number, attributes: Readonly<Record<string, string | number>>) =>
          metrics.push({ name, value, attributes }),
      }),
      createHistogram: (name: string) => ({
        record: (value: number, attributes: Readonly<Record<string, string | number>>) =>
          metrics.push({ name, value, attributes }),
      }),
    };
    const observability = createSimulatorHostObservability({
      logger,
      meter,
      now: vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_025),
    } as never) as unknown as {
      establishTraceContext(input: Record<string, string>): {
        readonly traceparent: string;
        readonly tracestate?: string;
      };
      record(event: Record<string, string>): void;
      runJobSpan<T>(operation: () => Promise<T>): Promise<T>;
      runCallbackSpan<T>(
        traceContext: { readonly traceparent: string; readonly tracestate?: string },
        operation: () => Promise<T>,
      ): Promise<T>;
      recordHttpRequest(input: {
        readonly method: "POST";
        readonly route: "/twilio/voice";
        readonly statusCode: 200;
        readonly durationSeconds: number;
      }): void;
      close(): Promise<void>;
    };
    const traceContext = observability.establishTraceContext({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=opaque",
    });
    expect(traceContext).toEqual({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=opaque",
    });

    const twilioOutcomes = [
      "provider_signature_rejected",
      "authorization_rejected",
      "authorization_bound",
      "authorization_replayed",
      "voice_rendered",
      "canary_clear",
      "canary_failed",
    ] as const;
    for (const outcome of twilioOutcomes) {
      observability.record({
        event: "simulator.twilio.request",
        outcome,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
      });
    }
    observability.record({
      event: "simulator.live_smoke",
      outcome: "failed",
      reason: "provider_insufficient_balance",
    });
    observability.record({
      event: "simulator.live_smoke",
      outcome: "failed",
      reason: "private provider explanation",
    });
    await observability.runJobSpan(async () => undefined);
    await observability.runCallbackSpan(traceContext, async () => undefined);
    observability.recordHttpRequest({
      method: "POST",
      route: "/twilio/voice",
      statusCode: 200,
      durationSeconds: 0.025,
    });
    await observability.close();

    expect(metrics.filter(({ name }) => name === "muster.simulator.live.operations")).toHaveLength(
      twilioOutcomes.length + 2,
    );
    expect(metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "muster.http.server.requests",
          value: 1,
          attributes: { method: "POST", route: "/twilio/voice", status_code: 200 },
        }),
        expect.objectContaining({
          name: "muster.http.server.duration",
          value: 0.025,
          attributes: { method: "POST", route: "/twilio/voice", status_code: 200 },
        }),
      ]),
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "simulator.host.started" }),
        expect.objectContaining({
          event: "simulator.job.completed",
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId: "00f067aa0ba902b7",
        }),
        expect.objectContaining({
          event: "simulator.callback.completed",
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId: "00f067aa0ba902b7",
        }),
        expect.objectContaining({ event: "simulator.host.stopped" }),
        ...twilioOutcomes.map((outcome) =>
          expect.objectContaining({
            event: "simulator.twilio.request",
            outcome,
            traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
            spanId: "00f067aa0ba902b7",
          }),
        ),
      ]),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: "simulator.live_smoke",
        outcome: "failed",
        reason: "provider_insufficient_balance",
      }),
    );
    expect(JSON.stringify(logs)).not.toMatch(/private provider explanation/iu);
    expect(JSON.stringify(logs)).not.toMatch(
      /opaque|provider-call|permit|target|callSid|credential|transcript|digits/iu,
    );
    expect(JSON.stringify(metrics)).not.toMatch(/4bf92f|00f067aa|traceId|spanId/iu);
  });

  it("keeps logging and metrics failures from changing business outcomes", async () => {
    const logger = {
      debug: vi.fn(() => {
        throw new Error("logger unavailable");
      }),
      info: vi.fn(() => {
        throw new Error("logger unavailable");
      }),
      warn: vi.fn(() => {
        throw new Error("logger unavailable");
      }),
      error: vi.fn(() => {
        throw new Error("logger unavailable");
      }),
      child: vi.fn(),
    };
    const meter = {
      createCounter: vi.fn(() => ({
        add: () => {
          throw new Error("counter unavailable");
        },
      })),
      createHistogram: vi.fn(() => ({
        record: () => {
          throw new Error("histogram unavailable");
        },
      })),
    };
    const businessOperation = vi.fn(async () => "business-result");

    const observability = createSimulatorHostObservability({ logger, meter } as never);

    expect(() =>
      observability.record({ event: "simulator.live_smoke", outcome: "completed" }),
    ).not.toThrow();
    expect(() =>
      observability.recordHttpRequest({
        method: "POST",
        route: "/twilio/voice",
        statusCode: 200,
        durationSeconds: 0.01,
      }),
    ).not.toThrow();
    await expect(observability.runJobSpan(businessOperation)).resolves.toBe("business-result");
    expect(businessOperation).toHaveBeenCalledOnce();
  });

  it("degrades from throwing span implementations without duplicating business work", async () => {
    const runConsumerSpan = vi.fn(
      async ({ operation }: { readonly operation: () => Promise<unknown> }) => {
        await operation();
        await operation();
        throw new Error("consumer tracing unavailable");
      },
    );
    const runProducerSpan = vi.fn(
      async ({ operation }: { readonly operation: () => Promise<unknown> }) => {
        await operation();
        await operation();
        throw new Error("producer tracing unavailable");
      },
    );
    const observability = createSimulatorHostObservability({
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      },
      spanRunners: { runConsumerSpan, runProducerSpan },
    } as never);
    const job = vi.fn(async () => "job-result");
    const provider = vi.fn(async () => "provider-result");
    const callback = vi.fn(async () => "callback-result");
    const traceContext = observability.establishTraceContext({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });

    await expect(observability.runJobSpan(job)).resolves.toBe("job-result");
    await expect(observability.runProviderSpan(provider)).resolves.toBe("provider-result");
    await expect(observability.runCallbackSpan(traceContext, callback)).resolves.toBe(
      "callback-result",
    );
    expect(job).toHaveBeenCalledOnce();
    expect(provider).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledOnce();
    expect(runConsumerSpan).toHaveBeenCalledTimes(2);
    expect(runProducerSpan).toHaveBeenCalledOnce();
  });
});
