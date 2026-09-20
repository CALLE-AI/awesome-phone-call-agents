import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/infrastructure/db";
import { openDatabase, getCase, getIntent } from "../../src/infrastructure/db";
import { seedFixtures } from "../../src/fixtures/seed-data";
import { importChangeRequest } from "../../src/application/import-change-request";
import { createPreview } from "../../src/application/create-preview";
import { authorizeIntent } from "../../src/application/authorize-intent";
import { dispatchCall } from "../../src/application/dispatch-call";
import { refreshCall } from "../../src/application/refresh-call";
import { createReplayRefreshProvider } from "../../src/provider/replay-provider";
import { createLiveCallProvider } from "../../src/provider/calle-provider";

let db: DbClient;

async function setup(vendorCode = "V-1001") {
  const { verificationCase } = await importChangeRequest(db, {
    externalEventId: `evt-${Math.random().toString(36).slice(2)}`,
    vendorCode,
    requestedAt: "2026-09-10T09:00:00Z",
    sourceSystem: "erp_demo",
    sourceReference: "VC-1",
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

beforeEach(async () => {
  db = await openDatabase(":memory:");
  await seedFixtures(db);
});

afterEach(() => {
  db.close();
});

describe("dispatchCall", () => {
  it("rejects body-supplied call-defining fields", async () => {
    const { intent } = await setup();
    for (const extra of [
      { phoneE164: "+13125550199" },
      { task: "different task" },
      { providerMode: "live" },
      { recipientResultSchema: {} },
    ]) {
      await expect(dispatchCall(db, { intentId: intent.id, ...extra })).rejects.toThrow();
    }
    expect((await getIntent(db, intent.id))!.status).toBe("reserved");
  });

  it("rejects an unknown replay scenario", async () => {
    const { intent } = await setup();
    await expect(
      dispatchCall(db, { intentId: intent.id, scenario: "place-real-call" }),
    ).rejects.toThrow();
  });

  it("confirmed replay lands verification_confirmed and binds the call", async () => {
    const { verificationCase, intent } = await setup();
    const result = await dispatchCall(db, { intentId: intent.id, scenario: "confirmed" });
    expect(result.outcome).toBe("accepted");
    expect((await getCase(db, verificationCase.id))!.state).toBe("verification_confirmed");
    expect((await getIntent(db, intent.id))!.providerCallId).toMatch(/^replay_confirmed_/);
  });

  it("acceptance_unknown parks the case and never retries", async () => {
    const { verificationCase, intent } = await setup();
    const result = await dispatchCall(db, {
      intentId: intent.id,
      scenario: "acceptance_unknown",
    });
    expect(result.outcome).toBe("acceptance_unknown");
    expect((await getCase(db, verificationCase.id))!.state).toBe("submission_unknown");
    expect((await getIntent(db, intent.id))!.status).toBe("reserved");
    await expect(
      dispatchCall(db, { intentId: intent.id, scenario: "confirmed" }),
    ).rejects.toThrow();
  });

  it("definite rejection returns the case to needs_review", async () => {
    const { verificationCase, intent } = await setup();
    const result = await dispatchCall(db, { intentId: intent.id, scenario: "rejected" });
    expect(result.outcome).toBe("rejected");
    expect((await getCase(db, verificationCase.id))!.state).toBe("needs_review");
    expect((await getIntent(db, intent.id))!.status).toBe("expired");
  });

  it("a dispatched intent cannot dispatch twice", async () => {
    const { intent } = await setup();
    await dispatchCall(db, { intentId: intent.id, scenario: "confirmed" });
    await expect(dispatchCall(db, { intentId: intent.id })).rejects.toThrow();
    const calls = await db.execute({
      sql: "SELECT COUNT(*) c FROM call_snapshots WHERE intent_id = ?",
      args: [intent.id],
    });
    expect(calls.rows[0].c).toBe(1);
  });

  it("sensitive-data replay fails closed to needs_human with redacted evidence", async () => {
    const { verificationCase, intent } = await setup();
    await dispatchCall(db, { intentId: intent.id, scenario: "sensitive-data" });
    expect((await getCase(db, verificationCase.id))!.state).toBe("needs_human");
    const snap = await db.execute({
      sql: "SELECT evidence_json FROM call_snapshots WHERE intent_id = ?",
      args: [intent.id],
    });
    expect(snap.rows[0].evidence_json).not.toContain("987654321");
  });
});

describe("live mode gating", () => {
  it("live provider construction refuses without CHANGELOCK_MODE=live", () => {
    delete process.env.CHANGELOCK_MODE;
    expect(() => createLiveCallProvider()).toThrow();
  });

  it("a live intent cannot dispatch when the server is not in live mode", async () => {
    const { intent } = await setup();
    await db.execute({
      sql: "UPDATE call_intents SET provider_mode = 'live' WHERE id = ?",
      args: [intent.id],
    });
    delete process.env.CHANGELOCK_MODE;
    await expect(dispatchCall(db, { intentId: intent.id })).rejects.toThrow(/live/);
  });

  it("authorizeIntent refuses providerMode=live unless the server is in live mode", async () => {
    const { verificationCase } = await setupCaseForLive();
    const preview = await createPreview(db, verificationCase.id);
    delete process.env.CHANGELOCK_MODE;
    await expect(
      authorizeIntent(
        db,
        {
          caseId: verificationCase.id,
          typedPhrase: `VERIFY ${verificationCase.safeCaseCode}`,
          attestedConsentingContact: true,
          preview,
        },
        "live",
      ),
    ).rejects.toThrow(/live/);
    const count = await db.execute({
      sql: "SELECT COUNT(*) c FROM call_intents WHERE case_id = ?",
      args: [verificationCase.id],
    });
    expect(count.rows[0].c).toBe(0);
  });

  it("judge-mode dispatch of a live intent leaves no provider call bound", async () => {
    const { intent } = await setup();
    await db.execute({
      sql: "UPDATE call_intents SET provider_mode = 'live' WHERE id = ?",
      args: [intent.id],
    });
    delete process.env.CHANGELOCK_MODE;
    await expect(dispatchCall(db, { intentId: intent.id })).rejects.toThrow();
    expect((await getIntent(db, intent.id))!.providerCallId).toBeNull();
  });
});

async function setupCaseForLive() {
  return {
    verificationCase: (
      await importChangeRequest(db, {
        externalEventId: `evt-live-${Math.random().toString(36).slice(2)}`,
        vendorCode: "V-1001",
        requestedAt: "2026-09-10T09:00:00Z",
        sourceSystem: "erp_demo",
        sourceReference: "VC-1",
        requestContactName: "Request Author",
        requestContactPhone: "+13125550199",
        newDestinationLabel: "bank account ending 4410",
      })
    ).verificationCase,
  };
}

describe("manual refresh", () => {
  it("refresh-only provider cannot create calls", async () => {
    const { intent } = await setup();
    const provider = createReplayRefreshProvider(db);
    await expect(
      provider.create({
        task: "x",
        phoneE164: "+12025550114",
        region: "US",
        locale: "en-US",
        recipientResultSchema: {},
        metadata: {
          intentId: intent.id,
          caseId: intent.caseId,
          requestHash: "x",
          taskVersion: "x",
          schemaVersion: "x",
        },
        idempotencyKey: "x",
      }),
    ).rejects.toThrow();
  });

  it("refresh polls an existing bound call and keeps an active case active", async () => {
    const { verificationCase, intent } = await setup();
    await dispatchCall(db, { intentId: intent.id, scenario: "in-progress" });
    expect((await getCase(db, verificationCase.id))!.state).toBe("call_active");
    const result = await refreshCall(db, intent.id, createReplayRefreshProvider(db));
    expect(result.disposition).toBe("in_progress");
    expect((await getCase(db, verificationCase.id))!.state).toBe("call_active");
  });

  it("refresh resolves a still-open call through the same mapper/evaluator", async () => {
    const { verificationCase, intent } = await setup();
    await dispatchCall(db, { intentId: intent.id, scenario: "in-progress" });
    const boundCallId = (await getIntent(db, intent.id))!.providerCallId!;
    const provider = {
      create: () => Promise.reject(new Error("no create")),
      get: async () => ({
        id: boundCallId,
        status: "completed" as const,
        taskCompleted: true,
        recipientStatus: "completed",
        confidenceScore: 0.95,
        failureCode: null,
        structuredResult: {
          organization_identity: "confirmed",
          change_request_status: "initiated",
          safe_case_code_confirmed: "yes",
          sensitive_data_disclosed: "no",
          recipient_opt_out: "no",
        },
        evidence: ["Recipient confirmed initiation."],
        dialedPhoneE164: "+12025550114",
        metadata: {
          intentId: intent.id,
          caseId: intent.caseId,
          requestHash: intent.requestHash,
          taskVersion: intent.taskVersion,
          schemaVersion: intent.schemaVersion,
        },
      }),
    };
    const result = await refreshCall(db, intent.id, provider);
    expect(result.disposition).toBe("confirmed");
    expect((await getCase(db, verificationCase.id))!.state).toBe("verification_confirmed");
  });
});

describe("live policy gating in authorizeIntent", () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    delete process.env.CHANGELOCK_MODE;
    delete process.env.CHANGELOCK_LIVE_CONTACT_ALLOWLIST;
    delete process.env.CHANGELOCK_LIVE_REGION_ALLOWLIST;
    Object.assign(process.env, ORIGINAL);
  });

  async function freshCase() {
    const { verificationCase } = await importChangeRequest(db, {
      externalEventId: `evt-live-${Math.random().toString(36).slice(2)}`,
      vendorCode: "V-1001",
      requestedAt: "2026-09-10T09:00:00Z",
      sourceSystem: "erp_demo",
      sourceReference: "VC-1",
      requestContactName: "Request Author",
      requestContactPhone: "+13125550199",
      newDestinationLabel: "bank account ending 4410",
    });
    return verificationCase;
  }

  async function authInput(caseId: string) {
    const preview = await createPreview(db, caseId);
    const kase = (await getCase(db, caseId))!;
    return {
      caseId,
      typedPhrase: `VERIFY ${kase.safeCaseCode}`,
      attestedConsentingContact: true,
      preview,
    };
  }

  async function intentCount(caseId: string) {
    const rs = await db.execute({
      sql: "SELECT COUNT(*) c FROM call_intents WHERE case_id = ?",
      args: [caseId],
    });
    return rs.rows[0].c as number;
  }

  it("fails before reserving when contact allowlist is empty", async () => {
    process.env.CHANGELOCK_MODE = "live";
    process.env.CHANGELOCK_LIVE_REGION_ALLOWLIST = "US";
    const kase = await freshCase();
    await expect(authorizeIntent(db, await authInput(kase.id), "live")).rejects.toThrow(
      /allowlist/,
    );
    expect(await intentCount(kase.id)).toBe(0);
  });

  it("fails before reserving when region allowlist is empty", async () => {
    process.env.CHANGELOCK_MODE = "live";
    process.env.CHANGELOCK_LIVE_CONTACT_ALLOWLIST = "+12025550114";
    const kase = await freshCase();
    await expect(authorizeIntent(db, await authInput(kase.id), "live")).rejects.toThrow(
      /allowlist/,
    );
    expect(await intentCount(kase.id)).toBe(0);
  });

  it("fails before reserving when the trusted phone is not allowlisted", async () => {
    process.env.CHANGELOCK_MODE = "live";
    process.env.CHANGELOCK_LIVE_CONTACT_ALLOWLIST = "+12025550199";
    process.env.CHANGELOCK_LIVE_REGION_ALLOWLIST = "US";
    const kase = await freshCase();
    await expect(authorizeIntent(db, await authInput(kase.id), "live")).rejects.toThrow();
    expect(await intentCount(kase.id)).toBe(0);
  });

  it("fails before reserving when the region is not allowlisted", async () => {
    process.env.CHANGELOCK_MODE = "live";
    process.env.CHANGELOCK_LIVE_CONTACT_ALLOWLIST = "+12025550114";
    process.env.CHANGELOCK_LIVE_REGION_ALLOWLIST = "GB";
    const kase = await freshCase();
    await expect(authorizeIntent(db, await authInput(kase.id), "live")).rejects.toThrow(
      /region/,
    );
    expect(await intentCount(kase.id)).toBe(0);
  });

  it("reserves a live intent when both allowlists pass", async () => {
    process.env.CHANGELOCK_MODE = "live";
    process.env.CHANGELOCK_LIVE_CONTACT_ALLOWLIST = "+12025550114,+12025550127";
    process.env.CHANGELOCK_LIVE_REGION_ALLOWLIST = "US";
    const kase = await freshCase();
    const intent = await authorizeIntent(db, await authInput(kase.id), "live");
    expect(intent.providerMode).toBe("live");
    expect(await intentCount(kase.id)).toBe(1);
  });
});
