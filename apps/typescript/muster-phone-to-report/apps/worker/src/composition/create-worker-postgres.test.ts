import { describe, expect, it } from "vitest";

import {
  createWorkerPostgresBinding,
  parseWorkerPostgresConfig,
} from "./create-worker-postgres.js";

describe("createWorkerPostgresBinding", () => {
  it("rejects missing or unsafe DATABASE_URL values before constructing a pool", () => {
    for (const connectionString of ["", "   ", "not-a-url", "mysql://db.example/muster"]) {
      expect(() => createWorkerPostgresBinding(connectionString)).toThrow(
        "Invalid PostgreSQL configuration: DATABASE_URL",
      );
    }
  });

  it("requires explicit production pool and deadline capacity", () => {
    const production = {
      RUNTIME_PROFILE: "production",
      DATABASE_URL: "postgresql://worker:secret@localhost:5432/muster",
      WORKER_DB_POOL_MAX: "3",
      WORKER_DB_CONNECTION_TIMEOUT_MS: "2000",
      WORKER_DB_PROBE_TIMEOUT_MS: "500",
    };
    expect(() => parseWorkerPostgresConfig(production)).not.toThrow();
    for (const key of [
      "WORKER_DB_POOL_MAX",
      "WORKER_DB_CONNECTION_TIMEOUT_MS",
      "WORKER_DB_PROBE_TIMEOUT_MS",
    ] as const) {
      const incomplete: Record<string, string | undefined> = { ...production };
      delete incomplete[key];
      expect(() => parseWorkerPostgresConfig(incomplete)).toThrow(
        `Invalid worker PostgreSQL configuration: ${key}`,
      );
    }
  });
});
