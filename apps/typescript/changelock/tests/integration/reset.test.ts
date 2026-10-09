import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/infrastructure/db";
import { openDatabase, getCase, getIntent } from "../../src/infrastructure/db";
import { seedFixtures, SEED_EVENTS } from "../../src/fixtures/seed-data";
import { importChangeRequest } from "../../src/application/import-change-request";
import { createPreview } from "../../src/application/create-preview";
import { authorizeIntent } from "../../src/application/authorize-intent";
import { dispatchCall } from "../../src/application/dispatch-call";
import { escalateToHuman } from "../../src/application/escalate";
import { resetSyntheticCase } from "../../src/application/reset-synthetic-case";

let db: DbClient;
const ORIGINAL_MODE = process.env.CHANGELOCK_MODE;

beforeEach(async () => {
  db = await openDatabase(":memory:");
  await seedFixtures(db);
  process.env.CHANGELOCK_MODE = "replay";
});

afterEach(() => {
  db.close();
  if (ORIGINAL_MODE === undefined) delete process.env.CHANGELOCK_MODE;
  else process.env.CHANGELOCK_MODE = ORIGINAL_MODE;
});

async function importSeeded(eventIndex = 0) {
  const event = SEED_EVENTS[eventIndex];
  const { verificationCase } = await importChangeRequest(db, {
    externalEventId: event.externalEventId,
    vendorCode: event.vendorCode,
    requestedAt: event.requestedAt,
    sourceSystem: event.sourceSystem,
    sourceReference: event.sourceReference,
    requestContactName: event.requestContactName,
    requestContactPhone: event.requestContactPhone,
    newDestinationLabel: event.newDestinationLabel,
  });
  return verificationCase;
}

async function importCustom(externalEventId: string) {
  const { verificationCase } = await importChangeRequest(db, {
    externalEventId,
    vendorCode: "V-1001",
    requestedAt: "2026-09-10T09:00:00Z",
    sourceSystem: "erp_demo",
    sourceReference: "VC-9",
    requestContactName: "Request Author",
    requestContactPhone: "+13125550199",
    newDestinationLabel: "bank account ending 4410",
  });
  return verificationCase;
}

async function runToTerminal(caseId: string, safeCaseCode: string, scenario = "denied") {
  const preview = await createPreview(db, caseId);
  const intent = await authorizeIntent(db, {
    caseId,
    typedPhrase: `VERIFY ${safeCaseCode}`,
    attestedConsentingContact: true,
    preview,
  });
  await dispatchCall(db, { intentId: intent.id, scenario });
  return intent;
}

async function requestStatus(changeRequestId: string) {
  const rs = await db.execute({
    sql: "SELECT status FROM change_requests WHERE id = ?",
    args: [changeRequestId],
  });
  return rs.rows[0].status as string;
}

async function counts(caseId: string) {
  const [intents, snaps, audits] = await Promise.all([
    db.execute({ sql: "SELECT COUNT(*) c FROM call_intents WHERE case_id = ?", args: [caseId] }),
    db.execute({
      sql: `SELECT COUNT(*) c FROM call_snapshots
            WHERE intent_id IN (SELECT id FROM call_intents WHERE case_id = ?)`,
      args: [caseId],
    }),
    db.execute({ sql: "SELECT COUNT(*) c FROM audit_events WHERE case_id = ?", args: [caseId] }),
  ]);
  return {
    intents: intents.rows[0].c as number,
    snapshots: snaps.rows[0].c as number,
    audits: audits.rows[0].c as number,
  };
}

