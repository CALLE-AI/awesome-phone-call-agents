import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "../../src/infrastructure/db";
import { openDatabase, getCase, getIntent } from "../../src/infrastructure/db";
import { seedFixtures } from "../../src/fixtures/seed-data";
import { importChangeRequest } from "../../src/application/import-change-request";
import { createPreview } from "../../src/application/create-preview";
import { authorizeIntent } from "../../src/application/authorize-intent";
import { dispatchCall } from "../../src/application/dispatch-call";
import { reconcileUnknownCall } from "../../src/application/reconcile-unknown";
import { escalateToHuman } from "../../src/application/escalate";
import type { CallProvider, ProviderCallSnapshot } from "../../src/provider/call-provider";

let db: DbClient;
const ORIGINAL_MODE = process.env.CHANGELOCK_MODE;

async function setupUnknown() {
  const { verificationCase } = await importChangeRequest(db, {
    externalEventId: `evt-${Math.random().toString(36).slice(2)}`,
    vendorCode: "V-1001",
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

function acceptedSnapshot(
  intent: { id: string; caseId: string; requestHash: string; taskVersion: string; schemaVersion: string },
  callId: string,
): ProviderCallSnapshot {
  return {
    id: callId,
    status: "completed",
    taskCompleted: true,
    recipientStatus: "completed",
    confidenceScore: 0.93,
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
  };
}

beforeEach(async () => {
  db = await openDatabase(":memory:");
  await seedFixtures(db);
  process.env.CHANGELOCK_MODE = "live";
});

afterEach(() => {
  db.close();
  if (ORIGINAL_MODE === undefined) delete process.env.CHANGELOCK_MODE;
  else process.env.CHANGELOCK_MODE = ORIGINAL_MODE;
});

describe("reconcileUnknownCall", () => {
  it("rejects unless the server is in live mode", async () => {
    process.env.CHANGELOCK_MODE = "replay";
    const { intent } = await setupUnknown();
    const provider: CallProvider = {
      create: vi.fn(),
      get: vi.fn().mockResolvedValue(acceptedSnapshot(intent, "call_1")),
    };
    await expect(
      reconcileUnknownCall(db, { intentId: intent.id, providerCallId: "call_1" }, provider),
    ).rejects.toThrow(/live/);
    expect(provider.get).not.toHaveBeenCalled();
  });

  it("binds an authoritative snapshot and evaluates through the shared path", async () => {
    const { verificationCase, intent } = await setupUnknown();
    await dispatchCall(db, { intentId: intent.id, scenario: "acceptance_unknown" });
    expect((await getCase(db, verificationCase.id))!.state).toBe("submission_unknown");

    const provider: CallProvider = {
      create: vi.fn().mockRejectedValue(new Error("must never create")),
      get: vi.fn().mockResolvedValue(acceptedSnapshot(intent, "call_real_1")),
    };
    const result = await reconcileUnknownCall(
      db,
      { intentId: intent.id, providerCallId: "call_real_1" },
      provider,
    );
    expect(provider.get).toHaveBeenCalledTimes(1);
    expect(provider.get).toHaveBeenCalledWith("call_real_1");
    expect(provider.create).not.toHaveBeenCalled();
    expect(result.disposition).toBe("confirmed");
    expect((await getCase(db, verificationCase.id))!.state).toBe("verification_confirmed");
    expect((await getIntent(db, intent.id))!.providerCallId).toBe("call_real_1");
  });

  it("mismatched bindings move to needs_human without binding the call id", async () => {
    const { verificationCase, intent } = await setupUnknown();
    await dispatchCall(db, { intentId: intent.id, scenario: "acceptance_unknown" });
    const bad = acceptedSnapshot(intent, "call_real_2");
    bad.metadata = { ...bad.metadata, requestHash: "tampered" };
    const provider: CallProvider = {
      create: vi.fn(),
      get: vi.fn().mockResolvedValue(bad),
    };
    await reconcileUnknownCall(
      db,
      { intentId: intent.id, providerCallId: "call_real_2" },
      provider,
    );
    expect((await getCase(db, verificationCase.id))!.state).toBe("needs_human");
    expect((await getIntent(db, intent.id))!.providerCallId).toBeNull();
    const audit = await db.execute({
      sql: "SELECT safe_payload_json FROM audit_events WHERE case_id = ? AND type = 'reconcile.binding_mismatch'",
      args: [verificationCase.id],
    });
    expect(audit.rows[0].safe_payload_json).toContain("binding_request_hash");
    expect(audit.rows[0].safe_payload_json).not.toContain("+12025550114");
  });

  it("a provider.get failure leaves the case submission_unknown for another attempt", async () => {
    const { verificationCase, intent } = await setupUnknown();
    await dispatchCall(db, { intentId: intent.id, scenario: "acceptance_unknown" });
    const provider: CallProvider = {
      create: vi.fn(),
      get: vi.fn().mockRejectedValue(new Error("socket hangup 10.0.0.1")),
    };
    await expect(
      reconcileUnknownCall(db, { intentId: intent.id, providerCallId: "call_x" }, provider),
    ).rejects.toThrow();
    expect((await getCase(db, verificationCase.id))!.state).toBe("submission_unknown");
    expect((await getIntent(db, intent.id))!.providerCallId).toBeNull();
  });

  it("a snapshot id different from the entered id fails to needs_human unbound", async () => {
    const { verificationCase, intent } = await setupUnknown();
    await dispatchCall(db, { intentId: intent.id, scenario: "acceptance_unknown" });
    const provider: CallProvider = {
      create: vi.fn(),
      get: vi.fn().mockResolvedValue(acceptedSnapshot(intent, "call_other")),
    };
    await reconcileUnknownCall(
      db,
      { intentId: intent.id, providerCallId: "call_entered" },
      provider,
    );
    expect((await getCase(db, verificationCase.id))!.state).toBe("needs_human");
    expect((await getIntent(db, intent.id))!.providerCallId).toBeNull();
  });

  it("a second reconcile is blocked after a call is bound", async () => {
    const { intent } = await setupUnknown();
    await dispatchCall(db, { intentId: intent.id, scenario: "acceptance_unknown" });
    const provider: CallProvider = {
      create: vi.fn(),
      get: vi.fn().mockResolvedValue(acceptedSnapshot(intent, "call_real_1")),
    };
    await reconcileUnknownCall(
      db,
      { intentId: intent.id, providerCallId: "call_real_1" },
      provider,
    );
    await expect(
      reconcileUnknownCall(db, { intentId: intent.id, providerCallId: "call_2" }, provider),
    ).rejects.toThrow();
    expect(provider.get).toHaveBeenCalledTimes(1);
  });

  it("non-terminal authoritative snapshots move the case to call_active", async () => {
    const { verificationCase, intent } = await setupUnknown();
    await dispatchCall(db, { intentId: intent.id, scenario: "acceptance_unknown" });
    const snap = acceptedSnapshot(intent, "call_live_9");
    snap.status = "in_progress";
    snap.taskCompleted = null;
    snap.confidenceScore = null;
    snap.structuredResult = null;
    const provider: CallProvider = {
      create: vi.fn(),
      get: vi.fn().mockResolvedValue(snap),
    };
    const result = await reconcileUnknownCall(
      db,
      { intentId: intent.id, providerCallId: "call_live_9" },
      provider,
    );
    expect(result.disposition).toBe("in_progress");
    expect((await getCase(db, verificationCase.id))!.state).toBe("call_active");
  });
});

describe("escalateToHuman", () => {
  it("moves submission_unknown to needs_human with no provider interaction", async () => {
    const { verificationCase, intent } = await setupUnknown();
    await dispatchCall(db, { intentId: intent.id, scenario: "acceptance_unknown" });
    await escalateToHuman(db, { intentId: intent.id });
    expect((await getCase(db, verificationCase.id))!.state).toBe("needs_human");
    expect((await getIntent(db, intent.id))!.status).toBe("expired");
    expect((await getIntent(db, intent.id))!.providerCallId).toBeNull();
  });

  it("works in judge mode without any network or credentials", async () => {
    process.env.CHANGELOCK_MODE = "replay";
    const { verificationCase, intent } = await setupUnknown();
    await dispatchCall(db, { intentId: intent.id, scenario: "acceptance_unknown" });
    await escalateToHuman(db, { intentId: intent.id });
    expect((await getCase(db, verificationCase.id))!.state).toBe("needs_human");
  });

  it("rejects cases that are not submission_unknown", async () => {
    const { intent } = await setupUnknown();
    await expect(escalateToHuman(db, { intentId: intent.id })).rejects.toThrow();
    await expect(escalateToHuman(db, { intentId: intent.id, extra: 1 })).rejects.toThrow();
  });
});
