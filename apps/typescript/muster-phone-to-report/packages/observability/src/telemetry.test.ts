import { NodeSDK } from "@opentelemetry/sdk-node";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { expect, it } from "vitest";

interface TelemetryModule {
  runWithProducerSpan<T>(options: {
    readonly spanName: string;
    readonly operation: () => Promise<T>;
  }): Promise<T>;
  injectActiveW3CTraceContext(): Readonly<{ traceparent: string; tracestate?: string }> | undefined;
  runWithConsumerSpan<T>(options: {
    readonly carrier: Record<string, string | undefined>;
    readonly spanName: string;
    readonly operation: () => Promise<T>;
  }): Promise<T>;
}

interface PreloadModule {
  getPreloadedTelemetry(): Readonly<{ start(): void; shutdown(): Promise<void> }>;
  publishPreloadedTelemetry(
    telemetry: Readonly<{ start(): void; shutdown(): Promise<void> }>,
  ): void;
  clearPreloadedTelemetryForTest(): void;
}

async function loadTelemetryModule(): Promise<TelemetryModule> {
  const moduleUrl = new URL("./telemetry.ts", import.meta.url).href;
  const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Partial<TelemetryModule>;
  if (
    loaded.runWithProducerSpan === undefined ||
    loaded.injectActiveW3CTraceContext === undefined ||
    loaded.runWithConsumerSpan === undefined
  ) {
    throw new Error("OpenTelemetry job propagation helpers are not implemented");
  }
  return {
    runWithProducerSpan: loaded.runWithProducerSpan,
    injectActiveW3CTraceContext: loaded.injectActiveW3CTraceContext,
    runWithConsumerSpan: loaded.runWithConsumerSpan,
  };
}

it("exports real producer and consumer spans with valid remote lineage and invalid-carrier isolation", async () => {
  const telemetry = await loadTelemetryModule();
  const exporter = new InMemorySpanExporter();
  const sdk = new NodeSDK({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  sdk.start();

  try {
    await telemetry.runWithProducerSpan({
      spanName: "foundation-health.v1 send",
      operation: async () => {
        const carrier = telemetry.injectActiveW3CTraceContext();
        expect(carrier).toBeDefined();
        expect(carrier).not.toHaveProperty("baggage");

        await telemetry.runWithConsumerSpan({
          carrier: { ...carrier, baggage: "secret=seeded-secret" },
          spanName: "foundation-health.v1 process",
          operation: async () => undefined,
        });
        await telemetry.runWithConsumerSpan({
          carrier: {
            traceparent: "malformed-seeded-secret",
            baggage: "secret=seeded-secret",
          },
          spanName: "foundation-health.v1 process invalid",
          operation: async () => undefined,
        });
      },
    });
    const exportDeadline = Date.now() + 1_000;
    while (exporter.getFinishedSpans().length < 3 && Date.now() < exportDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const spans = exporter.getFinishedSpans();
    const producer = spans.find((span) => span.name === "foundation-health.v1 send");
    const consumer = spans.find((span) => span.name === "foundation-health.v1 process");
    const invalid = spans.find((span) => span.name === "foundation-health.v1 process invalid");
    expect(producer).toBeDefined();
    expect(consumer?.spanContext().traceId).toBe(producer?.spanContext().traceId);
    expect(consumer?.parentSpanContext?.spanId).toBe(producer?.spanContext().spanId);
    expect(invalid?.parentSpanContext).toBeUndefined();
    expect(invalid?.spanContext().traceId).not.toBe(producer?.spanContext().traceId);
    expect(
      JSON.stringify(
        spans.map((span) => ({
          name: span.name,
          attributes: span.attributes,
          events: span.events,
          links: span.links,
          status: span.status,
        })),
      ),
    ).not.toContain("seeded-secret");
  } finally {
    await sdk.shutdown();
  }
});

it("fails closed without preload state and returns only the package-published lifecycle", async () => {
  const moduleUrl = new URL("./preload-state.ts", import.meta.url).href;
  const preload = (await import(/* @vite-ignore */ moduleUrl)) as Partial<PreloadModule>;
  if (
    preload.getPreloadedTelemetry === undefined ||
    preload.publishPreloadedTelemetry === undefined ||
    preload.clearPreloadedTelemetryForTest === undefined
  ) {
    throw new Error("Telemetry preload guard is not implemented");
  }
  preload.clearPreloadedTelemetryForTest();
  expect(() => preload.getPreloadedTelemetry?.()).toThrow(
    "Observability preload is required before runtime import",
  );
  const lifecycle = {
    start: () => undefined,
    shutdown: async () => undefined,
  };
  preload.publishPreloadedTelemetry(lifecycle);
  expect(preload.getPreloadedTelemetry()).toBe(lifecycle);
  preload.clearPreloadedTelemetryForTest();
});