describe("resetSyntheticCase", () => {
  it("refuses in live mode", async () => {
    process.env.CHANGELOCK_MODE = "live";
    const kase = await importSeeded();
    await expect(resetSyntheticCase(db, { caseId: kase.id })).rejects.toThrow(/live/);
  });

  it("refuses a non-seeded case", async () => {
    const kase = await importCustom("evt-not-seeded-1");
    await runToTerminal(kase.id, kase.safeCaseCode);
    expect((await getCase(db, kase.id))!.state).toBe("verification_denied");
    await expect(resetSyntheticCase(db, { caseId: kase.id })).rejects.toThrow(/seeded/);
    expect((await getCase(db, kase.id))!.state).toBe("verification_denied");
  });

  it("refuses a case that is not in a terminal state", async () => {
    const kase = await importSeeded();
    await expect(resetSyntheticCase(db, { caseId: kase.id })).rejects.toThrow(/cannot reset/);
  });

  it("clears call artifacts, returns the case to needs_review, and keeps the request held", async () => {
    const kase = await importSeeded();
    const intent = await runToTerminal(kase.id, kase.safeCaseCode);
    expect((await getCase(db, kase.id))!.state).toBe("verification_denied");
    expect((await counts(kase.id)).intents).toBe(1);

    await resetSyntheticCase(db, { caseId: kase.id });

    const after = (await getCase(db, kase.id))!;
    expect(after.state).toBe("needs_review");
    expect(after.currentIntentId).toBeNull();
    expect(await getIntent(db, intent.id)).toBeNull();
    expect((await counts(kase.id)).intents).toBe(0);
    expect((await counts(kase.id)).snapshots).toBe(0);
    expect(await requestStatus(kase.changeRequestId)).toBe("held");

    const audits = await db.execute({
      sql: "SELECT type FROM audit_events WHERE case_id = ?",
      args: [kase.id],
    });
    expect(audits.rows.map((r) => r.type)).toEqual(["demo.reset"]);
  });

  it("is re-runnable: reset, replay to terminal again, reset again", async () => {
    const kase = await importSeeded();
    await runToTerminal(kase.id, kase.safeCaseCode);
    await resetSyntheticCase(db, { caseId: kase.id });
    await runToTerminal(kase.id, kase.safeCaseCode, "confirmed");
    expect((await getCase(db, kase.id))!.state).toBe("verification_confirmed");
    await resetSyntheticCase(db, { caseId: kase.id });
    expect((await getCase(db, kase.id))!.state).toBe("needs_review");
    expect(await requestStatus(kase.changeRequestId)).toBe("held");
  });

  it("does not touch other cases or the shared seed data", async () => {
    const target = await importSeeded(0);
    const other = await importSeeded(1);
    await runToTerminal(target.id, target.safeCaseCode);
    const otherIntent = await runToTerminal(other.id, other.safeCaseCode, "confirmed");

    await resetSyntheticCase(db, { caseId: target.id });

    expect((await getCase(db, other.id))!.state).toBe("verification_confirmed");
    expect((await getIntent(db, otherIntent.id))!.providerCallId).not.toBeNull();
    const vendors = await db.execute("SELECT COUNT(*) c FROM vendors");
    const contacts = await db.execute("SELECT COUNT(*) c FROM trusted_contacts");
    const requests = await db.execute("SELECT COUNT(*) c FROM change_requests");
    expect(vendors.rows[0].c).toBe(3);
    expect(contacts.rows[0].c).toBe(3);
    expect(requests.rows[0].c).toBe(2);
  });

  it("allows reset from needs_human after escalation", async () => {
    const kase = await importSeeded();
    const preview = await createPreview(db, kase.id);
    const intent = await authorizeIntent(db, {
      caseId: kase.id,
      typedPhrase: `VERIFY ${kase.safeCaseCode}`,
      attestedConsentingContact: true,
      preview,
    });
    await dispatchCall(db, { intentId: intent.id, scenario: "acceptance_unknown" });
    await escalateToHuman(db, { intentId: intent.id });
    expect((await getCase(db, kase.id))!.state).toBe("needs_human");
    await resetSyntheticCase(db, { caseId: kase.id });
    expect((await getCase(db, kase.id))!.state).toBe("needs_review");
  });

  it("rejects malformed input", async () => {
    const kase = await importSeeded();
    await expect(resetSyntheticCase(db, {})).rejects.toThrow();
    await expect(
      resetSyntheticCase(db, { caseId: kase.id, vendorId: "ven_northstar" }),
    ).rejects.toThrow();
  });
});
