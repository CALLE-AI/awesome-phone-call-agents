import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import { openDatabase, migrate, getCase, getIntent } from "../../src/infrastructure/db";
import { seedFixtures } from "../../src/fixtures/seed-data";
import { importChangeRequest } from "../../src/application/import-change-request";
import { createPreview } from "../../src/application/create-preview";
import { authorizeIntent } from "../../src/application/authorize-intent";
import { dispatchCall } from "../../src/application/dispatch-call";
import { refreshCall } from "../../src/application/refresh-call";
import { createReplayRefreshProvider } from "../../src/provider/replay-provider";
import { createLiveCallProvider } from "../../src/provider/calle-provider";

let db: Database;

function setup(vendorCode = "V-1001") {
  const { verificationCase } = importChangeRequest(db, {
    externalEventId: `evt-${Math.random().toString(36).slice(2)}`,
    vendorCode,
    requestedAt: "2026-09-10T09:00:00Z",
    sourceSystem: "erp_demo",
    sourceReference: "VC-1",
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

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
  seedFixtures(db);
});

describe("dispatchCall", () => {
  it("rejects body-supplied call-defining fields", async () => {
    const { intent } = setup();
    for (const extra of [
      { phoneE164: "+13125550199" },
      { task: "different task" },
      { providerMode: "live" },
      { recipientResultSchema: {} },
    ]) {
      await expect(dispatchCall(db, { intentId: intent.id, ...extra })).rejects.toThrow();
    }
    expect(getIntent(db, intent.id)!.status).toBe("reserved");
  });

  it("rejects an unknown replay scenario", async () => {
    const { intent } = setup();
    await expect(
      dispatchCall(db, { intentId: intent.id, scenario: "place-real-call" }),
    ).rejects.toThrow();
  });

  it("confirmed replay lands verification_confirmed and binds the call", async () => {
    const { verificationCase, intent } = setup();
    const result = await dispatchCall(db, { intentId: intent.id, scenario: "confirmed" });
    expect(result.outcome).toBe("accepted");
    expect(getCase(db, verificationCase.id)!.state).toBe("verification_confirmed");
    expect(getIntent(db, intent.id)!.providerCallId).toMatch(/^replay_confirmed_/);
  });

  it("acceptance_unknown parks the case and never retries", async () => {
    const { verificationCase, intent } = setup();
    const result = await dispatchCall(db, {
      intentId: intent.id,
      scenario: "acceptance_unknown",
    });
    expect(result.outcome).toBe("acceptance_unknown");
    expect(getCase(db, verificationCase.id)!.state).toBe("submission_unknown");
    expect(getIntent(db, intent.id)!.status).toBe("reserved");
    await expect(
      dispatchCall(db, { intentId: intent.id, scenario: "confirmed" }),
    ).rejects.toThrow();
  });

  it("definite rejection returns the case to needs_review", async () => {
    const { verificationCase, intent } = setup();
    const result = await dispatchCall(db, { intentId: intent.id, scenario: "rejected" });
    expect(result.outcome).toBe("rejected");
    expect(getCase(db, verificationCase.id)!.state).toBe("needs_review");
    expect(getIntent(db, intent.id)!.status).toBe("expired");
  });

  it("a dispatched intent cannot dispatch twice", async () => {
    const { intent } = setup();
    await dispatchCall(db, { intentId: intent.id, scenario: "confirmed" });
    await expect(dispatchCall(db, { intentId: intent.id })).rejects.toThrow();
    const calls = db
      .prepare("SELECT COUNT(*) c FROM call_snapshots WHERE intent_id = ?")
      .get(intent.id) as { c: number };
    expect(calls.c).toBe(1);
  });

  it("sensitive-data replay fails closed to needs_human with redacted evidence", async () => {
    const { verificationCase, intent } = setup();
    await dispatchCall(db, { intentId: intent.id, scenario: "sensitive-data" });
    expect(getCase(db, verificationCase.id)!.state).toBe("needs_human");
    const snap = db
      .prepare("SELECT evidence_json FROM call_snapshots WHERE intent_id = ?")
      .get(intent.id) as { evidence_json: string };
    expect(snap.evidence_json).not.toContain("987654321");
  });
});

describe("live mode gating", () => {
  it("live provider construction refuses without CHANGELOCK_MODE=live", () => {
    delete process.env.CHANGELOCK_MODE;
    expect(() => createLiveCallProvider()).toThrow();
  });

  it("a live intent cannot dispatch when the server is not in live mode", async () => {
    const { intent } = setup();
    db.prepare("UPDATE call_intents SET provider_mode = 'live' WHERE id = ?").run(intent.id);
    delete process.env.CHANGELOCK_MODE;
    await expect(dispatchCall(db, { intentId: intent.id })).rejects.toThrow(/live/);
  });

  it("authorizeIntent refuses providerMode=live unless the server is in live mode", () => {
    const { verificationCase } = setupCaseForLive();
    const preview = createPreview(db, verificationCase.id);
    delete process.env.CHANGELOCK_MODE;
    expect(() =>
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
    ).toThrow(/live/);
    const count = db
      .prepare("SELECT COUNT(*) c FROM call_intents WHERE case_id = ?")
      .get(verificationCase.id) as { c: number };
    expect(count.c).toBe(0);
  });

  it("judge-mode dispatch of a live intent leaves no provider call bound", async () => {
    const { intent } = setup();
    db.prepare("UPDATE call_intents SET provider_mode = 'live' WHERE id = ?").run(intent.id);
    delete process.env.CHANGELOCK_MODE;
    await expect(dispatchCall(db, { intentId: intent.id })).rejects.toThrow();
    expect(getIntent(db, intent.id)!.providerCallId).toBeNull();
  });
});

function setupCaseForLive() {
  return {
    verificationCase: importChangeRequest(db, {
      externalEventId: `evt-live-${Math.random().toString(36).slice(2)}`,
      vendorCode: "V-1001",
      requestedAt: "2026-09-10T09:00:00Z",
      sourceSystem: "erp_demo",
      sourceReference: "VC-1",
      requestContactName: "Request Author",
      requestContactPhone: "+13125550199",
      newDestinationLabel: "bank account ending 4410",
    }).verificationCase,
  };
}

describe("manual refresh", () => {
  it("refresh-only provider cannot create calls", async () => {
    const { intent } = setup();
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
    const { verificationCase, intent } = setup();
    await dispatchCall(db, { intentId: intent.id, scenario: "in-progress" });
    expect(getCase(db, verificationCase.id)!.state).toBe("call_active");
    const result = await refreshCall(db, intent.id, createReplayRefreshProvider(db));
    expect(result.disposition).toBe("in_progress");
    expect(getCase(db, verificationCase.id)!.state).toBe("call_active");
  });

  it("refresh resolves a still-open call through the same mapper/evaluator", async () => {
    const { verificationCase, intent } = setup();
    await dispatchCall(db, { intentId: intent.id, scenario: "in-progress" });
    const boundCallId = getIntent(db, intent.id)!.providerCallId!;
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
    expect(getCase(db, verificationCase.id)!.state).toBe("verification_confirmed");
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

  function freshCase() {
    const { verificationCase } = importChangeRequest(db, {
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

  function authInput(caseId: string) {
    const preview = createPreview(db, caseId);
    const kase = getCase(db, caseId)!;
    return {
      caseId,
      typedPhrase: `VERIFY ${kase.safeCaseCode}`,
      attestedConsentingContact: true,
      preview,
    };
  }

  function intentCount(caseId: string) {
    return (db
      .prepare("SELECT COUNT(*) c FROM call_intents WHERE case_id = ?")
      .get(caseId) as { c: number }).c;
  }

  it("fails before reserving when contact allowlist is empty", () => {
    process.env.CHANGELOCK_MODE = "live";
    process.env.CHANGELOCK_LIVE_REGION_ALLOWLIST = "US";
    const kase = freshCase();
    expect(() => authorizeIntent(db, authInput(kase.id), "live")).toThrow(
      /allowlist/,
    );
    expect(intentCount(kase.id)).toBe(0);
  });

  it("fails before reserving when region allowlist is empty", () => {
    process.env.CHANGELOCK_MODE = "live";
    process.env.CHANGELOCK_LIVE_CONTACT_ALLOWLIST = "+12025550114";
    const kase = freshCase();
    expect(() => authorizeIntent(db, authInput(kase.id), "live")).toThrow(
      /allowlist/,
    );
    expect(intentCount(kase.id)).toBe(0);
  });

  it("fails before reserving when the trusted phone is not allowlisted", () => {
    process.env.CHANGELOCK_MODE = "live";
    process.env.CHANGELOCK_LIVE_CONTACT_ALLOWLIST = "+12025550199";
    process.env.CHANGELOCK_LIVE_REGION_ALLOWLIST = "US";
    const kase = freshCase();
    expect(() => authorizeIntent(db, authInput(kase.id), "live")).toThrow();
    expect(intentCount(kase.id)).toBe(0);
  });

  it("fails before reserving when the region is not allowlisted", () => {
    process.env.CHANGELOCK_MODE = "live";
    process.env.CHANGELOCK_LIVE_CONTACT_ALLOWLIST = "+12025550114";
    process.env.CHANGELOCK_LIVE_REGION_ALLOWLIST = "GB";
    const kase = freshCase();
    expect(() => authorizeIntent(db, authInput(kase.id), "live")).toThrow(
      /region/,
    );
    expect(intentCount(kase.id)).toBe(0);
  });

  it("reserves a live intent when both allowlists pass", () => {
    process.env.CHANGELOCK_MODE = "live";
    process.env.CHANGELOCK_LIVE_CONTACT_ALLOWLIST = "+12025550114,+12025550127";
    process.env.CHANGELOCK_LIVE_REGION_ALLOWLIST = "US";
    const kase = freshCase();
    const intent = authorizeIntent(db, authInput(kase.id), "live");
    expect(intent.providerMode).toBe("live");
    expect(intentCount(kase.id)).toBe(1);
  });
});
