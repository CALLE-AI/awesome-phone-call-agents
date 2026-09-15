import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

async function loadApi(): Promise<Readonly<Record<string, CallableFunction>>> {
  return (await import("../index.js")) as Readonly<Record<string, CallableFunction>>;
}

function createClosedRunGate() {
  let state: "OPEN" | "CLOSED" = "CLOSED";
  return {
    open: () => {
      state = "OPEN";
    },
    close: () => {
      state = "CLOSED";
    },
    state: () => state,
    assertOpen: () => {
      if (state !== "OPEN") throw new Error("run gate closed");
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("runnable guarded live-smoke process", () => {
  it("keeps the run gate closed until the exact browser attachment succeeds before dispatch", async () => {
    const api = await loadApi();
    const order: string[] = [];
    const runGate = createClosedRunGate();
    const open = vi.spyOn(runGate, "open").mockImplementation(() => {
      order.push("gate-open");
    });
    const attachViewer = vi.fn(async (input: Record<string, unknown>) => {
      order.push(`viewer:${runGate.state()}`);
      expect(input).toEqual({
        baseUrl: "http://127.0.0.1:43111",
        identity: {
          operationId: "operation-viewer-first",
          scenarioId: "synthetic-normal",
          scenarioRevision: 2,
        },
      });
      return "attached" as const;
    });
    const process = api["createGuardedLiveSmokeProcess"]!({
      preflight: { run: vi.fn(async () => ({ outcome: "PASS" as const })) },
      confirm: vi.fn(async () => true),
      createRunGate: () => runGate,
      createControlTransport: vi.fn(() => ({ kind: "control" })),
      createControl: vi.fn(() => ({
        arm: vi.fn(async () => "armed" as const),
        reconcile: vi.fn(),
      })),
      startGuardedRuntime: vi.fn(async () => ({
        baseUrl: "http://127.0.0.1:43111",
        close: vi.fn(async () => undefined),
      })),
      cleanup: vi.fn(async () => ({
        outcome: "restored" as const,
        hostAndTunnelMustRemainUp: false as const,
      })),
      mintAndReserve: vi.fn(async () => {
        order.push(`prepared:${runGate.state()}`);
        return { operationId: "operation-viewer-first", permit: "opaque" };
      }),
      attachViewer,
      submitAndWait: vi.fn(async () => {
        order.push("dispatch");
        return { status: "completed" as const };
      }),
    });

    await expect(
      process.run({ scenarioId: "synthetic-normal", scenarioRevision: 2 }),
    ).resolves.toEqual({ status: "completed" });
    expect(order).toEqual(["prepared:CLOSED", "viewer:CLOSED", "gate-open", "dispatch"]);
    expect(open).toHaveBeenCalledOnce();
  });

  it("cleans up with zero submission when browser launch/readiness blocks", async () => {
    const api = await loadApi();
    const runGate = createClosedRunGate();
    const cleanup = vi.fn(async () => ({
      outcome: "restored" as const,
      hostAndTunnelMustRemainUp: false as const,
    }));
    const submitAndWait = vi.fn();
    const createControlTransport = vi.fn(() => ({ kind: "control" }));
    const process = api["createGuardedLiveSmokeProcess"]!({
      preflight: { run: vi.fn(async () => ({ outcome: "PASS" as const })) },
      confirm: vi.fn(async () => true),
      createRunGate: () => runGate,
      createControlTransport,
      createControl: vi.fn(() => ({
        arm: vi.fn(async () => "armed" as const),
        reconcile: vi.fn(),
      })),
      startGuardedRuntime: vi.fn(async () => ({
        baseUrl: "http://127.0.0.1:43111",
        close: vi.fn(async () => undefined),
      })),
      cleanup,
      mintAndReserve: vi.fn(async () => ({
        operationId: "operation-viewer-blocked",
        permit: "opaque",
      })),
      attachViewer: vi.fn(async () => "blocked" as const),
      submitAndWait,
    });

    await expect(
      process.run({ scenarioId: "synthetic-normal", scenarioRevision: 2 }),
    ).resolves.toEqual({ status: "blocked", hostAndTunnelMustRemainUp: true });
    expect(runGate.state()).toBe("CLOSED");
    expect(submitAndWait).not.toHaveBeenCalled();
    expect(createControlTransport).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("publishes exact prepare/run/cleanup root and package commands", async () => {
    const [root, application] = await Promise.all([
      readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
      readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ]);
    const rootScripts = (JSON.parse(root) as { scripts: Record<string, string> }).scripts;
    const appScripts = (JSON.parse(application) as { scripts: Record<string, string> }).scripts;
    expect(rootScripts["simulator:live-smoke:prepare"]).toContain("live-smoke:prepare");
    expect(rootScripts["simulator:live-smoke:run"]).toBe(
      "corepack pnpm --filter @muster/simulator-host live-smoke:run",
    );
    expect(rootScripts["simulator:live-smoke:cleanup"]).toBe(
      "corepack pnpm --filter @muster/simulator-host live-smoke:cleanup",
    );
    expect(appScripts["live-smoke:prepare"]).toContain("guarded-live-smoke-main.js prepare");
    expect(appScripts["live-smoke:run"]).toContain("guarded-live-smoke-main.js run");
    expect(appScripts["live-smoke:cleanup"]).toContain("guarded-live-smoke-main.js cleanup");
    const api = await loadApi();
    expect(
      api["parseInterruptedCleanupInput"]!([
        "--operation",
        "opaque-operation-id",
        "--previous-owner-stopped",
      ]),
    ).toEqual({ operationId: "opaque-operation-id", previousOwnerStopped: true });
  });

  it("lazily composes the closed guarded host and one cleanup owner only after immediate confirmation", async () => {
    const api = await loadApi();
    expect(api["createGuardedLiveSmokeProcess"]).toBeTypeOf("function");
    const order: string[] = [];
    const createControlTransport = vi.fn(() => {
      order.push("transport");
      return { kind: "twilio-transport" };
    });
    const cleanup = vi.fn(async () => {
      order.push("cleanup");
      return { outcome: "restored" as const, hostAndTunnelMustRemainUp: false as const };
    });
    const startGuardedRuntime = vi.fn(async (input: Record<string, unknown>) => {
      order.push(`host:${String((input["runGate"] as { state(): string }).state())}`);
      expect(input["cleanupLiveSmoke"]).toBeTypeOf("function");
      expect(input["reconcileLiveSmoke"]).toBeTypeOf("function");
      return { baseUrl: "http://127.0.0.1:43111", close: vi.fn(async () => undefined) };
    });
    const process = api["createGuardedLiveSmokeProcess"]!({
      preflight: { run: vi.fn(async () => ({ outcome: "PASS" as const })) },
      confirm: vi.fn(async () => {
        order.push("confirmation");
        return true;
      }),
      createRunGate: createClosedRunGate,
      createControlTransport,
      createControl: vi.fn(() => ({
        arm: async () => {
          order.push("arm-readback");
          return "armed" as const;
        },
        reconcile: vi.fn(),
      })),
      startGuardedRuntime,
      cleanup,
      mintAndReserve: vi.fn(async () => {
        order.push("mint-reserve");
        return { operationId: "operation-process", permit: "opaque" };
      }),
      attachViewer: vi.fn(async () => {
        order.push("viewer-attached");
        return "attached" as const;
      }),
      submitAndWait: vi.fn(async () => {
        order.push("submit-wait");
        return { status: "completed" as const };
      }),
    });

    await expect(process.prepare()).resolves.toMatchObject({ outcome: "PASS" });
    expect(createControlTransport).not.toHaveBeenCalled();
    await expect(
      process.run({ scenarioId: "synthetic-normal", scenarioRevision: 2 }),
    ).resolves.toEqual({ status: "completed" });
    expect(order).toEqual([
      "confirmation",
      "host:CLOSED",
      "mint-reserve",
      "viewer-attached",
      "transport",
      "arm-readback",
      "submit-wait",
      "cleanup",
    ]);
    await expect(
      process.run({ scenarioId: "synthetic-normal", scenarioRevision: 2 }),
    ).resolves.toEqual({
      status: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
  });

  it("cannot construct Twilio transport or dispatch when immediate confirmation is declined", async () => {
    const api = await loadApi();
    const createControlTransport = vi.fn();
    const startGuardedRuntime = vi.fn();
    const submitAndWait = vi.fn();
    const process = api["createGuardedLiveSmokeProcess"]!({
      preflight: { run: vi.fn(async () => ({ outcome: "PASS" as const })) },
      confirm: vi.fn(async () => false),
      createRunGate: createClosedRunGate,
      createControlTransport,
      createControl: vi.fn(),
      startGuardedRuntime,
      cleanup: vi.fn(),
      mintAndReserve: vi.fn(),
      attachViewer: vi.fn(),
      submitAndWait,
    });

    await expect(
      process.run({ scenarioId: "synthetic-normal", scenarioRevision: 2 }),
    ).resolves.toEqual({
      status: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
    expect(createControlTransport).not.toHaveBeenCalled();
    expect(startGuardedRuntime).not.toHaveBeenCalled();
    expect(submitAndWait).not.toHaveBeenCalled();
  });

  it("invokes the cleanup owner when arm read-back fails after host startup", async () => {
    const api = await loadApi();
    const cleanup = vi.fn(async () => ({
      outcome: "restored" as const,
      hostAndTunnelMustRemainUp: false as const,
    }));
    const submitAndWait = vi.fn();
    const process = api["createGuardedLiveSmokeProcess"]!({
      preflight: { run: vi.fn(async () => ({ outcome: "PASS" as const })) },
      confirm: vi.fn(async () => true),
      createRunGate: createClosedRunGate,
      createControlTransport: vi.fn(() => ({ kind: "twilio-transport" })),
      createControl: vi.fn(() => ({
        arm: vi.fn(async () => "blocked" as const),
        reconcile: vi.fn(),
      })),
      startGuardedRuntime: vi.fn(async () => ({
        baseUrl: "http://127.0.0.1:43111",
        close: vi.fn(async () => undefined),
      })),
      cleanup,
      mintAndReserve: vi.fn(async () => ({
        operationId: "operation-arm-blocked",
        permit: "opaque",
      })),
      attachViewer: vi.fn(async () => "attached" as const),
      submitAndWait,
    });

    await expect(
      process.run({ scenarioId: "synthetic-normal", scenarioRevision: 2 }),
    ).resolves.toEqual({
      status: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(submitAndWait).not.toHaveBeenCalled();
  });

  it("maps the guarded admission state and exact operation into its cleanup owner", async () => {
    const api = await loadApi();
    const cleanup = vi.fn(async () => ({
      outcome: "blocked" as const,
      hostAndTunnelMustRemainUp: true as const,
    }));
    const process = api["createGuardedLiveSmokeProcess"]!({
      preflight: { run: vi.fn(async () => ({ outcome: "PASS" as const })) },
      confirm: vi.fn(async () => true),
      createRunGate: createClosedRunGate,
      createControlTransport: vi.fn(() => ({ kind: "injected-control" })),
      createControl: vi.fn(() => ({
        arm: vi.fn(async () => "armed" as const),
        reconcile: vi.fn(),
      })),
      startGuardedRuntime: vi.fn(async () => ({
        baseUrl: "http://127.0.0.1:43111",
        close: vi.fn(async () => undefined),
      })),
      cleanup,
      mintAndReserve: vi.fn(async () => ({
        operationId: "operation-guarded-cleanup",
        permit: "opaque",
      })),
      attachViewer: vi.fn(async () => "attached" as const),
      submitAndWait: vi.fn(async () => {
        throw new Error("admission outcome unknown");
      }),
    });

    await expect(
      process.run({ scenarioId: "synthetic-normal", scenarioRevision: 2 }),
    ).resolves.toEqual({ status: "blocked", hostAndTunnelMustRemainUp: true });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith({
      operationId: "operation-guarded-cleanup",
      admission: "indeterminate",
      previousOwnerStopped: false,
    });
  });

  it("aborts an active pre-review wait, closes its gate, and executes exact external cleanup on shutdown", async () => {
    const api = await loadApi();
    const runGate = createClosedRunGate();
    const close = vi.spyOn(runGate, "close");
    const cleanup = vi.fn(async () => ({
      outcome: "restored" as const,
      hostAndTunnelMustRemainUp: false as const,
    }));
    const submitAndWait = vi.fn(
      async (input: { readonly signal: AbortSignal }): Promise<Readonly<{ status: "completed" }>> =>
        await new Promise<never>((_resolve, reject) => {
          input.signal.addEventListener(
            "abort",
            () => reject(new Error("pre-review wait aborted")),
            { once: true },
          );
        }),
    );
    const process = api["createGuardedLiveSmokeProcess"]!({
      preflight: { run: vi.fn(async () => ({ outcome: "PASS" as const })) },
      confirm: vi.fn(async () => true),
      createRunGate: () => runGate,
      createControlTransport: vi.fn(() => ({ kind: "injected-control" })),
      createControl: vi.fn(() => ({
        arm: vi.fn(async () => "armed" as const),
        reconcile: vi.fn(),
      })),
      startGuardedRuntime: vi.fn(async () => ({
        baseUrl: "http://127.0.0.1:43111",
        close: vi.fn(async () => undefined),
      })),
      cleanup,
      mintAndReserve: vi.fn(async () => ({
        operationId: "operation-interrupted-before-review",
        permit: "opaque",
      })),
      attachViewer: vi.fn(async () => "attached" as const),
      submitAndWait,
    });

    const running = process.run({ scenarioId: "synthetic-normal", scenarioRevision: 2 });
    await vi.waitFor(() => expect(submitAndWait).toHaveBeenCalledOnce());
    await expect(process.shutdown()).resolves.toEqual({
      outcome: "restored",
      hostAndTunnelMustRemainUp: false,
    });
    await expect(running).resolves.toEqual({
      status: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
    expect(submitAndWait.mock.calls[0]?.[0].signal.aborted).toBe(true);
    expect(runGate.state()).toBe("CLOSED");
    expect(close).toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith({
      operationId: "operation-interrupted-before-review",
      admission: "indeterminate",
      previousOwnerStopped: false,
    });
  });

  it("routes shutdown after review readiness to the retained review cleanup owner", async () => {
    const api = await loadApi();
    const externalCleanup = vi.fn(async () => ({
      outcome: "restored" as const,
      hostAndTunnelMustRemainUp: false as const,
    }));
    const retainedReviewCleanup = vi.fn(async () => ({
      outcome: "deleted" as const,
      message: "Protected demo result deleted" as const,
    }));
    const process = api["createGuardedLiveSmokeProcess"]!({
      preflight: { run: vi.fn(async () => ({ outcome: "PASS" as const })) },
      confirm: vi.fn(async () => true),
      createRunGate: createClosedRunGate,
      createControlTransport: vi.fn(() => ({ kind: "injected-control" })),
      createControl: vi.fn(() => ({
        arm: vi.fn(async () => "armed" as const),
        reconcile: vi.fn(),
      })),
      startGuardedRuntime: vi.fn(async () => ({
        baseUrl: "http://127.0.0.1:43111",
        close: vi.fn(async () => undefined),
      })),
      cleanup: externalCleanup,
      shutdownAfterRun: retainedReviewCleanup,
      mintAndReserve: vi.fn(async () => ({
        operationId: "operation-review-ready-shutdown",
        permit: "opaque",
      })),
      attachViewer: vi.fn(async () => "attached" as const),
      submitAndWait: vi.fn(async () => ({ status: "completed" as const })),
    });

    await expect(
      process.run({ scenarioId: "synthetic-normal", scenarioRevision: 2 }),
    ).resolves.toEqual({ status: "completed" });
    await expect(process.shutdown()).resolves.toEqual({
      outcome: "deleted",
      message: "Protected demo result deleted",
    });
    expect(externalCleanup).toHaveBeenCalledOnce();
    expect(retainedReviewCleanup).toHaveBeenCalledOnce();
  });

  it("fences an interrupt while runtime startup is pending before mint, viewer, provider, or submission", async () => {
    const api = await loadApi();
    const runtime = deferred<Readonly<{ baseUrl: string; close(): Promise<void> }>>();
    const cleanup = vi.fn(async () => ({
      outcome: "restored" as const,
      hostAndTunnelMustRemainUp: false as const,
    }));
    const mintAndReserve = vi.fn();
    const attachViewer = vi.fn();
    const createControlTransport = vi.fn();
    const submitAndWait = vi.fn();
    const startGuardedRuntime = vi.fn(async () => await runtime.promise);
    const process = api["createGuardedLiveSmokeProcess"]!({
      preflight: { run: vi.fn(async () => ({ outcome: "PASS" as const })) },
      confirm: vi.fn(async () => true),
      createRunGate: createClosedRunGate,
      createControlTransport,
      createControl: vi.fn(),
      startGuardedRuntime,
      cleanup,
      mintAndReserve,
      attachViewer,
      submitAndWait,
    });

    const running = process.run({ scenarioId: "synthetic-normal", scenarioRevision: 2 });
    await vi.waitFor(() => expect(startGuardedRuntime).toHaveBeenCalledOnce());
    const shutdown = process.shutdown();
    await Promise.resolve();
    expect(cleanup).not.toHaveBeenCalled();
    runtime.resolve({
      baseUrl: "http://127.0.0.1:43111",
      close: vi.fn(async () => undefined),
    });
    await expect(shutdown).resolves.toEqual({
      outcome: "restored",
      hostAndTunnelMustRemainUp: false,
    });
    await expect(running).resolves.toEqual({
      status: "blocked",
      hostAndTunnelMustRemainUp: true,
    });

    expect(mintAndReserve).not.toHaveBeenCalled();
    expect(attachViewer).not.toHaveBeenCalled();
    expect(createControlTransport).not.toHaveBeenCalled();
    expect(submitAndWait).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith({
      admission: "not_started",
      previousOwnerStopped: false,
    });
  });

  it("waits for an in-flight mint identity during shutdown and cleans that exact operation without dispatch", async () => {
    const api = await loadApi();
    const authorization = deferred<Readonly<{ operationId: string; permit: string }>>();
    const cleanup = vi.fn(async () => ({
      outcome: "restored" as const,
      hostAndTunnelMustRemainUp: false as const,
    }));
    const mintAndReserve = vi.fn(async () => await authorization.promise);
    const attachViewer = vi.fn(async () => "attached" as const);
    const createControlTransport = vi.fn();
    const submitAndWait = vi.fn();
    const process = api["createGuardedLiveSmokeProcess"]!({
      preflight: { run: vi.fn(async () => ({ outcome: "PASS" as const })) },
      confirm: vi.fn(async () => true),
      createRunGate: createClosedRunGate,
      createControlTransport,
      createControl: vi.fn(),
      startGuardedRuntime: vi.fn(async () => ({
        baseUrl: "http://127.0.0.1:43111",
        close: vi.fn(async () => undefined),
      })),
      cleanup,
      mintAndReserve,
      attachViewer,
      submitAndWait,
    });

    const running = process.run({ scenarioId: "synthetic-normal", scenarioRevision: 2 });
    await vi.waitFor(() => expect(mintAndReserve).toHaveBeenCalledOnce());
    const shutdown = process.shutdown();
    expect(cleanup).not.toHaveBeenCalled();
    authorization.resolve({ operationId: "operation-minted-during-shutdown", permit: "opaque" });

    await expect(shutdown).resolves.toEqual({
      outcome: "restored",
      hostAndTunnelMustRemainUp: false,
    });
    await expect(running).resolves.toEqual({
      status: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith({
      operationId: "operation-minted-during-shutdown",
      admission: "not_started",
      previousOwnerStopped: false,
    });
    expect(attachViewer).not.toHaveBeenCalled();
    expect(createControlTransport).not.toHaveBeenCalled();
    expect(submitAndWait).not.toHaveBeenCalled();
  });

  it("waits for an in-flight provider arm before exact cleanup restores the resting configuration", async () => {
    const api = await loadApi();
    const armSettlement = deferred<"armed">();
    const runGate = createClosedRunGate();
    const close = vi.spyOn(runGate, "close");
    const order: string[] = [];
    let providerRouting: "resting" | "updating" | "live" = "resting";
    const arm = vi.fn(async () => {
      providerRouting = "updating";
      order.push("arm-started");
      await armSettlement.promise;
      providerRouting = "live";
      order.push("arm-settled-live");
      return "armed" as const;
    });
    const cleanup = vi.fn(async (context: Record<string, unknown>) => {
      order.push(`cleanup-observed-${providerRouting}`);
      expect(providerRouting).toBe("live");
      expect(context).toEqual({
        operationId: "operation-arm-interrupted",
        admission: "not_started",
        previousOwnerStopped: false,
      });
      providerRouting = "resting";
      return {
        outcome: "restored" as const,
        hostAndTunnelMustRemainUp: false as const,
      };
    });
    const submitAndWait = vi.fn();
    const process = api["createGuardedLiveSmokeProcess"]!({
      preflight: { run: vi.fn(async () => ({ outcome: "PASS" as const })) },
      confirm: vi.fn(async () => true),
      createRunGate: () => runGate,
      createControlTransport: vi.fn(() => ({ kind: "injected-control" })),
      createControl: vi.fn(() => ({ arm, reconcile: vi.fn() })),
      startGuardedRuntime: vi.fn(async () => ({
        baseUrl: "http://127.0.0.1:43111",
        close: vi.fn(async () => undefined),
      })),
      cleanup,
      mintAndReserve: vi.fn(async () => ({
        operationId: "operation-arm-interrupted",
        permit: "opaque",
      })),
      attachViewer: vi.fn(async () => "attached" as const),
      submitAndWait,
    });

    const running = process.run({ scenarioId: "synthetic-normal", scenarioRevision: 2 });
    await vi.waitFor(() => expect(arm).toHaveBeenCalledOnce());
    const shutdown = process.shutdown();
    await Promise.resolve();
    expect(cleanup).not.toHaveBeenCalled();

    armSettlement.resolve("armed");
    await expect(shutdown).resolves.toEqual({
      outcome: "restored",
      hostAndTunnelMustRemainUp: false,
    });
    await expect(running).resolves.toEqual({
      status: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
    expect(order).toEqual(["arm-started", "arm-settled-live", "cleanup-observed-live"]);
    expect(providerRouting).toBe("resting");
    expect(runGate.state()).toBe("CLOSED");
    expect(close).toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(submitAndWait).not.toHaveBeenCalled();
  });
});
