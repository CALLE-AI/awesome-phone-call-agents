import { expect, it } from "vitest";

it("records the closed job, queue-delay, and readiness metric contracts without unbounded attributes", async () => {
  const moduleUrl = new URL("./metrics.ts", import.meta.url).href;
  const observability = (await import(/* @vite-ignore */ moduleUrl)) as {
    createInMemoryFoundationMetrics: () => {
      metrics: {
        recordJobExecution(input: Record<string, unknown>): void;
        recordJobQueueDelay(input: Record<string, unknown>): void;
        recordReadiness(input: Record<string, unknown>): void;
      };
      snapshot: () => readonly unknown[];
    };
    createGlobalFoundationMetrics: () => {
      recordJobExecution(input: Record<string, unknown>): void;
      recordJobQueueDelay(input: Record<string, unknown>): void;
      recordReadiness(input: Record<string, unknown>): void;
    };
  };
  const recorder = observability.createInMemoryFoundationMetrics();
  recorder.metrics.recordJobExecution({
    jobType: "foundation-health.v1",
    outcome: "succeeded",
    durationSeconds: 0.25,
    correlationId: "unbounded-correlation",
  });
  recorder.metrics.recordJobQueueDelay({
    jobType: "foundation-health.v1",
    durationSeconds: 0.5,
    jobId: "unbounded-job",
  });
  recorder.metrics.recordReadiness({
    dependency: "jobs",
    outcome: "ready",
    endpoint: "https://seeded-secret.invalid",
  });

  expect(recorder.snapshot()).toEqual([
    {
      name: "muster.job.executions",
      unit: "{job}",
      value: 1,
      attributes: { jobType: "foundation-health.v1", outcome: "succeeded" },
    },
    {
      name: "muster.job.duration",
      unit: "s",
      value: 0.25,
      attributes: { jobType: "foundation-health.v1", outcome: "succeeded" },
    },
    {
      name: "muster.job.queue.delay",
      unit: "s",
      value: 0.5,
      attributes: { jobType: "foundation-health.v1" },
    },
    {
      name: "muster.readiness",
      unit: "1",
      value: 1,
      attributes: { dependency: "jobs" },
    },
  ]);
  const serialized = JSON.stringify(recorder.snapshot());
  expect(serialized).not.toMatch(
    /correlation|traceId|spanId|jobId|idempotency|organization|user|url|hostname|endpoint|seeded-secret/iu,
  );
  expect(() =>
    recorder.metrics.recordReadiness({ dependency: "unbounded", outcome: "ready" }),
  ).toThrow("Invalid bounded readiness metric");
  expect(observability.createGlobalFoundationMetrics()).toMatchObject({
    recordJobExecution: expect.any(Function),
    recordJobQueueDelay: expect.any(Function),
    recordReadiness: expect.any(Function),
  });
});
