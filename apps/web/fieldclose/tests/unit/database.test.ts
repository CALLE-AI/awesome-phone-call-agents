import { describe, expect, it } from "vitest";

import { createDatabase } from "@/persistence/database";

describe("database client TLS", () => {
  it("uses certificate-verified TLS for a remote database", async () => {
    const { client } = createDatabase(
      "postgresql://fieldclose:password@database.example/fieldclose",
    );

    expect(client.options.ssl).toBe("verify-full");
    await client.end({ timeout: 0 });
  });

  it("does not require TLS for a loopback database", async () => {
    const { client } = createDatabase(
      "postgresql://fieldclose:password@127.0.0.1:5432/fieldclose",
    );

    expect(client.options.ssl).toBe(false);
    await client.end({ timeout: 0 });
  });
});
