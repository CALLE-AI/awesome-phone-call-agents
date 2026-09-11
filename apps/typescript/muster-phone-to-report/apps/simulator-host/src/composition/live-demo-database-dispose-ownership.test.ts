import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("live-demo database dispose ownership composition", () => {
  it("binds destructive database operations only through the PostgreSQL package-root adapter", async () => {
    const infrastructure = await import("@muster/infrastructure-postgres");
    const composition = await import("./live-demo-database-dispose-ownership.js");
    const cliSource = readFileSync(
      new URL("../cli/live-demo-database-dispose.ts", import.meta.url),
      "utf8",
    );

    expect(composition.liveDemoDatabaseDisposeOwnershipCapabilities).toEqual({
      createDisposablePostgresOwner: infrastructure.createDisposablePostgresOwner,
    });
    expect(cliSource).not.toContain("@muster/infrastructure-postgres");
    expect(cliSource).not.toMatch(/\b(?:Pool|PrismaClient)\b/u);
  });
});
