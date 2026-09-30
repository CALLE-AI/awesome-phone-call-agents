import { describe, expect, it, vi } from "vitest";

async function loadApi(): Promise<Readonly<Record<string, CallableFunction>>> {
  return (await import("./guarded-live-smoke-runtime.js")) as Readonly<
    Record<string, CallableFunction>
  >;
}

describe("guarded live-smoke runtime cleanup ownership", () => {
  it("requires one explicit opaque operation id and stopped-owner confirmation for cleanup", async () => {
    const api = await loadApi();
    expect(api["parseInterruptedCleanupInput"]).toBeTypeOf("function");
    expect(
      api["parseInterruptedCleanupInput"]!([
        "--operation",
        "operation-cleanup-recovery",
        "--previous-owner-stopped",
      ]),
    ).toEqual({ operationId: "operation-cleanup-recovery", previousOwnerStopped: true });
    expect(() => api["parseInterruptedCleanupInput"]!([])).toThrow(
      "Live-smoke cleanup operation is required",
    );
    expect(() =>
      api["parseInterruptedCleanupInput"]!([
        "--operation",
        "operation-cleanup-recovery",
        "--provider-call",
        "forbidden-raw-provider-identity",
        "--previous-owner-stopped",
      ]),
    ).toThrow("Live-smoke cleanup arguments are invalid");
  });

  it("ignores arbitrary environment PIDs and never passes them to process.kill", async () => {
    const api = await loadApi();
    expect(api["createManualTunnelStopOwner"]).toBeTypeOf("function");
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const owner = api["createManualTunnelStopOwner"]!({
      environment: { SIMULATOR_NGROK_PID: "424242" },
      acknowledgeStopped: vi.fn(async () => false),
    });

    await expect(owner.stop()).resolves.toBe("manual_stop_required");
    expect(kill).not.toHaveBeenCalled();
    kill.mockRestore();
  });

  it("stops the host before using the distinct injected tunnel owner and tearing down persistence", async () => {
    const api = await loadApi();
    expect(api["createGuardedRuntimeCleanupOwner"]).toBeTypeOf("function");
    const order: string[] = [];
    const stopTunnel = vi.fn(async () => order.push("stop-tunnel"));
    const teardownPersistence = vi.fn(async () => order.push("teardown-persistence"));
    const cleanup = api["createGuardedRuntimeCleanupOwner"]!({
      closeRunGate: () => order.push("close-gate"),
      awaitPreRestorationBarrier: async () => {
        order.push("zero-dispatch-proven");
        return { outcome: "ready" as const, proof: "zero_dispatch" as const };
      },
      restoreTwilio: async () => order.push("restore-twilio"),
      verifyTwilioResting: async () => {
        order.push("verify-resting");
        return true;
      },
      clearRuntimeSecrets: () => order.push("clear-secrets"),
      stopTunnel,
      stopHost: async () => order.push("stop-host"),
      teardownPersistence,
    });

    await expect(cleanup.execute()).resolves.toEqual({
      outcome: "restored",
      hostAndTunnelMustRemainUp: false,
    });
    expect(order).toEqual([
      "close-gate",
      "zero-dispatch-proven",
      "restore-twilio",
      "verify-resting",
      "clear-secrets",
      "stop-host",
      "stop-tunnel",
      "teardown-persistence",
    ]);
    expect(stopTunnel).toHaveBeenCalledOnce();
    expect(teardownPersistence).toHaveBeenCalledOnce();
  });

  it("AC-VERIFY-3 restores immediately only after proven zero dispatch", async () => {
    const api = await loadApi();
    const order: string[] = [];
    const awaitPreRestorationBarrier = vi.fn(async () => {
      order.push("zero-dispatch-proven");
      return { outcome: "ready" as const, proof: "zero_dispatch" as const };
    });
    const cleanup = api["createGuardedRuntimeCleanupOwner"]!({
      closeRunGate: () => order.push("close-gate"),
      awaitPreRestorationBarrier,
      restoreTwilio: async () => order.push("restore-twilio"),
      verifyTwilioResting: async () => {
        order.push("verify-resting");
        return true;
      },
      clearRuntimeSecrets: () => order.push("clear-secrets"),
      stopHost: async () => order.push("stop-host"),
      stopTunnel: async () => order.push("stop-tunnel"),
      teardownPersistence: async () => order.push("teardown-persistence"),
    });

    await expect(cleanup.execute()).resolves.toEqual({
      outcome: "restored",
      hostAndTunnelMustRemainUp: false,
    });
    expect(order).toEqual([
      "close-gate",
      "zero-dispatch-proven",
      "restore-twilio",
      "verify-resting",
      "clear-secrets",
      "stop-host",
      "stop-tunnel",
      "teardown-persistence",
    ]);
    expect(awaitPreRestorationBarrier).toHaveBeenCalledOnce();
  });

  it("AC-ERROR-1 retains resources when call identity is missing", async () => {
    const api = await loadApi();
    const awaitPreRestorationBarrier = vi.fn(async () => ({
      outcome: "blocked" as const,
      reason: "identity_deadline" as const,
    }));
    const restoreTwilio = vi.fn(async () => undefined);
    const verifyTwilioResting = vi.fn(async () => true);
    const clearRuntimeSecrets = vi.fn();
    const stopHost = vi.fn(async () => undefined);
    const stopTunnel = vi.fn(async () => undefined);
    const teardownPersistence = vi.fn(async () => undefined);
    const cleanup = api["createGuardedRuntimeCleanupOwner"]!({
      closeRunGate: vi.fn(),
      awaitPreRestorationBarrier,
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
    expect(awaitPreRestorationBarrier).toHaveBeenCalledOnce();
    expect(restoreTwilio).not.toHaveBeenCalled();
    expect(verifyTwilioResting).not.toHaveBeenCalled();
    expect(clearRuntimeSecrets).not.toHaveBeenCalled();
    expect(stopHost).not.toHaveBeenCalled();
    expect(stopTunnel).not.toHaveBeenCalled();
    expect(teardownPersistence).not.toHaveBeenCalled();
  });

  it("AC-ASYNC-1 memoizes concurrent terminal blocking without duplicating effects", async () => {
    const api = await loadApi();
    const awaitPreRestorationBarrier = vi
      .fn()
      .mockResolvedValueOnce({ outcome: "blocked" as const, reason: "identity_deadline" as const })
      .mockResolvedValue({ outcome: "ready" as const, proof: "zero_dispatch" as const });
    const restoreTwilio = vi.fn(async () => undefined);
    const verifyTwilioResting = vi.fn(async () => true);
    const clearRuntimeSecrets = vi.fn();
    const stopHost = vi.fn(async () => undefined);
    const stopTunnel = vi.fn(async () => undefined);
    const teardownPersistence = vi.fn(async () => undefined);
    const cleanup = api["createGuardedRuntimeCleanupOwner"]!({
      closeRunGate: vi.fn(),
      awaitPreRestorationBarrier,
      restoreTwilio,
      verifyTwilioResting,
      clearRuntimeSecrets,
      stopHost,
      stopTunnel,
      teardownPersistence,
    });

    const first = cleanup.execute();
    const concurrent = cleanup.execute();
    expect(concurrent).toBe(first);
    await expect(Promise.all([first, concurrent])).resolves.toEqual([
      { outcome: "blocked", hostAndTunnelMustRemainUp: true },
      { outcome: "blocked", hostAndTunnelMustRemainUp: true },
    ]);
    const repeated = cleanup.execute();
    expect(repeated).toBe(first);
    await expect(repeated).resolves.toEqual({
      outcome: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
    expect(awaitPreRestorationBarrier).toHaveBeenCalledOnce();
    expect(restoreTwilio).not.toHaveBeenCalled();
    expect(verifyTwilioResting).not.toHaveBeenCalled();
    expect(clearRuntimeSecrets).not.toHaveBeenCalled();
    expect(stopHost).not.toHaveBeenCalled();
    expect(stopTunnel).not.toHaveBeenCalled();
    expect(teardownPersistence).not.toHaveBeenCalled();
  });

  it("never stops the tunnel, host, or persistence when resting Reject cannot be verified", async () => {
    const api = await loadApi();
    const stopTunnel = vi.fn();
    const stopHost = vi.fn();
    const teardownPersistence = vi.fn();
    const cleanup = api["createGuardedRuntimeCleanupOwner"]!({
      closeRunGate: vi.fn(),
      awaitPreRestorationBarrier: async () => ({
        outcome: "ready" as const,
        proof: "zero_dispatch" as const,
      }),
      restoreTwilio: vi.fn(async () => undefined),
      verifyTwilioResting: vi.fn(async () => false),
      clearRuntimeSecrets: vi.fn(),
      stopTunnel,
      stopHost,
      teardownPersistence,
    });

    await expect(cleanup.execute()).resolves.toEqual({
      outcome: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
    expect(stopTunnel).not.toHaveBeenCalled();
    expect(stopHost).not.toHaveBeenCalled();
    expect(teardownPersistence).not.toHaveBeenCalled();
  });

  it("keeps persistence alive but reports the host stopped until owned-tunnel stop is acknowledged", async () => {
    const api = await loadApi();
    const stopHost = vi.fn();
    const teardownPersistence = vi.fn();
    const cleanup = api["createGuardedRuntimeCleanupOwner"]!({
      closeRunGate: vi.fn(),
      awaitPreRestorationBarrier: async () => ({
        outcome: "ready" as const,
        proof: "zero_dispatch" as const,
      }),
      restoreTwilio: vi.fn(async () => undefined),
      verifyTwilioResting: vi.fn(async () => true),
      clearRuntimeSecrets: vi.fn(),
      stopTunnel: vi.fn(async () => "manual_stop_required" as const),
      stopHost,
      teardownPersistence,
    });

    await expect(cleanup.execute()).resolves.toEqual({
      outcome: "manual_stop_required",
      hostAndTunnelMustRemainUp: false,
      hostStopped: true,
      tunnelStopRequired: true,
    });
    expect(stopHost).toHaveBeenCalledOnce();
    expect(teardownPersistence).not.toHaveBeenCalled();
  });
});
