import { Writable } from "node:stream";

import { expect, it } from "vitest";

it("emits correlated structured logs while redacting protected fields and allowed-field values", async () => {
  const moduleUrl = new URL("./logger.ts", import.meta.url).href;
  const observability = (await import(/* @vite-ignore */ moduleUrl)) as {
    createPinoLogger: (options: {
      destination: Writable;
      bindings: Record<string, string>;
      activeTrace: () => { readonly traceId: string; readonly spanId: string };
    }) => { info(event: Record<string, unknown>): void };
    createPinoLoggerRuntime: (options: {
      destination: Writable;
      bindings: Record<string, string>;
      activeTrace: () => { readonly traceId: string; readonly spanId: string };
    }) => {
      logger: { info(event: Record<string, unknown>): void };
      close(): Promise<void>;
    };
  };
  let output = "";
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const runtime = observability.createPinoLoggerRuntime({
    destination,
    bindings: { service: "muster-worker", environment: "test", runtime: "worker" },
    activeTrace: () => ({ traceId: "trace-safe", spanId: "span-safe" }),
  });
  const logger = runtime.logger;

  logger.info({
    event: "job.started",
    correlationId: "correlation-safe",
    jobType: "foundation-health.v1",
    authorization: "Bearer seeded-secret",
    phone: "+1-202-555-0199",
    transcript: "seeded transcript",
  });
  logger.info({
    event: "job.started",
    correlationId: "+1-202-555-0199",
    jobType: "foundation-health.v1",
  });
  logger.info({
    event: "job.started",
    correlationId: "Bearer seeded-secret",
    jobType: "foundation-health.v1",
  });
  const records = output
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const record = records[0];

  expect(record).toMatchObject({
    event: "job.started",
    correlationId: "correlation-safe",
    traceId: "trace-safe",
    spanId: "span-safe",
    service: "muster-worker",
  });
  expect(output).not.toContain("seeded-secret");
  expect(output).not.toContain("202-555-0199");
  expect(output).not.toContain("seeded transcript");
  expect(record).not.toHaveProperty("authorization");
  expect(records[1]?.["correlationId"]).toBe("[REDACTED]");
  expect(records[2]?.["correlationId"]).toBe("[REDACTED]");
  await expect(runtime.close()).resolves.toBeUndefined();
});
