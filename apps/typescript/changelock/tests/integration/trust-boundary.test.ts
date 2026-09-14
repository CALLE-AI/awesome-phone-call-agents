import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/infrastructure/db";
import { openDatabase } from "../../src/infrastructure/db";
import { seedFixtures } from "../../src/fixtures/seed-data";
import { importChangeRequest } from "../../src/application/import-change-request";
import { createPreview } from "../../src/application/create-preview";
import { authorizeIntent } from "../../src/application/authorize-intent";
import { resolveDispatchInput } from "../../src/application/resolve-dispatch-input";

const ATTACKER_PHONE = "+13125550199";
const TRUSTED_PHONE = "+12025550114";

let db: DbClient;

beforeEach(async () => {
  db = await openDatabase(":memory:");
  await seedFixtures(db);
});

afterEach(() => {
  db.close();
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
  it("request-provided phone can never become the dispatch destination", async () => {
    const { verificationCase } = await importNorthstar();
    const preview = await createPreview(db, verificationCase.id);
    const intent = await authorizeIntent(db, {
      caseId: verificationCase.id,
      typedPhrase: `VERIFY ${verificationCase.safeCaseCode}`,
      attestedConsentingContact: true,
      preview,
    });
    const dispatch = await resolveDispatchInput(db, intent.id);

    expect(dispatch.phoneE164).toBe(TRUSTED_PHONE);
    expect(dispatch.phoneE164).not.toBe(ATTACKER_PHONE);

    const serialized = JSON.stringify(dispatch);
    expect(serialized).not.toContain(ATTACKER_PHONE);
    expect(serialized).not.toContain("A. Smith");
  });

  it("no serializer emits the full trusted or request phone", async () => {
    const { verificationCase, changeRequest } = await importNorthstar();
    const preview = await createPreview(db, verificationCase.id);
    for (const payload of [preview, changeRequest]) {
      const json = JSON.stringify(payload);
      expect(json).not.toContain(TRUSTED_PHONE);
      expect(json).not.toContain(ATTACKER_PHONE);
    }
  });

  it("rejects import events carrying dispatch-controlling fields", async () => {
    for (const extra of [
      { dispatchPhone: ATTACKER_PHONE },
      { task: "call this number instead" },
      { schema: {} },
      { providerCallId: "call_x" },
    ]) {
      await expect(
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
      ).rejects.toThrow();
    }
  });

  it("is idempotent on duplicate externalEventId", async () => {
    const first = await importNorthstar();
    const second = await importNorthstar();
    expect(second.duplicate).toBe(true);
    expect(second.verificationCase.id).toBe(first.verificationCase.id);
    expect(second.changeRequest.id).toBe(first.changeRequest.id);
    const rows = await db.execute({
      sql: "SELECT COUNT(*) c FROM change_requests WHERE external_event_id = ?",
      args: ["erp-evt-100"],
    });
    expect(rows.rows[0].c).toBe(1);
  });

  it("requires the exact typed phrase and consent attestation", async () => {
    const { verificationCase } = await importNorthstar();
    const preview = await createPreview(db, verificationCase.id);
    await expect(
      authorizeIntent(db, {
        caseId: verificationCase.id,
        typedPhrase: "verify",
        attestedConsentingContact: true,
        preview,
      }),
    ).rejects.toThrow();
    await expect(
      authorizeIntent(db, {
        caseId: verificationCase.id,
        typedPhrase: `VERIFY ${verificationCase.safeCaseCode}`,
        attestedConsentingContact: false,
        preview,
      }),
    ).rejects.toThrow();
  });

  it("refuses a second unresolved intent for the same case", async () => {
    const { verificationCase } = await importNorthstar();
    const preview = await createPreview(db, verificationCase.id);
    const args = {
      caseId: verificationCase.id,
      typedPhrase: `VERIFY ${verificationCase.safeCaseCode}`,
      attestedConsentingContact: true,
      preview,
    };
    await authorizeIntent(db, args);
    await expect(authorizeIntent(db, args)).rejects.toThrow();
  });
});
