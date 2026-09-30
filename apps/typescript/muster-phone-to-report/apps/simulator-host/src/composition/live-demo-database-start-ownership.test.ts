import { describe, expect, it } from "vitest";

describe("live-demo database start ownership composition", () => {
  it("binds the CLI capability to the existing PostgreSQL package-root ownership adapter", async () => {
    const infrastructure = await import("@muster/infrastructure-postgres");
    const composition = await import("./live-demo-database-start-ownership.js");

    expect(composition.liveDemoDatabaseStartOwnershipCapabilities).toEqual({
      provisionExclusiveDisposablePostgresDatabaseOwnership:
        infrastructure.provisionExclusiveDisposablePostgresDatabaseOwnership,
      createDisposablePostgresOwner: infrastructure.createDisposablePostgresOwner,
    });
  });
});
