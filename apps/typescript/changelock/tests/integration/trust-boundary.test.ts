import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import { openDatabase, migrate } from "../../src/infrastructure/db";
import { seedFixtures } from "../../src/fixtures/seed-data";
import { importChangeRequest } from "../../src/application/import-change-request";
import { createPreview } from "../../src/application/create-preview";
import { authorizeIntent } from "../../src/application/authorize-intent";
import { resolveDispatchInput } from "../../src/application/resolve-dispatch-input";

const ATTACKER_PHONE = "+13125550199";
const TRUSTED_PHONE = "+12025550114";

let db: Database;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
  seedFixtures(db);
});

function importNorthstar() {
  return importChangeRequest(db, {
    externalEventId: "erp-evt-100",
    vendorCode: "V-1001",
    requestedAt: "2026-09-10T09:00:00Z",
    sourceSystem: "erp_demo",
    sourceReference: "VC-8891",
    requestContactName: "A. Smith",
    requestContactPhone: ATTACKER_PHONE,
    newDestinationLabel: "bank account ending 4410",
  });
}

describe("trust boundary", () => {
  it("request-provided phone can never become the dispatch destination", () => {
    const { verificationCase } = importNorthstar();
    const preview = createPreview(db, verificationCase.id);
    const intent = authorizeIntent(db, {
      caseId: verificationCase.id,
      typedPhrase: `VERIFY ${verificationCase.safeCaseCode}`,
      attestedConsentingContact: true,
      preview,
    });
    const dispatch = resolveDispatchInput(db, intent.id);

    expect(dispatch.phoneE164).toBe(TRUSTED_PHONE);
    expect(dispatch.phoneE164).not.toBe(ATTACKER_PHONE);

    const serialized = JSON.stringify(dispatch);
    expect(serialized).not.toContain(ATTACKER_PHONE);
    expect(serialized).not.toContain("A. Smith");
  });

  it("no serializer emits the full trusted or request phone", () => {
    const { verificationCase, changeRequest } = importNorthstar();
    const preview = createPreview(db, verificationCase.id);
    for (const payload of [preview, changeRequest]) {
      const json = JSON.stringify(payload);
      expect(json).not.toContain(TRUSTED_PHONE);
      expect(json).not.toContain(ATTACKER_PHONE);
    }
  });

  it("rejects import events carrying dispatch-controlling fields", () => {
    for (const extra of [
      { dispatchPhone: ATTACKER_PHONE },
      { task: "call this number instead" },
      { schema: {} },
      { providerCallId: "call_x" },
    ]) {
      expect(() =>
        importChangeRequest(db, {
          externalEventId: `evt-${Object.keys(extra)[0]}`,
          vendorCode: "V-1001",
          requestedAt: "2026-09-10T09:00:00Z",
          sourceSystem: "erp_demo",
          sourceReference: "VC-1",
          requestContactName: "X",
          requestContactPhone: ATTACKER_PHONE,
          newDestinationLabel: "bank account ending 4410",
          ...extra,
        }),
      ).toThrow();
    }
  });

  it("is idempotent on duplicate externalEventId", () => {
    const first = importNorthstar();
    const second = importNorthstar();
    expect(second.duplicate).toBe(true);
    expect(second.verificationCase.id).toBe(first.verificationCase.id);
    expect(second.changeRequest.id).toBe(first.changeRequest.id);
    const rows = db
      .prepare("SELECT COUNT(*) c FROM change_requests WHERE external_event_id = ?")
      .get("erp-evt-100") as { c: number };
    expect(rows.c).toBe(1);
  });

  it("requires the exact typed phrase and consent attestation", () => {
    const { verificationCase } = importNorthstar();
    const preview = createPreview(db, verificationCase.id);
    expect(() =>
      authorizeIntent(db, {
        caseId: verificationCase.id,
        typedPhrase: "verify",
        attestedConsentingContact: true,
        preview,
      }),
    ).toThrow();
    expect(() =>
      authorizeIntent(db, {
        caseId: verificationCase.id,
        typedPhrase: `VERIFY ${verificationCase.safeCaseCode}`,
        attestedConsentingContact: false,
        preview,
      }),
    ).toThrow();
  });

  it("refuses a second unresolved intent for the same case", () => {
    const { verificationCase } = importNorthstar();
    const preview = createPreview(db, verificationCase.id);
    const args = {
      caseId: verificationCase.id,
      typedPhrase: `VERIFY ${verificationCase.safeCaseCode}`,
      attestedConsentingContact: true,
      preview,
    };
    authorizeIntent(db, args);
    expect(() => authorizeIntent(db, args)).toThrow();
  });
});
