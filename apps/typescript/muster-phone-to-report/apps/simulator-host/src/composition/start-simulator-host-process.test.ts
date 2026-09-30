import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

async function loadProcessApi(): Promise<Record<string, unknown>> {
  try {
    return (await import("./start-simulator-host-process.js")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function processTelemetry(runtimeProfile: "development" | "test" | "ci" | "production") {
  return {
    runtimeProfile,
    shutdown: vi.fn(async () => undefined),
    reportProcessFailure: vi.fn(),
  };
}

describe("simulator-host executable process", () => {
  it.each([
    ["a preloaded/runtime profile mismatch", "test", "ci"],
    ["a production runtime profile", "production", "production"],
  ] as const)(
    "blocks %s before runtime resource construction",
    async (_label, preloaded, runtime) => {
      const api = await loadProcessApi();
      expect(api["startSimulatorHostProcess"]).toBeTypeOf("function");
      const telemetry = processTelemetry(preloaded);
      const startRuntime = vi.fn();

      await expect(
        (api["startSimulatorHostProcess"] as CallableFunction)({
          environment: { RUNTIME_PROFILE: runtime },
          telemetry,
          startRuntime,
          signals: { once: vi.fn() },
          setExitCode: vi.fn(),
        }),
      ).rejects.toThrowError(/Simulator host startup failed/u);

      expect(startRuntime).not.toHaveBeenCalled();
      expect(telemetry.reportProcessFailure).toHaveBeenCalledOnce();
      expect(telemetry.reportProcessFailure).toHaveBeenCalledWith({ phase: "startup" });
      expect(telemetry.shutdown).toHaveBeenCalledOnce();
    },
  );

  it("reports startup failure safely and flushes the preloaded telemetry lifecycle once", async () => {
    const api = await loadProcessApi();
    expect(api["startSimulatorHostProcess"]).toBeTypeOf("function");
    const telemetry = processTelemetry("test");
    const startRuntime = vi.fn(async () => {
      throw new Error("protected-token startup detail");
    });

    await expect(
      (api["startSimulatorHostProcess"] as CallableFunction)({
        environment: { RUNTIME_PROFILE: "test" },
        telemetry,
        startRuntime,
        signals: { once: vi.fn() },
        setExitCode: vi.fn(),
      }),
    ).rejects.toThrowError(/^Simulator host startup failed$/u);

    expect(telemetry.reportProcessFailure).toHaveBeenCalledOnce();
    expect(telemetry.reportProcessFailure).toHaveBeenCalledWith({ phase: "startup" });
    expect(telemetry.shutdown).toHaveBeenCalledOnce();
    expect(JSON.stringify(telemetry.reportProcessFailure.mock.calls)).not.toMatch(
      /protected-token/iu,
    );
  });

  it.each([1, 2])(
    "unwinds the acquired runtime before telemetry when signal registration %i fails",
    async (failedRegistration) => {
      const api = await loadProcessApi();
      expect(api["startSimulatorHostProcess"]).toBeTypeOf("function");
      const events: string[] = [];
      const telemetry = processTelemetry("test");
      telemetry.shutdown.mockImplementation(async () => {
        events.push("telemetry:shutdown");
      });
      const closeRuntime = vi.fn(async () => {
        events.push("runtime:close");
      });
      let registrations = 0;

      await expect(
        (api["startSimulatorHostProcess"] as CallableFunction)({
          environment: { RUNTIME_PROFILE: "test" },
          telemetry,
          startRuntime: vi.fn(async () => ({
            baseUrl: "http://127.0.0.1:1",
            close: closeRuntime,
          })),
          signals: {
            once: vi.fn(() => {
              registrations += 1;
              if (registrations === failedRegistration) {
                throw new Error("protected signal-registration detail");
              }
            }),
          },
          setExitCode: vi.fn(),
        }),
      ).rejects.toThrowError(/^Simulator host startup failed$/u);

      expect(events).toEqual(["runtime:close", "telemetry:shutdown"]);
      expect(closeRuntime).toHaveBeenCalledOnce();
      expect(telemetry.shutdown).toHaveBeenCalledOnce();
      expect(telemetry.reportProcessFailure).toHaveBeenCalledWith({ phase: "startup" });
      expect(JSON.stringify(telemetry.reportProcessFailure.mock.calls)).not.toMatch(/protected/u);
    },
  );

  it("owns deterministic non-recursive shutdown reporting and telemetry flush", async () => {
    const api = await loadProcessApi();
    expect(api["startSimulatorHostProcess"]).toBeTypeOf("function");
    const telemetry = processTelemetry("test");
    telemetry.reportProcessFailure.mockImplementation(() => {
      throw new Error("synthetic telemetry reporting failure");
    });
    const close = vi.fn(async () => {
      throw new Error("protected-secret shutdown detail");
    });
    const setExitCode = vi.fn();

    const processRuntime = (await (api["startSimulatorHostProcess"] as CallableFunction)({
      environment: { RUNTIME_PROFILE: "test" },
      telemetry,
      startRuntime: vi.fn(async () => ({ baseUrl: "http://127.0.0.1:1", close })),
      signals: { once: vi.fn() },
      setExitCode,
    })) as { close(): Promise<void> };

    await expect(processRuntime.close()).rejects.toThrowError(/^Simulator host shutdown failed$/u);
    await expect(processRuntime.close()).rejects.toThrowError(/^Simulator host shutdown failed$/u);
    expect(close).toHaveBeenCalledOnce();
    expect(telemetry.shutdown).toHaveBeenCalledOnce();
    expect(telemetry.reportProcessFailure).toHaveBeenCalledOnce();
    expect(telemetry.reportProcessFailure).toHaveBeenCalledWith({ phase: "shutdown" });
    expect(setExitCode).not.toHaveBeenCalled();
    expect(JSON.stringify(telemetry.reportProcessFailure.mock.calls)).not.toMatch(
      /protected-secret/iu,
    );
  });

  it("bounds runtime and telemetry cleanup independently without selecting an exit code", async () => {
    vi.useFakeTimers();
    const api = await loadProcessApi();
    const telemetry = processTelemetry("test");
    telemetry.shutdown.mockImplementation(async () => await new Promise<void>(() => undefined));
    const closeRuntime = vi.fn(async () => await new Promise<void>(() => undefined));
    const setExitCode = vi.fn();
    const processRuntime = (await (api["startSimulatorHostProcess"] as CallableFunction)({
      environment: { RUNTIME_PROFILE: "test" },
      telemetry,
      startRuntime: vi.fn(async () => ({
        baseUrl: "http://127.0.0.1:1",
        close: closeRuntime,
      })),
      signals: { once: vi.fn() },
      setExitCode,
      shutdownTimeoutMs: 25,
    })) as { close(): Promise<void> };
    let outcome: "resolved" | "rejected" | undefined;

    void processRuntime.close().then(
      () => {
        outcome = "resolved";
      },
      () => {
        outcome = "rejected";
      },
    );
    await vi.advanceTimersByTimeAsync(25);

    expect(outcome).toBe("rejected");
    expect(closeRuntime).toHaveBeenCalledOnce();
    expect(telemetry.shutdown).toHaveBeenCalledOnce();
    expect(telemetry.reportProcessFailure).toHaveBeenCalledOnce();
    expect(setExitCode).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("keeps the committed entrypoint awaited and free of console failure reporting", async () => {
    const mainSource = await readFile(new URL("../main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain(
      'import { startSimulatorHostProcess } from "./composition/start-simulator-host-process.js";',
    );
    expect(mainSource).toContain("await startSimulatorHostProcess();");
    expect(mainSource).not.toMatch(/console\./u);
  });
});
