import { describe, expect, it, vi } from "vitest";

import { establishLiveDemoReviewLease } from "../live-runs/live-demo-review-session.js";

interface BindingModule {
  startBoundLiveDemoReviewRuntime(input: Readonly<Record<string, unknown>>): Promise<{
    readonly baseUrl: string;
    readonly routes: readonly string[];
    close(): Promise<void>;
  }>;
}

async function bindingModule(): Promise<BindingModule> {
  const moduleUrl = new URL("./live-demo-review-runtime-binding.ts", import.meta.url).href;
  return (await import(/* @vite-ignore */ moduleUrl)) as BindingModule;
}

describe("provider-free Demo Review runtime binding", () => {
  it("starts the actual bound review composition without acquiring module, environment, provider, credential, tunnel, callback, or dispatch capability", async () => {
    const { startBoundLiveDemoReviewRuntime } = await bindingModule();
    const acquisitions: string[] = [];
    const forbidden = new Set([
      "loadModule",
      "environment",
      "createCalleClient",
      "createTwilioClient",
      "loadProviderCredentials",
      "openTunnel",
      "acceptProviderCallback",
      "dispatchCall",
      "mintAuthorization",
    ]);
    const identity = Object.freeze({
      operationId: "operation-bound-review",
      scenarioId: "synthetic-normal",
      scenarioRevision: 1,
    });
    const cleanup = vi.fn(async () => ({
      outcome: "deleted" as const,
      message: "Protected demo result deleted" as const,
    }));
    const input = new Proxy(
      {
        host: "127.0.0.1",
        port: 0,
        allowedBrowserOrigin: "http://127.0.0.1:4173",
        sessionId: "session-bound-review",
        lease: establishLiveDemoReviewLease({
          identity,
          reviewReadyAt: "2026-09-02T12:00:00.000Z",
        }),
        identity,
        now: () => new Date("2026-09-02T12:01:00.000Z"),
        readRetainedProjection: vi.fn(() => undefined),
        protectedCleanup: Object.freeze({ cleanup }),
        revokeProjection: vi.fn(),
        closeObservability: vi.fn(async () => undefined),
        runCleanupSpan: async (_span: unknown, operation: () => Promise<unknown>) =>
          await operation(),
        establishTraceContext: vi.fn(() => ({
          traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        })),
        runRequestSpan: async (_span: unknown, operation: () => Promise<unknown>) =>
          await operation(),
        recordHttpRequest: vi.fn(),
      },
      {
        get(target, property, receiver) {
          if (typeof property === "string" && forbidden.has(property)) {
            acquisitions.push(property);
            throw new Error(`forbidden review acquisition: ${property}`);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );

    const runtime = await startBoundLiveDemoReviewRuntime(input);
    try {
      expect(runtime.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
      expect(runtime.routes).toEqual([
        "GET /api/v1/live-simulator/operations/{operationId}",
        "DELETE /api/v1/live-demo-review/sessions/{sessionId}",
      ]);
      expect(acquisitions).toEqual([]);
      expect(cleanup).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
    }
    expect(acquisitions).toEqual([]);
  });
});
