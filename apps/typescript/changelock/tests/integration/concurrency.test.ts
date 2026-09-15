import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DbClient } from "../../src/infrastructure/db";
import { openDatabase } from "../../src/infrastructure/db";
import { seedFixtures, SEED_EVENTS, SEED_VENDORS } from "../../src/fixtures/seed-data";
import { importChangeRequest } from "../../src/application/import-change-request";
import { createPreview } from "../../src/application/create-preview";
import { authorizeIntent } from "../../src/application/authorize-intent";
import { dispatchCall } from "../../src/application/dispatch-call";
import { resetSyntheticCase } from "../../src/application/reset-synthetic-case";

let dir: string;
let dbPath: string;
let clients: DbClient[];

function open() {
  return openDatabase(dbPath);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "changelock-conc-"));
  dbPath = join(dir, "test.db").replace(/\\/g, "/");
  clients = [];
});

afterEach(async () => {
  for (const c of clients) c.close();
  clients = [];
  // Windows holds libsql WAL/shm mappings past close(); attempt removal of the
  // temp dir we created but never fail the test on cleanup — OS temp collection
  // picks up the rest.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  } catch {
    // best-effort cleanup
  }
});

async function track(): Promise<DbClient> {
  const c = await open();
  clients.push(c);
  return c;
}

const EVENT = {
  externalEventId: "evt-conc-1",
  vendorCode: "V-1001",
  requestedAt: "2026-09-10T09:00:00Z",
  sourceSystem: "erp_demo",
  sourceReference: "VMD-1",
  requestContactName: "Request Author",
  requestContactPhone: "+13125550199",
  newDestinationLabel: "bank account ending 4410",
};

describe("concurrent initialization on a shared database file", () => {
  it("two clients seeding concurrently both succeed with exactly 3 vendors/3 contacts", async () => {
    const a = await track();
    const b = await track();
    await Promise.all([seedFixtures(a), seedFixtures(b)]);

    const vendors = await a.execute("SELECT COUNT(*) c FROM vendors");
    const contacts = await a.execute("SELECT COUNT(*) c FROM trusted_contacts");
    expect(vendors.rows[0].c).toBe(3);
    expect(contacts.rows[0].c).toBe(3);
  });

  it("repairs a deliberately partial seed", async () => {
    const a = await track();
    await a.execute({
      sql: "INSERT INTO vendors (id, display_name, vendor_code, status) VALUES (?,?,?,?)",
      args: [SEED_VENDORS[0].id, SEED_VENDORS[0].displayName, SEED_VENDORS[0].vendorCode, "active"],
    });
    const b = await track();
    await Promise.all([seedFixtures(a), seedFixtures(b)]);

    const vendors = await a.execute("SELECT COUNT(*) c FROM vendors");
    const contacts = await a.execute("SELECT COUNT(*) c FROM trusted_contacts");
    expect(vendors.rows[0].c).toBe(3);
    expect(contacts.rows[0].c).toBe(3);
  });

  it("concurrent identical imports produce one request, one case, one audit chain", async () => {
    const a = await track();
    await seedFixtures(a);
    const b = await track();
    await seedFixtures(b);

    const [ra, rb] = await Promise.all([
      importChangeRequest(a, EVENT),
      importChangeRequest(b, EVENT),
    ]);

    expect(ra.changeRequest.id).toBe(rb.changeRequest.id);
    expect(ra.verificationCase.id).toBe(rb.verificationCase.id);
    expect([ra.duplicate, rb.duplicate].sort()).toEqual([false, true]);

    const requests = await a.execute({
      sql: "SELECT COUNT(*) c FROM change_requests WHERE external_event_id = ?",
      args: [EVENT.externalEventId],
    });
    const cases = await a.execute({
      sql: `SELECT COUNT(*) c FROM verification_cases vc
            JOIN change_requests cr ON cr.id = vc.change_request_id
            WHERE cr.external_event_id = ?`,
      args: [EVENT.externalEventId],
    });
    const audits = await a.execute({
      sql: `SELECT type, previous_hash FROM audit_events WHERE case_id = ? ORDER BY rowid`,
      args: [ra.verificationCase.id],
    });
    expect(requests.rows[0].c).toBe(1);
    expect(cases.rows[0].c).toBe(1);
    expect(audits.rows.length).toBe(2);
    expect(audits.rows[0].previous_hash).toBeNull();
    expect(audits.rows[0].type).toBe("change_request.imported");
    expect(audits.rows[1].type).toBe("case.created");
    expect(audits.rows[1].previous_hash).toBeTruthy();
  });

  it("concurrent seed+import cold-start race (getDb shape) resolves cleanly", async () => {
    const init = async () => {
      const c = await track();
      await seedFixtures(c);
      for (const e of SEED_EVENTS) {
        await importChangeRequest(c, {
          externalEventId: e.externalEventId,
          vendorCode: e.vendorCode,
          requestedAt: e.requestedAt,
          sourceSystem: e.sourceSystem,
          sourceReference: e.sourceReference,
          requestContactName: e.requestContactName,
          requestContactPhone: e.requestContactPhone,
          newDestinationLabel: e.newDestinationLabel,
        });
      }
      return c;
    };
    const [a, b] = await Promise.all([init(), init()]);

    const requests = await a.execute("SELECT COUNT(*) c FROM change_requests");
    const cases = await a.execute("SELECT COUNT(*) c FROM verification_cases");
    expect(requests.rows[0].c).toBe(4);
    expect(cases.rows[0].c).toBe(4);
    expect(a).not.toBe(b);
  });

  it("concurrent resets of the same terminal case: exactly one wins, one demo.reset", async () => {
    const a = await track();
    await seedFixtures(a);
    const e = SEED_EVENTS[0];
    const { verificationCase } = await importChangeRequest(a, {
      externalEventId: e.externalEventId,
      vendorCode: e.vendorCode,
      requestedAt: e.requestedAt,
      sourceSystem: e.sourceSystem,
      sourceReference: e.sourceReference,
      requestContactName: e.requestContactName,
      requestContactPhone: e.requestContactPhone,
      newDestinationLabel: e.newDestinationLabel,
    });
    const b = await track();

    // Drive the case to a terminal state on client a.
    const preview = await createPreview(a, verificationCase.id);
    const intent = await authorizeIntent(a, {
      caseId: verificationCase.id,
      typedPhrase: `VERIFY ${verificationCase.safeCaseCode}`,
      attestedConsentingContact: true,
      preview,
    });
    await dispatchCall(a, { intentId: intent.id, scenario: "denied" });

    const results = await Promise.allSettled([
      resetSyntheticCase(a, { caseId: verificationCase.id }),
      resetSyntheticCase(b, { caseId: verificationCase.id }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(
      /cannot reset in state needs_review/,
    );

    const audits = await a.execute({
      sql: "SELECT type FROM audit_events WHERE case_id = ? ORDER BY rowid",
      args: [verificationCase.id],
    });
    expect(audits.rows.map((r) => r.type)).toEqual(["demo.reset"]);
  });
});
