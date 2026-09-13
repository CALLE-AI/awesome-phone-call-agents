import { describe, expect, it } from "vitest";

import {
  localDatabaseUrl,
  resolveDatabaseUrl,
} from "@/config/database-url";

describe("database URL resolution", () => {
  it("uses the safe local URL when configuration is missing or blank", () => {
    expect(resolveDatabaseUrl(undefined)).toBe(localDatabaseUrl);
    expect(resolveDatabaseUrl("")).toBe(localDatabaseUrl);
    expect(resolveDatabaseUrl("   ")).toBe(localDatabaseUrl);
  });

  it("preserves a configured PostgreSQL URL after trimming whitespace", () => {
    expect(
      resolveDatabaseUrl(
        "  postgresql://fieldclose:fieldclose@database.example/fieldclose  ",
      ),
    ).toBe(
      "postgresql://fieldclose:fieldclose@database.example/fieldclose",
    );
  });

  it("requires certificate-verified TLS for a remote production database", () => {
    expect(() =>
      resolveDatabaseUrl(
        "postgresql://fieldclose:password@database.example/fieldclose",
        "production",
      ),
    ).toThrow(/sslmode=verify-full/);

    expect(() =>
      resolveDatabaseUrl(
        "postgresql://fieldclose:password@database.example/fieldclose?sslmode=require",
        "production",
      ),
    ).toThrow(/sslmode=verify-full/);

    expect(() =>
      resolveDatabaseUrl(
        "postgresql://fieldclose:password@database.example/fieldclose?sslmode=verify-full&sslmode=disable",
        "production",
      ),
    ).toThrow(/sslmode=verify-full/);

    expect(
      resolveDatabaseUrl(
        "postgresql://fieldclose:password@database.example/fieldclose?sslmode=verify-full",
        "production",
      ),
    ).toBe(
      "postgresql://fieldclose:password@database.example/fieldclose?sslmode=verify-full",
    );
  });

  it("allows a production loopback database without TLS", () => {
    expect(
      resolveDatabaseUrl(
        "postgresql://fieldclose:password@127.0.0.2:5432/fieldclose",
        "production",
      ),
    ).toBe(
      "postgresql://fieldclose:password@127.0.0.2:5432/fieldclose",
    );

    expect(
      resolveDatabaseUrl(
        "postgresql://fieldclose:password@[::1]:5432/fieldclose",
        "production",
      ),
    ).toBe(
      "postgresql://fieldclose:password@[::1]:5432/fieldclose",
    );
  });
});
