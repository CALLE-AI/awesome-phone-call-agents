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
});
