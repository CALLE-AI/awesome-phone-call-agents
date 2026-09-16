import { describe, expect, it, vi } from "vitest";

import type { DatabaseHealthPort, JobBackendHealthPort } from "../index.js";

describe("GetSystemHealth", () => {
  // Test strategy: verify application-owned aggregation and its fail-closed public mapping.
  // HTTP status codes, probe timeout adapters, scheduling, and vendor readiness APIs are
  // deliberately deferred to later phases.
  it("reports ready only when both required readiness ports report ready", async () => {
    const { GetSystemHealth } = await import("../index.js");
    const databaseHealth: DatabaseHealthPort = {
      getReadiness: vi.fn().mockResolvedValue("ready"),
    };
    const jobBackendHealth: JobBackendHealthPort = {
      getReadiness: vi.fn().mockResolvedValue("ready"),
    };

    const result = await new GetSystemHealth({ databaseHealth, jobBackendHealth }).execute();

    expect(result).toEqual({ status: "ready" });
    expect(databaseHealth.getReadiness).toHaveBeenCalledOnce();
    expect(jobBackendHealth.getReadiness).toHaveBeenCalledOnce();
  });

  it("maps unknown, degraded, and failed dependency checks to the same low-detail degraded result", async () => {
    const { GetSystemHealth } = await import("../index.js");
    const scenarios: ReadonlyArray<{
      readonly database: DatabaseHealthPort;
      readonly jobs: JobBackendHealthPort;
    }> = [
      {
        database: { getReadiness: async () => "unknown" },
        jobs: { getReadiness: async () => "ready" },
      },
      {
        database: { getReadiness: async () => "ready" },
        jobs: { getReadiness: async () => "degraded" },
      },
      {
        database: {
          getReadiness: async () => {
            throw new Error("synthetic secret-bearing dependency detail");
          },
        },
        jobs: { getReadiness: async () => "ready" },
      },
    ];

    for (const { database, jobs } of scenarios) {
      const result = await new GetSystemHealth({
        databaseHealth: database,
        jobBackendHealth: jobs,
      }).execute();

      expect(result).toEqual({ status: "degraded" });
      expect(JSON.stringify(result)).not.toContain("synthetic");
      expect(Object.keys(result)).toEqual(["status"]);
    }
  });
});
