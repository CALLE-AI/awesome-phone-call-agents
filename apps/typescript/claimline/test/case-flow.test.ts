import { afterEach, describe, expect, it } from "vitest";
import type { ClaimLineApp } from "../src/app.js";
import { makeApp } from "./helpers.js";

let app: ClaimLineApp;

afterEach(() => {
  app?.close();
});

function bikeClaimId(a: ClaimLineApp): string {
  const claim = a.store.listClaims().find((c) => c.incidentType === "injury");
  if (!claim) throw new Error("missing bike-accident (injury) claim");
  return claim.id;
}

describe("multi-party case flow (no real calls)", () => {
  it("seeds a bike-accident case with claimant, doctor and billing contacts", () => {
    app = makeApp();
    app.seedDemo();
    const claimId = bikeClaimId(app);
    const contacts = app.store.listContactsByClaim(claimId);
    const roles = contacts.map((c) => c.role).sort();
    expect(roles).toEqual(["claimant", "hospital_billing", "treating_doctor"]);
  });

  it("gathers a medical report and a bill, then aggregates a total", async () => {
    app = makeApp();
    app.seedDemo();
    const claimId = bikeClaimId(app);
    const contacts = app.store.listContactsByClaim(claimId);
    const doctor = contacts.find((c) => c.role === "treating_doctor")!;
    const billing = contacts.find((c) => c.role === "hospital_billing")!;

    await app.dispatcher.dispatchToContact(claimId, doctor.id, { confirm: true });
    await app.dispatcher.dispatchToContact(claimId, billing.id, { confirm: true });
    await app.reconciler.pollOnce();

    const view = app.getCaseView(claimId)!;
    const doctorRow = view.contacts.find((c) => c.contact.id === doctor.id)!;
    const billRow = view.contacts.find((c) => c.contact.id === billing.id)!;

    expect(doctorRow.intent?.callType).toBe("medical_report");
    expect(doctorRow.intent?.state).toBe("terminal_verified");
    expect(doctorRow.result?.structuredResult?.accident_consistent).toBe("yes");

    expect(billRow.intent?.callType).toBe("bill_verification");
    expect(billRow.result?.structuredResult?.total_amount).toBe(2450);

    expect(view.totals.billedTotal).toBe(2450);
    expect(view.totals.currency).toBe("USD");
    expect(view.totals.incomplete).toBe(false);
  });

  it("routes a doctor's voicemail to needs_human and marks totals incomplete", async () => {
    app = makeApp();
    app.seedDemo();
    const claimId = bikeClaimId(app);
    const billing = app.store
      .listContactsByClaim(claimId)
      .find((c) => c.role === "hospital_billing")!;

    await app.dispatcher.dispatchToContact(claimId, billing.id, {
      confirm: true,
      fixtureScenario: "voicemail",
    });
    await app.reconciler.pollOnce();

    const view = app.getCaseView(claimId)!;
    const billRow = view.contacts.find((c) => c.contact.id === billing.id)!;
    expect(billRow.intent?.state).toBe("needs_human");
    expect(view.totals.billedTotal).toBeNull();
    expect(view.totals.incomplete).toBe(true);
  });

  it("lets a human sanction the claim with an approved amount", async () => {
    app = makeApp();
    app.seedDemo();
    const claimId = bikeClaimId(app);

    const decision = app.sanctionClaim(claimId, {
      decidedBy: "Priya",
      decision: "approved",
      sanctionedAmount: 2450,
      currency: "USD",
      note: "Injuries and bill verified.",
    });
    expect(decision.decision).toBe("approved");
    expect(decision.sanctionedAmount).toBe(2450);

    const view = app.getCaseView(claimId)!;
    expect(view.claimDecision?.decision).toBe("approved");
    expect(view.claimDecision?.sanctionedAmount).toBe(2450);
  });

  it("does not attach a sanctioned amount to a rejection", () => {
    app = makeApp();
    app.seedDemo();
    const claimId = bikeClaimId(app);
    const decision = app.sanctionClaim(claimId, {
      decidedBy: "Priya",
      decision: "rejected",
      sanctionedAmount: 2450,
      note: "Inconsistent account.",
    });
    expect(decision.decision).toBe("rejected");
    expect(decision.sanctionedAmount).toBeNull();
  });

  it("re-dials a failed call as a fresh attempt with a new idempotency key", async () => {
    app = makeApp();
    app.seedDemo();
    const claimId = bikeClaimId(app);
    const doctor = app.store
      .listContactsByClaim(claimId)
      .find((c) => c.role === "treating_doctor")!;

    // Place a call that goes to voicemail, then reconcile → needs_human.
    const first = await app.dispatcher.dispatchToContact(claimId, doctor.id, {
      confirm: true,
      fixtureScenario: "voicemail",
    });
    await app.reconciler.pollOnce();
    const firstIntent = app.store.getIntent(first.intent.id)!;
    expect(firstIntent.state).toBe("needs_human");

    // Re-dial → a brand-new intent + call, with a distinct idempotency key.
    const retry = await app.dispatcher.redial(firstIntent.id, { placedBy: "owner" });
    expect(retry.intent.id).not.toBe(firstIntent.id);
    expect(retry.intent.idempotencyKey).not.toBe(firstIntent.idempotencyKey);
    expect(retry.intent.contactId).toBe(doctor.id);
    expect(retry.intent.callType).toBe("medical_report");
    expect(retry.intent.placedBy).toBe("owner");
    expect(
      app.store.countIntentsForContact(claimId, doctor.id, "medical_report"),
    ).toBe(2);
  });

  it("refuses to re-dial a call that has not failed", async () => {
    app = makeApp();
    app.seedDemo();
    const claimId = bikeClaimId(app);
    const doctor = app.store
      .listContactsByClaim(claimId)
      .find((c) => c.role === "treating_doctor")!;
    const ok = await app.dispatcher.dispatchToContact(claimId, doctor.id, {
      confirm: true,
    });
    await app.reconciler.pollOnce();
    const verified = app.store.getIntent(ok.intent.id)!;
    expect(verified.state).toBe("terminal_verified");
    await expect(app.dispatcher.redial(verified.id)).rejects.toThrow(/only a failed call/);
  });

  it("adds a new contact and dispatches a role-appropriate call", async () => {
    app = makeApp();
    app.seedDemo();
    const claimId = bikeClaimId(app);
    const witness = app.addContact(claimId, {
      role: "witness",
      name: "Jordan Lee",
      phone: "+12025550155",
    });
    const outcome = await app.dispatcher.dispatchToContact(claimId, witness.id, {
      confirm: true,
    });
    expect(outcome.status).toBe("submitted");
    expect(outcome.intent.callType).toBe("fnol_intake");
    expect(outcome.intent.contactId).toBe(witness.id);
  });
});
