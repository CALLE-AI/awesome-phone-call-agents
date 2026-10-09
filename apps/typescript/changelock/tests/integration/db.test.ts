import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/infrastructure/db";
import {
  createDbClient,
  getVendorByCode,
  insertVendor,
  migrate,
  newId,
  now,
  openDatabase,
  withTransaction,
} from "../../src/infrastructure/db";

let db: DbClient | null = null;
const ORIGINAL = {
  url: process.env.TURSO_DATABASE_URL,
  token: process.env.TURSO_AUTH_TOKEN,
};

beforeEach(() => {
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
});

afterEach(() => {
  db?.close();
  db = null;
  if (ORIGINAL.url === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env["TURSO_DATABASE_URL"] = ORIGINAL.url;
  if (ORIGINAL.token === undefined) delete process.env.TURSO_AUTH_TOKEN;
  else process.env["TURSO_AUTH_TOKEN"] = ORIGINAL.token;
});

describe("openDatabase", () => {
  it("opens an isolated in-memory client and applies migrations", async () => {
    db = await openDatabase(":memory:");
    const rs = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='verification_cases'",
    );
    expect(rs.rows.length).toBe(1);
  });

  it("requires TURSO_AUTH_TOKEN when TURSO_DATABASE_URL is set", async () => {
    process.env["TURSO_DATABASE_URL"] = "libsql://example.turso.io";
    delete process.env.TURSO_AUTH_TOKEN;
    await expect(openDatabase()).rejects.toThrow(/TURSO_AUTH_TOKEN/);
  });

  it("selects the serverless driver for remote Turso without a network request", async () => {
    process.env["TURSO_DATABASE_URL"] = "libsql://example.turso.io";
    process.env["TURSO_AUTH_TOKEN"] = "test-token-not-a-secret";
    const remote = await createDbClient();
    db = remote;
    expect(remote.protocol).toBe("http");
    expect(remote.closed).toBe(false);
    expect(typeof remote.transaction).toBe("function");
    expect(typeof remote.batch).toBe("function");
  });

  it("an explicit local path still selects the local driver when Turso env exists", async () => {
    process.env["TURSO_DATABASE_URL"] = "libsql://example.turso.io";
    process.env["TURSO_AUTH_TOKEN"] = "test-token-not-a-secret";
    db = await openDatabase(":memory:");
    expect(db.protocol).toBe("file");
    // local driver actually executes — proves it is the real local client
    const rs = await db.execute("SELECT 1 AS ok");
    expect(rs.rows[0].ok).toBe(1);
  });

  it("migrations are idempotent", async () => {
    db = await openDatabase(":memory:");
    await migrate(db);
    await migrate(db);
    const rs = await db.execute(
      "SELECT COUNT(*) c FROM sqlite_master WHERE type='table'",
    );
    expect(rs.rows[0].c).toBe(7);
  });
});

describe("withTransaction", () => {
  it("rolls back every write when the inner scope throws", async () => {
    db = await openDatabase(":memory:");
    await expect(
      withTransaction(db, async (tx) => {
        await insertVendor(tx, {
          id: newId("ven"),
          displayName: "Tx Vendor",
          vendorCode: "V-TX",
          status: "active",
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await getVendorByCode(db, "V-TX")).toBeNull();
  });

  it("commits all writes on success", async () => {
    db = await openDatabase(":memory:");
    await withTransaction(db, async (tx) => {
      await insertVendor(tx, {
        id: newId("ven"),
        displayName: "Tx Vendor",
        vendorCode: "V-TX2",
        status: "active",
      });
    });
    expect((await getVendorByCode(db, "V-TX2"))!.displayName).toBe("Tx Vendor");
  });
});

describe("row narrowing", () => {
  it("rejects a malformed row instead of casting it", async () => {
    db = await openDatabase(":memory:");
    await db.execute({
      sql: "INSERT INTO vendors (id, display_name, vendor_code, status) VALUES (?, x'0102', ?, ?)",
      args: [newId("ven"), "V-BAD", "active"],
    });
    await expect(getVendorByCode(db, "V-BAD")).rejects.toThrow(/malformed/);
  });
});

describe("integrity invariants", () => {
  it("enforces unique vendor codes and held-only change request status", async () => {
    db = await openDatabase(":memory:");
    const v = { id: newId("ven"), displayName: "Dup", vendorCode: "V-DUP", status: "active" as const };
    await insertVendor(db, v);
    await expect(insertVendor(db, { ...v, id: newId("ven") })).rejects.toThrow();
    await expect(
      db.execute({
        sql: `INSERT INTO change_requests
          (id, external_event_id, vendor_id, requested_at, source_system, source_reference,
           request_contact_name, request_contact_phone_masked, new_destination_label,
           change_fingerprint, status)
          VALUES (?,?,?,?,?,?,?,?,?,?,'released')`,
        args: [
          newId("cr"), "evt-x", v.id, now(), "erp_demo", "REF-1",
          "Name", "+1••••••0199", "acct", "fp",
        ],
      }),
    ).rejects.toThrow();
  });
});
