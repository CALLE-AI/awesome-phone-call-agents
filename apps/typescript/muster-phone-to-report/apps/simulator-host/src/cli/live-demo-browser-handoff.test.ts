import { describe, expect, it, vi } from "vitest";

async function loadApi(): Promise<Readonly<Record<string, CallableFunction>>> {
  return (await import("../index.js")) as Readonly<Record<string, CallableFunction>>;
}

const identity = Object.freeze({
  operationId: "operation-review-001",
  scenarioId: "synthetic-normal",
  scenarioRevision: 2,
});

const exactGet = Object.freeze({
  source: "server_http_runtime",
  method: "GET",
  route: "/api/v1/live-simulator/operations/operation-review-001",
  statusCode: 200,
  projectionIdentity: identity,
});

describe("automatic live demo browser handoff", () => {
  it("allows 60 seconds by default for the exact viewer-readiness GET", async () => {
    const api = await loadApi();
    const scheduleDeadline = vi.fn((callback: () => void, delayMs: number) => {
      expect(callback).toBeTypeOf("function");
      expect(delayMs).toBe(60_000);
      return () => undefined;
    });
    const handoff = api["createLiveDemoBrowserHandoff"]!({
      launchBrowser: vi.fn(async () => undefined),
      scheduleDeadline,
    }) as {
      attach(input: Record<string, unknown>): Promise<unknown>;
      observe(input: Record<string, unknown>): void;
    };

    const attached = handoff.attach({
      simulatorUrl: "http://127.0.0.1:4173/simulator.html",
      identity,
    });
    await vi.waitFor(() =>
      expect(scheduleDeadline).toHaveBeenCalledWith(expect.any(Function), 60_000),
    );
    handoff.observe(exactGet);
    await expect(attached).resolves.toEqual({ outcome: "attached", identity });
  });

  it("opens Simulator Lab with only the exact tuple in a fragment and waits for its server GET", async () => {
    const api = await loadApi();
    expect(api["createLiveDemoBrowserHandoff"]).toBeTypeOf("function");
    const launchBrowser = vi.fn(async () => undefined);
    const handoff = api["createLiveDemoBrowserHandoff"]!({
      launchBrowser,
      scheduleDeadline: vi.fn(() => () => undefined),
    }) as {
      attach(input: Record<string, unknown>): Promise<unknown>;
      observe(input: Record<string, unknown>): void;
    };

    const attached = handoff.attach({
      simulatorUrl: "http://127.0.0.1:4173/simulator.html",
      identity,
    });
    await vi.waitFor(() => expect(launchBrowser).toHaveBeenCalledOnce());
    const launched = new URL(String(launchBrowser.mock.calls[0]?.[0]));
    expect(launched.origin + launched.pathname).toBe("http://127.0.0.1:4173/simulator.html");
    expect(new URLSearchParams(launched.hash.slice(1))).toEqual(
      new URLSearchParams({
        operationId: identity.operationId,
        scenarioId: identity.scenarioId,
        scenarioRevision: "2",
      }),
    );
    expect(launched.href).not.toMatch(/permit|credential|phone|transcript/iu);

    handoff.observe(exactGet);
    await expect(attached).resolves.toEqual({ outcome: "attached", identity });
  });

  it("accepts the bracketed IPv6 loopback URL without accepting a non-loopback host", async () => {
    const api = await loadApi();
    const launchBrowser = vi.fn(async () => undefined);
    const handoff = api["createLiveDemoBrowserHandoff"]!({
      launchBrowser,
      scheduleDeadline: vi.fn(() => () => undefined),
    }) as {
      attach(input: Record<string, unknown>): Promise<unknown>;
      observe(input: Record<string, unknown>): void;
    };

    const attached = handoff.attach({
      simulatorUrl: "http://[::1]:4173/simulator.html",
      identity,
    });
    await vi.waitFor(() => expect(launchBrowser).toHaveBeenCalledOnce());
    expect(String(launchBrowser.mock.calls[0]?.[0])).toMatch(
      /^http:\/\/\[::1\]:4173\/simulator\.html#/u,
    );
    handoff.observe(exactGet);
    await expect(attached).resolves.toEqual({ outcome: "attached", identity });

    await expect(
      handoff.attach({ simulatorUrl: "http://192.0.2.1:4173/simulator.html", identity }),
    ).rejects.toThrow("Live demo browser URL is invalid");
  });

  it("ignores mismatched and non-GET observations until the exact server observation arrives", async () => {
    const api = await loadApi();
    expect(api["createLiveDemoBrowserHandoff"]).toBeTypeOf("function");
    const handoff = api["createLiveDemoBrowserHandoff"]!({
      launchBrowser: vi.fn(async () => undefined),
      scheduleDeadline: vi.fn(() => () => undefined),
    }) as {
      attach(input: Record<string, unknown>): Promise<unknown>;
      observe(input: Record<string, unknown>): void;
    };
    let settled = false;
    const attached = handoff
      .attach({ simulatorUrl: "http://127.0.0.1:4173/simulator.html", identity })
      .finally(() => {
        settled = true;
      });
    handoff.observe({ ...exactGet, method: "POST" });
    handoff.observe({
      ...exactGet,
      projectionIdentity: { ...identity, scenarioRevision: 3 },
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    handoff.observe(exactGet);
    await expect(attached).resolves.toMatchObject({ outcome: "attached" });
  });

  it("fails closed on launch failure or readiness deadline without retaining a pending handoff", async () => {
    const api = await loadApi();
    expect(api["createLiveDemoBrowserHandoff"]).toBeTypeOf("function");
    const launchFailure = api["createLiveDemoBrowserHandoff"]!({
      launchBrowser: vi.fn(async () => {
        throw new Error("browser unavailable");
      }),
    }) as { attach(input: Record<string, unknown>): Promise<unknown> };
    await expect(
      launchFailure.attach({ simulatorUrl: "http://127.0.0.1:4173/simulator.html", identity }),
    ).resolves.toEqual({ outcome: "blocked", reason: "launch_failed" });

    let expire: (() => void) | undefined;
    const deadline = api["createLiveDemoBrowserHandoff"]!({
      launchBrowser: vi.fn(async () => undefined),
      scheduleDeadline: (callback: () => void) => {
        expire = callback;
        return () => undefined;
      },
    }) as {
      attach(input: Record<string, unknown>): Promise<unknown>;
      observe(input: Record<string, unknown>): void;
    };
    const timedOut = deadline.attach({
      simulatorUrl: "http://127.0.0.1:4173/simulator.html",
      identity,
      timeoutMs: 5_000,
    });
    await vi.waitFor(() => expect(expire).toBeTypeOf("function"));
    expire?.();
    await expect(timedOut).resolves.toEqual({ outcome: "blocked", reason: "readiness_timeout" });
    deadline.observe(exactGet);
  });
});
