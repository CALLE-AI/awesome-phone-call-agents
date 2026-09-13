import { describe, expect, it } from "vitest";

async function loadRuntimeFactory(): Promise<
  (dependencies: Record<string, unknown>) => {
    readonly ready: boolean;
    start(): Promise<void>;
    stop(): Promise<void>;
  }
> {
  const moduleUrl = new URL("./create-foundation-worker-runtime.ts", import.meta.url).href;
  const module = (await import(/* @vite-ignore */ moduleUrl)) as {
    createFoundationWorkerRuntime: (dependencies: Record<string, unknown>) => {
      readonly ready: boolean;
      start(): Promise<void>;
      stop(): Promise<void>;
    };
  };
  return module.createFoundationWorkerRuntime;
}

describe("foundation worker lifecycle", () => {
  it("starts telemetry before jobs and shuts admission before owned resources", async () => {
    const createFoundationWorkerRuntime = await loadRuntimeFactory();
    const calls: string[] = [];
    const runtime = createFoundationWorkerRuntime({
      telemetry: {
        start: () => calls.push("telemetry.start"),
        shutdown: async () => {
          calls.push("telemetry.stop");
        },
      },
      jobs: {
        start: async () => {
          calls.push("jobs.start");
        },
        work: async () => {
          calls.push("jobs.work");
        },
        stop: async () => {
          calls.push("jobs.stop");
        },
      },
      handler: async () => undefined,
      closeDatabase: async () => {
        calls.push("database.stop");
      },
      closeLogger: async () => {
        calls.push("logger.stop");
      },
    });

    await runtime.start();
    expect(runtime.ready).toBe(true);
    await runtime.stop();

    expect(runtime.ready).toBe(false);
    expect(calls).toEqual([
      "telemetry.start",
      "jobs.start",
      "jobs.work",
      "jobs.stop",
      "database.stop",
      "telemetry.stop",
      "logger.stop",
    ]);
  });

  it("cleans every started resource when job startup fails", async () => {
    const createFoundationWorkerRuntime = await loadRuntimeFactory();
    const calls: string[] = [];
    const runtime = createFoundationWorkerRuntime({
      telemetry: {
        start: () => calls.push("telemetry.start"),
        shutdown: async () => {
          calls.push("telemetry.stop");
        },
      },
      jobs: {
        start: async () => {
          calls.push("jobs.start");
          throw new Error("synthetic jobs startup failure");
        },
        work: async () => undefined,
        stop: async () => {
          calls.push("jobs.stop");
        },
      },
      handler: async () => undefined,
      closeDatabase: async () => {
        calls.push("database.stop");
      },
      closeLogger: async () => {
        calls.push("logger.stop");
      },
    });

    await expect(runtime.start()).rejects.toThrow("synthetic jobs startup failure");
    expect(runtime.ready).toBe(false);
    expect(calls).toEqual([
      "telemetry.start",
      "jobs.start",
      "jobs.stop",
      "database.stop",
      "telemetry.stop",
      "logger.stop",
    ]);
  });

  it("continues shutdown after individual cleanup failures and reports them together", async () => {
    const createFoundationWorkerRuntime = await loadRuntimeFactory();
    const calls: string[] = [];
    const runtime = createFoundationWorkerRuntime({
      telemetry: {
        start: () => undefined,
        shutdown: async () => {
          calls.push("telemetry.stop");
        },
      },
      jobs: {
        start: async () => undefined,
        work: async () => undefined,
        stop: async () => {
          calls.push("jobs.stop");
          throw new Error("synthetic jobs stop failure");
        },
      },
      handler: async () => undefined,
      closeDatabase: async () => {
        calls.push("database.stop");
        throw new Error("synthetic database stop failure");
      },
      closeLogger: async () => {
        calls.push("logger.stop");
      },
    });
    await runtime.start();

    const stopped = runtime.stop();
    await expect(stopped).rejects.toBeInstanceOf(AggregateError);
    await expect(stopped).rejects.toThrow("Worker shutdown failed");
    expect(runtime.ready).toBe(false);
    expect(calls).toEqual(["jobs.stop", "database.stop", "telemetry.stop", "logger.stop"]);
  });
});
