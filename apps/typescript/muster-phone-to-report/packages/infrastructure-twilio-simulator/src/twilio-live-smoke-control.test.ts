import { describe, expect, it, vi } from "vitest";

import { createLiveSmokeCleanup } from "./twilio-live-smoke-control.js";

async function loadApi(): Promise<Readonly<Record<string, CallableFunction>>> {
  return (await import("./index.js")) as Readonly<Record<string, CallableFunction>>;
}

function exactCallBarrier(awaitQuiescence: () => Promise<boolean>) {
  return async () =>
    (await awaitQuiescence())
      ? ({ outcome: "ready", proof: "exact_call_quiescent" } as const)
      : ({ outcome: "blocked", reason: "observation_failed" } as const);
}

describe("Phase 6 Twilio read-back, reconciliation, and cleanup control", () => {
  it("requires one closed pre-restoration decision at the cleanup type boundary", () => {
    const instantiateWithoutBarrier = () => {
      // @ts-expect-error The causal pre-restoration decision is mandatory.
      createLiveSmokeCleanup({
        closeRunGate: vi.fn(),
        restoreTwilio: vi.fn(async () => undefined),
        verifyTwilioResting: vi.fn(async () => true),
        clearRuntimeSecrets: vi.fn(),
        stopHost: vi.fn(async () => undefined),
        stopTunnel: vi.fn(async () => undefined),
      });
    };

    expect(instantiateWithoutBarrier).toBeTypeOf("function");
  });
  it("constructs a fixed-origin Twilio control transport", async () => {
    const api = await loadApi();
    expect(api["createTwilioLiveSmokeControlTransport"]).toBeTypeOf("function");
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ voice_url: "https://reject.invalid", status_callback: null }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          calls: [
            {
              sid: "CA_OLD",
              direction: "inbound",
              status: "completed",
              start_time: "Tue, 25 Aug 2026 12:00:00 +0000",
            },
            {
              sid: "CA_MATCH",
              direction: "inbound",
              status: "in-progress",
              start_time: "Tue, 25 Aug 2026 16:44:30 +0000",
            },
          ],
        }),
      });
    const transport = api["createTwilioLiveSmokeControlTransport"]!({
      accountSid: "AC11111111111111111111111111111111",
      numberSid: "PN22222222222222222222222222222222",
      authToken: "protected-test-token",
      fetch: request,
    });

    await expect(transport.readConfiguration()).resolves.toEqual({
      voiceUrl: "https://reject.invalid",
      statusCallbackUrl: null,
    });
    await transport.updateConfiguration({
      voiceUrl: "https://phase6.invalid/twilio/voice",
      statusCallbackUrl: "https://phase6.invalid/twilio/status",
    });
    await expect(
      transport.listInboundCalls({
        startedAt: "2026-08-25T16:44:15.000Z",
        endedAt: "2026-08-25T16:45:15.000Z",
      }),
    ).resolves.toEqual([{ callSid: "CA_MATCH", direction: "inbound", status: "in-progress" }]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(
      request.mock.calls.every(([url]) => String(url).startsWith("https://api.twilio.com/")),
    ).toBe(true);
    const callsUrl = new URL(String(request.mock.calls[2]![0]));
    expect(callsUrl.searchParams.get("StartTimeAfter")).toBe("2026-08-25");
    expect(callsUrl.searchParams.get("StartTimeBefore")).toBe("2026-08-26");
  });
  it("AC-HAPPY-6 reconciles exactly one inbound bound call without exposing provider identifiers", async () => {
    const api = await loadApi();
    expect(api["createTwilioLiveSmokeControl"]).toBeTypeOf("function");
    const transport = {
      readConfiguration: vi.fn(),
      updateConfiguration: vi.fn(),
      listInboundCalls: vi.fn(async () => [
        { callSid: "CA_MATCH", direction: "inbound", status: "completed" },
      ]),
    };
    const control = api["createTwilioLiveSmokeControl"]!({
      transport,
      digestProviderCall: (value: string) =>
        value === "CA_MATCH" ? "a".repeat(64) : "b".repeat(64),
      restingConfiguration: {
        voiceUrl: "https://reject.invalid/voice",
        statusCallbackUrl: null,
      },
      liveConfiguration: {
        voiceUrl: "https://phase6.invalid/twilio/voice",
        statusCallbackUrl: "https://phase6.invalid/twilio/status",
      },
    });

    const result = await control.reconcile({
      startedAt: "2026-08-24T20:00:00.000Z",
      endedAt: "2026-08-24T20:01:00.000Z",
      boundCallDigest: "a".repeat(64),
    });
    expect(result).toEqual({
      outcome: "one_matching_call",
      inboundCallCount: 1,
      matchingCallCount: 1,
      summary: "1 matching call",
    });
    expect(JSON.stringify(result)).not.toContain("CA_MATCH");
    expect(transport.listInboundCalls).toHaveBeenCalledOnce();
  });

  it("waits for the exact inbound call to become terminal before cleanup can stop callbacks", async () => {
    const api = await loadApi();
    const transport = {
      readConfiguration: vi.fn(),
      updateConfiguration: vi.fn(),
      listInboundCalls: vi
        .fn()
        .mockResolvedValueOnce([
          { callSid: "CA_MATCH", direction: "inbound", status: "in-progress" },
        ])
        .mockResolvedValueOnce([{ callSid: "CA_MATCH", direction: "inbound", status: "completed" }])
        .mockResolvedValueOnce([
          { callSid: "CA_MATCH", direction: "inbound", status: "completed" },
        ]),
    };
    const control = api["createTwilioLiveSmokeControl"]!({
      transport,
      digestProviderCall: () => "a".repeat(64),
      restingConfiguration: {
        voiceUrl: "https://reject.invalid/voice",
        statusCallbackUrl: null,
      },
      liveConfiguration: {
        voiceUrl: "https://phase6.invalid/twilio/voice",
        statusCallbackUrl: "https://phase6.invalid/twilio/status",
      },
      wait: async () => undefined,
      now: vi
        .fn()
        .mockReturnValueOnce("2026-08-25T16:45:20.000Z")
        .mockReturnValueOnce("2026-08-25T16:45:20.000Z")
        .mockReturnValueOnce("2026-08-25T16:45:20.000Z")
        .mockReturnValueOnce("2026-08-25T16:45:50.000Z")
        .mockReturnValueOnce("2026-08-25T16:45:50.000Z")
        .mockReturnValueOnce("2026-08-25T16:45:50.000Z")
        .mockReturnValueOnce("2026-08-25T16:45:50.000Z")
        .mockReturnValue("2026-08-25T16:45:50.000Z"),
    });

    await expect(
      control.awaitQuiescence({
        startedAt: "2026-08-25T16:44:15.000Z",
        boundCallDigest: "a".repeat(64),
        timeoutMs: 60_000,
        trailingCallbackGraceMs: 0,
      }),
    ).resolves.toBe("quiescent");
    expect(transport.listInboundCalls).toHaveBeenCalledTimes(3);
  });

  it("AC-ERROR-1 rejects an observation that resolves after the fixed deadline", async () => {
    const api = await loadApi();
    const cleanupStartedAt = Date.parse("2026-08-27T20:00:00.000Z");
    let elapsedMs = 0;
    const restoreTwilio = vi.fn(async () => undefined);
    const verifyTwilioResting = vi.fn(async () => true);
    const clearRuntimeSecrets = vi.fn();
    const stopHost = vi.fn(async () => undefined);
    const stopTunnel = vi.fn(async () => undefined);
    const teardownPersistence = vi.fn(async () => undefined);
    const control = api["createTwilioLiveSmokeControl"]!({
      transport: {
        readConfiguration: vi.fn(),
        updateConfiguration: vi.fn(),
        listInboundCalls: vi.fn(async () => {
          elapsedMs = 1_001;
          return [];
        }),
      },
      digestProviderCall: () => "a".repeat(64),
      restingConfiguration: {
        voiceUrl: "https://reject.invalid/voice",
        statusCallbackUrl: null,
      },
      liveConfiguration: {
        voiceUrl: "https://phase6.invalid/twilio/voice",
        statusCallbackUrl: "https://phase6.invalid/twilio/status",
      },
      now: () => new Date(cleanupStartedAt + elapsedMs).toISOString(),
      wait: vi.fn(async () => undefined),
    });
    const cleanup = api["createLiveSmokeCleanup"]!({
      closeRunGate: vi.fn(),
      awaitPreRestorationBarrier: exactCallBarrier(
        async () =>
          (await control.awaitQuiescence({
            startedAt: "2026-08-27T19:59:59.000Z",
            boundCallDigest: "a".repeat(64),
            timeoutMs: 1_000,
            trailingCallbackGraceMs: 0,
            requireInboundCall: false,
          })) === "quiescent",
      ),
      restoreTwilio,
      verifyTwilioResting,
      clearRuntimeSecrets,
      stopHost,
      stopTunnel,
      teardownPersistence,
    });

    await expect(cleanup.execute()).resolves.toEqual({
      outcome: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
    expect(restoreTwilio).not.toHaveBeenCalled();
    expect(verifyTwilioResting).not.toHaveBeenCalled();
    expect(clearRuntimeSecrets).not.toHaveBeenCalled();
    expect(stopHost).not.toHaveBeenCalled();
    expect(stopTunnel).not.toHaveBeenCalled();
    expect(teardownPersistence).not.toHaveBeenCalled();
  });

  it("AC-VERIFY-1 delays restoration past inbound at +1,000 ms", async () => {
    const api = await loadApi();
    const cleanupStartedAt = Date.parse("2026-08-27T20:00:00.000Z");
    let elapsedMs = 0;
    let inboundVisible = false;
    let restorationMutationsAtArrival = -1;
    const events: string[] = [];
    const restoreTwilio = vi.fn(async () => {
      events.push(`restoration:${elapsedMs}`);
    });
    const transport = {
      readConfiguration: vi.fn(),
      updateConfiguration: vi.fn(),
      listInboundCalls: vi.fn(async () => {
        events.push(`observation:${elapsedMs}`);
        return inboundVisible
          ? [{ callSid: "CA_MATCH", direction: "inbound", status: "completed" }]
          : [];
      }),
    };
    const control = api["createTwilioLiveSmokeControl"]!({
      transport,
      digestProviderCall: () => "a".repeat(64),
      restingConfiguration: {
        voiceUrl: "https://reject.invalid/voice",
        statusCallbackUrl: null,
      },
      liveConfiguration: {
        voiceUrl: "https://phase6.invalid/twilio/voice",
        statusCallbackUrl: "https://phase6.invalid/twilio/status",
      },
      now: () => new Date(cleanupStartedAt + elapsedMs).toISOString(),
      wait: async (milliseconds: number) => {
        if (!inboundVisible && elapsedMs < 1_000 && elapsedMs + milliseconds >= 1_000) {
          restorationMutationsAtArrival = restoreTwilio.mock.calls.length;
          inboundVisible = true;
          events.push("inbound-arrived:1000");
        }
        elapsedMs += milliseconds;
      },
    });
    const cleanup = api["createLiveSmokeCleanup"]!({
      closeRunGate: vi.fn(() => events.push("gate-closed")),
      restoreTwilio,
      verifyTwilioResting: vi.fn(async () => true),
      awaitPreRestorationBarrier: exactCallBarrier(
        async () =>
          (await control.awaitQuiescence({
            startedAt: "2026-08-27T19:59:59.000Z",
            boundCallDigest: "a".repeat(64),
            timeoutMs: 5_000,
            trailingCallbackGraceMs: 0,
            requireInboundCall: true,
          })) === "quiescent",
      ),
      clearRuntimeSecrets: vi.fn(),
      stopHost: vi.fn(async () => undefined),
      stopTunnel: vi.fn(async () => undefined),
    });

    await expect(cleanup.execute()).resolves.toEqual({
      outcome: "restored",
      hostAndTunnelMustRemainUp: false,
    });
    expect(restorationMutationsAtArrival).toBe(0);
    expect(events.indexOf("inbound-arrived:1000")).toBeLessThan(
      events.findIndex((event) => event.startsWith("restoration:")),
    );
    expect(restoreTwilio).toHaveBeenCalledOnce();
  });

  it("AC-VERIFY-1 rechecks exact terminal state after grace", async () => {
    const api = await loadApi();
    const cleanupStartedAt = Date.parse("2026-08-27T20:00:00.000Z");
    let elapsedMs = 0;
    const observationAtMs: number[] = [];
    const restorationAtMs: number[] = [];
    const transport = {
      readConfiguration: vi.fn(),
      updateConfiguration: vi.fn(),
      listInboundCalls: vi.fn(async () => {
        observationAtMs.push(elapsedMs);
        return [
          {
            callSid: "CA_MATCH",
            direction: "inbound",
            status: elapsedMs < 250 ? "in-progress" : "completed",
          },
        ];
      }),
    };
    const control = api["createTwilioLiveSmokeControl"]!({
      transport,
      digestProviderCall: () => "a".repeat(64),
      restingConfiguration: {
        voiceUrl: "https://reject.invalid/voice",
        statusCallbackUrl: null,
      },
      liveConfiguration: {
        voiceUrl: "https://phase6.invalid/twilio/voice",
        statusCallbackUrl: "https://phase6.invalid/twilio/status",
      },
      now: () => new Date(cleanupStartedAt + elapsedMs).toISOString(),
      wait: async (milliseconds: number) => {
        elapsedMs += milliseconds;
      },
    });
    const cleanup = api["createLiveSmokeCleanup"]!({
      closeRunGate: vi.fn(),
      restoreTwilio: vi.fn(async () => restorationAtMs.push(elapsedMs)),
      verifyTwilioResting: vi.fn(async () => true),
      awaitPreRestorationBarrier: exactCallBarrier(
        async () =>
          (await control.awaitQuiescence({
            startedAt: "2026-08-27T19:59:59.000Z",
            boundCallDigest: "a".repeat(64),
            timeoutMs: 5_000,
            trailingCallbackGraceMs: 500,
            requireInboundCall: true,
          })) === "quiescent",
      ),
      clearRuntimeSecrets: vi.fn(),
      stopHost: vi.fn(async () => undefined),
      stopTunnel: vi.fn(async () => undefined),
    });

    await expect(cleanup.execute()).resolves.toMatchObject({ outcome: "restored" });
    expect(observationAtMs.at(-1)).toBe(750);
    expect(observationAtMs).toContain(750);
    expect(restorationAtMs).toEqual([750]);
  });

  it("AC-ERROR-1 blocks ambiguous call state before mutation", async () => {
    const api = await loadApi();
    const scenarios = [
      {
        name: "multiple calls",
        calls: [
          { callSid: "CA_MATCH", direction: "inbound", status: "completed" },
          { callSid: "CA_OTHER", direction: "inbound", status: "completed" },
        ],
      },
      {
        name: "mismatched call",
        calls: [{ callSid: "CA_OTHER", direction: "inbound", status: "completed" }],
      },
      {
        name: "unsupported status",
        calls: [{ callSid: "CA_MATCH", direction: "inbound", status: "initiated" }],
      },
    ] as const;
    const observed = [];

    for (const scenario of scenarios) {
      const restoreTwilio = vi.fn(async () => undefined);
      const verifyTwilioResting = vi.fn(async () => true);
      const clearRuntimeSecrets = vi.fn();
      const stopHost = vi.fn(async () => undefined);
      const stopTunnel = vi.fn(async () => undefined);
      const control = api["createTwilioLiveSmokeControl"]!({
        transport: {
          readConfiguration: vi.fn(),
          updateConfiguration: vi.fn(),
          listInboundCalls: vi.fn(async () => scenario.calls),
        },
        digestProviderCall: (callSid: string) =>
          callSid === "CA_MATCH" ? "a".repeat(64) : "b".repeat(64),
        restingConfiguration: {
          voiceUrl: "https://reject.invalid/voice",
          statusCallbackUrl: null,
        },
        liveConfiguration: {
          voiceUrl: "https://phase6.invalid/twilio/voice",
          statusCallbackUrl: "https://phase6.invalid/twilio/status",
        },
        now: () => "2026-08-27T20:00:00.000Z",
        wait: async () => undefined,
      });
      const cleanup = api["createLiveSmokeCleanup"]!({
        closeRunGate: vi.fn(),
        restoreTwilio,
        verifyTwilioResting,
        awaitPreRestorationBarrier: exactCallBarrier(
          async () =>
            (await control.awaitQuiescence({
              startedAt: "2026-08-27T19:59:59.000Z",
              boundCallDigest: "a".repeat(64),
              timeoutMs: 1_000,
              trailingCallbackGraceMs: 0,
              requireInboundCall: true,
            })) === "quiescent",
        ),
        clearRuntimeSecrets,
        stopHost,
        stopTunnel,
      });

      observed.push({
        name: scenario.name,
        result: await cleanup.execute(),
        restorationMutations: restoreTwilio.mock.calls.length,
        restorationReadBacks: verifyTwilioResting.mock.calls.length,
        teardownActions:
          clearRuntimeSecrets.mock.calls.length +
          stopHost.mock.calls.length +
          stopTunnel.mock.calls.length,
      });
    }

    expect(observed).toEqual(
      scenarios.map((scenario) => ({
        name: scenario.name,
        result: { outcome: "blocked", hostAndTunnelMustRemainUp: true },
        restorationMutations: 0,
        restorationReadBacks: 0,
        teardownActions: 0,
      })),
    );
  });

  it("AC-ERROR-1 blocks invalid time before mutation", async () => {
    const api = await loadApi();
    const startedAtMs = Date.parse("2026-08-27T20:00:00.000Z");
    const scenarios = [
      { name: "backward time", nowOffsetsMs: [0, -1], expectedListReads: 0 },
      { name: "deadline exhaustion", nowOffsetsMs: [0, 1_000], expectedListReads: 1 },
    ] as const;
    const observed = [];

    for (const scenario of scenarios) {
      const nowOffsetsMs = [...scenario.nowOffsetsMs];
      const restoreTwilio = vi.fn(async () => undefined);
      const verifyTwilioResting = vi.fn(async () => true);
      const clearRuntimeSecrets = vi.fn();
      const stopHost = vi.fn(async () => undefined);
      const stopTunnel = vi.fn(async () => undefined);
      const listInboundCalls = vi.fn(async () => []);
      const control = api["createTwilioLiveSmokeControl"]!({
        transport: {
          readConfiguration: vi.fn(),
          updateConfiguration: vi.fn(),
          listInboundCalls,
        },
        digestProviderCall: () => "a".repeat(64),
        restingConfiguration: {
          voiceUrl: "https://reject.invalid/voice",
          statusCallbackUrl: null,
        },
        liveConfiguration: {
          voiceUrl: "https://phase6.invalid/twilio/voice",
          statusCallbackUrl: "https://phase6.invalid/twilio/status",
        },
        now: () => new Date(startedAtMs + (nowOffsetsMs.shift() ?? 1_000)).toISOString(),
        wait: async () => undefined,
      });
      const cleanup = api["createLiveSmokeCleanup"]!({
        closeRunGate: vi.fn(),
        restoreTwilio,
        verifyTwilioResting,
        awaitPreRestorationBarrier: exactCallBarrier(
          async () =>
            (await control.awaitQuiescence({
              startedAt: "2026-08-27T19:59:59.000Z",
              boundCallDigest: "a".repeat(64),
              timeoutMs: 1_000,
              trailingCallbackGraceMs: 0,
              requireInboundCall: true,
            })) === "quiescent",
        ),
        clearRuntimeSecrets,
        stopHost,
        stopTunnel,
      });

      observed.push({
        name: scenario.name,
        result: await cleanup.execute(),
        listReads: listInboundCalls.mock.calls.length,
        restorationMutations: restoreTwilio.mock.calls.length,
        restorationReadBacks: verifyTwilioResting.mock.calls.length,
        teardownActions:
          clearRuntimeSecrets.mock.calls.length +
          stopHost.mock.calls.length +
          stopTunnel.mock.calls.length,
      });
    }

    expect(observed).toEqual(
      scenarios.map((scenario) => ({
        name: scenario.name,
        result: { outcome: "blocked", hostAndTunnelMustRemainUp: true },
        listReads: scenario.expectedListReads,
        restorationMutations: 0,
        restorationReadBacks: 0,
        teardownActions: 0,
      })),
    );
  });

  it("AC-ASYNC-1 uses capped backoff under one fixed arrival deadline", async () => {
    const api = await loadApi();
    const cleanupStartedAt = Date.parse("2026-08-27T20:00:00.000Z");
    let elapsedMs = 0;
    const waits: number[] = [];
    const listInboundCalls = vi.fn(async () => []);
    const control = api["createTwilioLiveSmokeControl"]!({
      transport: {
        readConfiguration: vi.fn(),
        updateConfiguration: vi.fn(),
        listInboundCalls,
      },
      digestProviderCall: () => "a".repeat(64),
      restingConfiguration: {
        voiceUrl: "https://reject.invalid/voice",
        statusCallbackUrl: null,
      },
      liveConfiguration: {
        voiceUrl: "https://phase6.invalid/twilio/voice",
        statusCallbackUrl: "https://phase6.invalid/twilio/status",
      },
      now: () => new Date(cleanupStartedAt + elapsedMs).toISOString(),
      wait: async (milliseconds: number) => {
        waits.push(milliseconds);
        elapsedMs += milliseconds;
      },
    });

    await expect(
      control.awaitQuiescence({
        startedAt: "2026-08-27T19:59:59.000Z",
        boundCallDigest: "a".repeat(64),
        timeoutMs: 5_750,
        trailingCallbackGraceMs: 500,
        requireInboundCall: true,
      }),
    ).resolves.toBe("blocked");
    expect(waits).toEqual([250, 500, 1_000, 2_000, 2_000]);
    expect(listInboundCalls).toHaveBeenCalledTimes(6);
    expect(elapsedMs).toBe(5_750);
  });

  it("exposes one exact-call observation without owning a new polling deadline", async () => {
    const api = await loadApi();
    const wait = vi.fn(async () => undefined);
    const listInboundCalls = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { callSid: "opaque-call", direction: "inbound", status: "in-progress" },
      ])
      .mockResolvedValueOnce([
        { callSid: "opaque-call", direction: "inbound", status: "completed" },
      ]);
    const control = api["createTwilioLiveSmokeControl"]!({
      transport: {
        readConfiguration: vi.fn(),
        updateConfiguration: vi.fn(),
        listInboundCalls,
      },
      digestProviderCall: () => "a".repeat(64),
      restingConfiguration: { voiceUrl: "https://reject.invalid/voice", statusCallbackUrl: null },
      liveConfiguration: {
        voiceUrl: "https://phase6.invalid/twilio/voice",
        statusCallbackUrl: "https://phase6.invalid/twilio/status",
      },
      now: () => "2026-08-28T04:00:00.000Z",
      wait,
    });

    await expect(
      control.observeExactCall({
        startedAt: "2026-08-28T03:59:59.000Z",
        endedAt: "2026-08-28T04:00:00.000Z",
        boundCallDigest: "a".repeat(64),
      }),
    ).resolves.toEqual({ outcome: "zero_calls" });
    await expect(
      control.observeExactCall({
        startedAt: "2026-08-28T03:59:59.000Z",
        endedAt: "2026-08-28T04:00:00.250Z",
        boundCallDigest: "a".repeat(64),
      }),
    ).resolves.toEqual({ outcome: "exact_active", status: "in-progress" });
    await expect(
      control.observeExactCall({
        startedAt: "2026-08-28T03:59:59.000Z",
        endedAt: "2026-08-28T04:00:00.500Z",
        boundCallDigest: "a".repeat(64),
      }),
    ).resolves.toEqual({ outcome: "exact_terminal", status: "completed" });
    expect(listInboundCalls).toHaveBeenCalledTimes(3);
    expect(wait).not.toHaveBeenCalled();
  });

  it("AC-VERIFY-2 restores and verifies Reject before clearing secrets or stopping host and tunnel", async () => {
    const api = await loadApi();
    expect(api["createLiveSmokeCleanup"]).toBeTypeOf("function");
    const order: string[] = [];
    const cleanup = api["createLiveSmokeCleanup"]!({
      closeRunGate: vi.fn(() => order.push("gate-closed")),
      restoreTwilio: vi.fn(async () => order.push("twilio-restored")),
      verifyTwilioResting: vi.fn(async () => {
        order.push("twilio-verified");
        return true;
      }),
      awaitPreRestorationBarrier: vi.fn(async () => {
        order.push("twilio-quiescent");
        return { outcome: "ready" as const, proof: "exact_call_quiescent" as const };
      }),
      clearRuntimeSecrets: vi.fn(() => order.push("secrets-cleared")),
      stopHost: vi.fn(async () => order.push("host-stopped")),
      stopTunnel: vi.fn(async () => order.push("tunnel-stopped")),
    });

    await expect(cleanup.execute()).resolves.toEqual({
      outcome: "restored",
      hostAndTunnelMustRemainUp: false,
    });
    await expect(cleanup.execute()).resolves.toEqual({
      outcome: "restored",
      hostAndTunnelMustRemainUp: false,
    });
    expect(order).toEqual([
      "gate-closed",
      "twilio-quiescent",
      "twilio-restored",
      "twilio-verified",
      "secrets-cleared",
      "host-stopped",
      "tunnel-stopped",
    ]);
  });

  it("keeps the host and tunnel up when exact-call quiescence cannot be proven", async () => {
    const api = await loadApi();
    const order: string[] = [];
    const cleanup = api["createLiveSmokeCleanup"]!({
      closeRunGate: vi.fn(() => order.push("gate-closed")),
      restoreTwilio: vi.fn(async () => order.push("twilio-restored")),
      verifyTwilioResting: vi.fn(async () => {
        order.push("twilio-verified");
        return true;
      }),
      awaitPreRestorationBarrier: vi.fn(async () => {
        order.push("twilio-not-quiescent");
        return { outcome: "blocked" as const, reason: "observation_failed" as const };
      }),
      clearRuntimeSecrets: vi.fn(() => order.push("secrets-cleared")),
      stopHost: vi.fn(async () => order.push("host-stopped")),
      stopTunnel: vi.fn(async () => order.push("tunnel-stopped")),
    });

    await expect(cleanup.execute()).resolves.toEqual({
      outcome: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
    expect(order).toEqual(["gate-closed", "twilio-not-quiescent"]);
  });

  it("AC-ERROR-1 fails closed when no pre-restoration proof mechanism exists", async () => {
    const api = await loadApi();
    const restoreTwilio = vi.fn(async () => undefined);
    const verifyTwilioResting = vi.fn(async () => true);
    const clearRuntimeSecrets = vi.fn();
    const stopHost = vi.fn(async () => undefined);
    const stopTunnel = vi.fn(async () => undefined);
    const teardownPersistence = vi.fn(async () => undefined);
    const cleanup = api["createLiveSmokeCleanup"]!({
      closeRunGate: vi.fn(),
      restoreTwilio,
      verifyTwilioResting,
      clearRuntimeSecrets,
      stopHost,
      stopTunnel,
      teardownPersistence,
    });

    await expect(cleanup.execute()).resolves.toEqual({
      outcome: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
    expect(restoreTwilio).not.toHaveBeenCalled();
    expect(verifyTwilioResting).not.toHaveBeenCalled();
    expect(clearRuntimeSecrets).not.toHaveBeenCalled();
    expect(stopHost).not.toHaveBeenCalled();
    expect(stopTunnel).not.toHaveBeenCalled();
    expect(teardownPersistence).not.toHaveBeenCalled();
  });
});
