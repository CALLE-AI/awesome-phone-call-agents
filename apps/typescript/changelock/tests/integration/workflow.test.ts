import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/infrastructure/db";
import { openDatabase } from "../../src/infrastructure/db";
import { seedFixtures } from "../../src/fixtures/seed-data";
import { importChangeRequest } from "../../src/application/import-change-request";
import { createPreview } from "../../src/application/create-preview";
import { authorizeIntent } from "../../src/application/authorize-intent";
import { recordCallOutcome } from "../../src/application/record-call-outcome";
import { loadCallResultFixture } from "../../src/fixtures/call-results";

let db: DbClient;

beforeEach(async () => {
  db = await openDatabase(":memory:");
  await seedFixtures(db);
});

afterEach(() => {
  db.close();
});

async function setupCase(externalEventId: string, vendorCode: string) {
  const { verificationCase } = await importChangeRequest(db, {
    externalEventId,
    vendorCode,
    requestedAt: "2026-09-10T09:00:00Z",
    sourceSystem: "erp_demo",
    sourceReference: `REF-${externalEventId}`,
    requestContactName: "Request Author",
    requestContactPhone: "+13125550199",
    newDestinationLabel: "bank account ending 4410",
  });
  const preview = await createPreview(db, verificationCase.id);
  const intent = await authorizeIntent(db, {
    caseId: verificationCase.id,
    typedPhrase: `VERIFY ${verificationCase.safeCaseCode}`,
    attestedConsentingContact: true,
    preview,
  });
  return { verificationCase, intent };
}

async function getRequest(id: string) {
  const rs = await db.execute({ sql: "SELECT * FROM change_requests WHERE id = ?", args: [id] });
  return rs.rows[0] as unknown as { status: string };
}

describe("workflow: import -> preview -> authorize -> outcome", () => {
  it("confirmed call yields verification_confirmed and the change stays held", async () => {
    const { verificationCase, intent } = await setupCase("evt-confirmed", "V-1001");
    const snapshot = loadCallResultFixture("confirmed", intent);
    const outcome = await recordCallOutcome(db, intent.id, snapshot);

    expect(outcome.disposition).toBe("confirmed");
    const rs = await db.execute({
      sql: "SELECT state FROM verification_cases WHERE id = ?",
      args: [verificationCase.id],
    });
    expect(rs.rows[0].state).toBe("verification_confirmed");

    const req = await getRequest(verificationCase.changeRequestId);
    expect(req.status).toBe("held");
  });

  it("denied call yields verification_denied and the change stays held", async () => {
    const { verificationCase, intent } = await setupCase("evt-denied", "V-1002");
    const snapshot = loadCallResultFixture("denied", intent);
    const outcome = await recordCallOutcome(db, intent.id, snapshot);

    expect(outcome.disposition).toBe("denied");
    const rs = await db.execute({
      sql: "SELECT state FROM verification_cases WHERE id = ?",
      args: [verificationCase.id],
    });
    expect(rs.rows[0].state).toBe("verification_denied");
    expect((await getRequest(verificationCase.changeRequestId)).status).toBe("held");
  });

  it("unable_to_verify stays a distinct non-answer", async () => {
    const { verificationCase, intent } = await setupCase("evt-utv", "V-1003");
    const snapshot = loadCallResultFixture("unable-to-verify", intent);
    const outcome = await recordCallOutcome(db, intent.id, snapshot);
    expect(outcome.disposition).toBe("unable_to_verify");
    expect((await getRequest(verificationCase.changeRequestId)).status).toBe("held");
  });

  it("unreachable provider result is not coerced to denial", async () => {
    const { verificationCase, intent } = await setupCase("evt-unreach", "V-1001");
    const snapshot = loadCallResultFixture("unreachable", intent);
    const outcome = await recordCallOutcome(db, intent.id, snapshot);
    expect(outcome.disposition).toBe("unreachable");
    const rs = await db.execute({
      sql: "SELECT state FROM verification_cases WHERE id = ?",
      args: [verificationCase.id],
    });
    expect(rs.rows[0].state).toBe("needs_human");
    expect((await getRequest(verificationCase.changeRequestId)).status).toBe("held");
  });

  it("sensitive-data fixture can never confirm", async () => {
    const { intent } = await setupCase("evt-sens", "V-1001");
    const snapshot = loadCallResultFixture("sensitive-data", intent);
    const outcome = await recordCallOutcome(db, intent.id, snapshot);
    expect(outcome.disposition).toBe("sensitive_data");
    const persisted = await db.execute({
      sql: "SELECT * FROM call_snapshots WHERE intent_id = ?",
      args: [intent.id],
    });
    expect(persisted.rows[0].evidence_json).not.toContain("987654321");
  });

  it("writes a hash-chained audit trail", async () => {
    const { verificationCase, intent } = await setupCase("evt-audit", "V-1001");
    await recordCallOutcome(db, intent.id, loadCallResultFixture("confirmed", intent));
    const rs = await db.execute({
      sql: "SELECT * FROM audit_events WHERE case_id = ? ORDER BY created_at, id",
      args: [verificationCase.id],
    });
    const events = rs.rows as unknown as { previous_hash: string | null; event_hash: string }[];
    expect(events.length).toBeGreaterThan(3);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].previous_hash).toBe(events[i - 1].event_hash);
    }
    for (const e of events) {
      expect(JSON.stringify(e)).not.toContain("+12025550114");
      expect(JSON.stringify(e)).not.toContain("+13125550199");
    }
  });
});
