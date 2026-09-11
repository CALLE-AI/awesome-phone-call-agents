import { beforeEach, describe, expect, it, vi } from "vitest";

const stop = vi.fn(async () => undefined);
const exec = vi.fn(async () => {
  throw new Error("synthetic database setup failure");
});

vi.mock("@testcontainers/postgresql", () => ({
  PostgreSqlContainer: class {
    withUsername(): this {
      return this;
    }

    withPassword(): this {
      return this;
    }

    withDatabase(): this {
      return this;
    }

    withLabels(): this {
      return this;
    }

    withStartupTimeout(): this {
      return this;
    }

    async start() {
      return { exec, stop };
    }
  },
}));

const postgresTestContainer = await import("./postgres-test-container.js");

describe("PostgreSQL test target safety", () => {
  // Test strategy: prove migration helpers reject caller-selected targets and setup always
  // releases a container after post-start failure. Real PostgreSQL behavior remains covered by
  // the infrastructure integration suites; Docker internals and production targets are excluded.
  beforeEach(() => {
    stop.mockClear();
    exec.mockClear();
  });

  it("rejects an arbitrary database URL before invoking Prisma", async () => {
    await expect(
      postgresTestContainer.validatePrismaSchema(
        "postgresql://synthetic:synthetic@remote.example/muster_production",
      ),
    ).rejects.toThrow("PostgreSQL test target is not owned by this test run");
  });

  it("stops a started container when post-start database setup throws", async () => {
    await expect(postgresTestContainer.default()).rejects.toThrow(
      "Disposable PostgreSQL setup failed safely",
    );

    expect(stop).toHaveBeenCalledOnce();
  });
});
