import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import { openDatabase, migrate } from "../../src/infrastructure/db";
import { seedFixtures } from "../../src/fixtures/seed-data";
import { importChangeRequest } from "../../src/application/import-change-request";
import { createPreview } from "../../src/application/create-preview";
import { authorizeIntent } from "../../src/application/authorize-intent";
import { recordCallOutcome } from "../../src/application/record-call-outcome";
import { loadCallResultFixture } from "../../src/fixtures/call-results";

let db: Database;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
  seedFixtures(db);
});

function setupCase(externalEventId: string, vendorCode: string) {
  const { verificationCase } = importChangeRequest(db, {
    externalEventId,
    vendorCode,
    requestedAt: "2026-09-10T09:00:00Z",
    sourceSystem: "erp_demo",
    sourceReference: `REF-${externalEventId}`,
    requestContactName: "Request Author",
    requestContactPhone: "+13125550199",
    newDestinationLabel: "bank account ending 4410",
  });
  const preview = createPreview(db, verificationCase.id);
  const intent = authorizeIntent(db, {
    caseId: verificationCase.id,
    typedPhrase: `VERIFY ${verificationCase.safeCaseCode}`,
    attestedConsentingContact: true,
    preview,
  });
  return { verificationCase, intent };
}

function getRequest(id: string) {
  return db.prepare("SELECT * FROM change_requests WHERE id = ?").get(id) as {
    status: string;
  };
}

describe("workflow: import -> preview -> authorize -> outcome", () => {
  it("confirmed call yields verification_confirmed and the change stays held", () => {
    const { verificationCase, intent } = setupCase("evt-confirmed", "V-1001");
    const snapshot = loadCallResultFixture("confirmed", intent);
    const outcome = recordCallOutcome(db, intent.id, snapshot);

    expect(outcome.disposition).toBe("confirmed");
    const c = db
      .prepare("SELECT state FROM verification_cases WHERE id = ?")
      .get(verificationCase.id) as { state: string };
    expect(c.state).toBe("verification_confirmed");

    const req = getRequest(verificationCase.changeRequestId);
    expect(req.status).toBe("held");
  });

  it("denied call yields verification_denied and the change stays held", () => {
    const { verificationCase, intent } = setupCase("evt-denied", "V-1002");
    const snapshot = loadCallResultFixture("denied", intent);
    const outcome = recordCallOutcome(db, intent.id, snapshot);

    expect(outcome.disposition).toBe("denied");
    const c = db
      .prepare("SELECT state FROM verification_cases WHERE id = ?")
      .get(verificationCase.id) as { state: string };
    expect(c.state).toBe("verification_denied");
    expect(getRequest(verificationCase.changeRequestId).status).toBe("held");
  });

  it("unable_to_verify stays a distinct non-answer", () => {
    const { verificationCase, intent } = setupCase("evt-utv", "V-1003");
    const snapshot = loadCallResultFixture("unable-to-verify", intent);
    const outcome = recordCallOutcome(db, intent.id, snapshot);
    expect(outcome.disposition).toBe("unable_to_verify");
    expect(getRequest(verificationCase.changeRequestId).status).toBe("held");
  });

  it("unreachable provider result is not coerced to denial", () => {
    const { verificationCase, intent } = setupCase("evt-unreach", "V-1001");
    const snapshot = loadCallResultFixture("unreachable", intent);
    const outcome = recordCallOutcome(db, intent.id, snapshot);
    expect(outcome.disposition).toBe("unreachable");
    const c = db
      .prepare("SELECT state FROM verification_cases WHERE id = ?")
      .get(verificationCase.id) as { state: string };
    expect(c.state).toBe("needs_human");
    expect(getRequest(verificationCase.changeRequestId).status).toBe("held");
  });

  it("sensitive-data fixture can never confirm", () => {
    const { intent } = setupCase("evt-sens", "V-1001");
    const snapshot = loadCallResultFixture("sensitive-data", intent);
    const outcome = recordCallOutcome(db, intent.id, snapshot);
    expect(outcome.disposition).toBe("sensitive_data");
    const persisted = db
      .prepare("SELECT * FROM call_snapshots WHERE intent_id = ?")
      .get(intent.id) as { evidence_json: string; structured_result_json: string };
    expect(persisted.evidence_json).not.toContain("987654321");
  });

  it("writes a hash-chained audit trail", () => {
    const { verificationCase, intent } = setupCase("evt-audit", "V-1001");
    recordCallOutcome(db, intent.id, loadCallResultFixture("confirmed", intent));
    const events = db
      .prepare("SELECT * FROM audit_events WHERE case_id = ? ORDER BY created_at, id")
      .all(verificationCase.id) as { previous_hash: string | null; event_hash: string }[];
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
