import { describe, expect, it } from "vitest";

import { parseJobRuntimeConfig } from "./job-runtime-config.js";

describe("job runtime configuration", () => {
  it("requires every production capacity and deadline instead of inheriting demo defaults", () => {
    const base = {
      RUNTIME_PROFILE: "production",
      JOB_CONCURRENCY: "4",
      JOB_BACKLOG_LIMIT: "500",
      JOB_RETRY_LIMIT: "2",
      JOB_RETRY_DELAY_SECONDS: "1",
      JOB_WORK_TIMEOUT_SECONDS: "30",
      JOB_SHUTDOWN_TIMEOUT_MS: "30000",
      JOB_ENQUEUE_TIMEOUT_MS: "2000",
      JOB_READINESS_TIMEOUT_MS: "500",
    };

    expect(() => parseJobRuntimeConfig(base)).toThrow(/PG_BOSS_POOL_MAX/u);
    expect(() => parseJobRuntimeConfig({ ...base, PG_BOSS_POOL_MAX: "5" })).not.toThrow();
  });

  it("rejects out-of-range production bounds without including their values", () => {
    expect(() =>
      parseJobRuntimeConfig({
        RUNTIME_PROFILE: "production",
        PG_BOSS_POOL_MAX: "999-secret",
        JOB_CONCURRENCY: "4",
        JOB_BACKLOG_LIMIT: "500",
        JOB_RETRY_LIMIT: "2",
        JOB_RETRY_DELAY_SECONDS: "1",
        JOB_WORK_TIMEOUT_SECONDS: "30",
        JOB_SHUTDOWN_TIMEOUT_MS: "30000",
        JOB_ENQUEUE_TIMEOUT_MS: "2000",
        JOB_READINESS_TIMEOUT_MS: "500",
      }),
    ).toThrow(/^Invalid job configuration: PG_BOSS_POOL_MAX$/u);
  });

  it("bounds observation worker concurrency separately while sharing one runtime", () => {
    const config = parseJobRuntimeConfig({
      RUNTIME_PROFILE: "test",
      JOB_CONCURRENCY: "3",
      OBSERVATION_JOB_CONCURRENCY: "2",
    });

    expect(config).toMatchObject({ concurrency: 3, observationConcurrency: 2 });
    expect(() =>
      parseJobRuntimeConfig({
        RUNTIME_PROFILE: "test",
        OBSERVATION_JOB_CONCURRENCY: "33",
      }),
    ).toThrow(/^Invalid job configuration: OBSERVATION_JOB_CONCURRENCY$/u);
  });
});
