import { describe, expect, it } from "vitest";

import { createApiPostgresBinding } from "./create-api-postgres.js";

describe("createApiPostgresBinding", () => {
  it("rejects missing or unsafe DATABASE_URL values before constructing a pool", () => {
    for (const connectionString of ["", "   ", "not-a-url", "mysql://db.example/muster"]) {
      expect(() => createApiPostgresBinding(connectionString)).toThrow(
        "Invalid PostgreSQL configuration: DATABASE_URL",
      );
    }
  });
});
