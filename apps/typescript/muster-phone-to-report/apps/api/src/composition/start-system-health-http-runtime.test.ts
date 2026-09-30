import { describe, expect, it } from "vitest";

interface RuntimeModule {
  readonly createSystemHealthRuntimeCloser: (
    resources: readonly (() => Promise<void>)[],
  ) => () => Promise<void>;
  readonly startSystemHealthHttpRuntime: (options: {
    readonly connectionString: string;
    readonly healthExposure: "internal-policy" | "disabled";
    readonly jobsSchema: string;
    readonly runtimeProfile: "production" | "development";
    readonly startJobs: boolean;
  }) => Promise<unknown>;
}

describe("system-health HTTP runtime lifecycle", () => {
  it("attempts every owned cleanup exactly once and shares concurrent shutdown", async () => {
    const moduleUrl = new URL("./start-system-health-http-runtime.ts", import.meta.url).href;
    const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Partial<RuntimeModule>;
    if (loaded.createSystemHealthRuntimeCloser === undefined) {
      throw new Error("createSystemHealthRuntimeCloser is not implemented");
    }
    const calls: string[] = [];
    const close = loaded.createSystemHealthRuntimeCloser([
      async () => {
        calls.push("http");
        throw new Error("synthetic http close failure");
      },
      async () => {
        calls.push("jobs");
      },
      async () => {
        calls.push("database");
        throw new Error("synthetic database close failure");
      },
      async () => {
        calls.push("telemetry");
      },
      async () => {
        calls.push("logger");
      },
    ]);

    const first = close();
    const second = close();
    expect(first).toBe(second);
    await expect(first).rejects.toBeInstanceOf(AggregateError);
    expect(calls).toEqual(["http", "jobs", "database", "telemetry", "logger"]);
    await expect(close()).rejects.toBeInstanceOf(AggregateError);
    expect(calls).toHaveLength(5);
  });

  it("rejects production internal exposure without an adapter before constructing dependencies", async () => {
    const moduleUrl = new URL("./start-system-health-http-runtime.ts", import.meta.url).href;
    const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Partial<RuntimeModule>;
    if (loaded.startSystemHealthHttpRuntime === undefined) {
      throw new Error("startSystemHealthHttpRuntime is not implemented");
    }
    await expect(
      loaded.startSystemHealthHttpRuntime({
        connectionString: "not-a-valid-connection-string",
        healthExposure: "internal-policy",
        jobsSchema: "pgboss",
        runtimeProfile: "production",
        startJobs: false,
      }),
    ).rejects.toThrow("Invalid API configuration: HEALTH_ACCESS_POLICY");
  });

  it("rejects a non-test composition without a Fleet authorizer before constructing dependencies", async () => {
    const moduleUrl = new URL("./start-system-health-http-runtime.ts", import.meta.url).href;
    const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Partial<RuntimeModule>;
    if (loaded.startSystemHealthHttpRuntime === undefined) {
      throw new Error("startSystemHealthHttpRuntime is not implemented");
    }
    await expect(
      loaded.startSystemHealthHttpRuntime({
        connectionString: "not-a-valid-connection-string",
        healthExposure: "disabled",
        jobsSchema: "pgboss",
        runtimeProfile: "production",
        startJobs: false,
      }),
    ).rejects.toThrow("Invalid API configuration: FLEET_REQUEST_AUTHORIZER");
  });
});
