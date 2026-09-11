import { afterEach, describe, expect, it } from "vitest";
import type { ClaimLineApp } from "../src/app.js";
import { makeApp } from "./helpers.js";

let app: ClaimLineApp;

afterEach(() => {
  app?.close();
});

function claimId(a: ClaimLineApp, reference: string): string {
  const claim = a.store.getClaimByReference(reference);
  if (!claim) throw new Error(`missing ${reference}`);
  return claim.id;
}

describe("end-to-end (no real calls)", () => {
  it("verifies a good FNOL intake through the full pipeline", async () => {
    app = makeApp();
    app.seedDemo();
    const id = claimId(app, "CLM-1001");

    const outcome = await app.dispatcher.dispatch(id, "fnol_intake", {
      confirm: true,
      fixtureScenario: "fnol_ok",
    });
    expect(outcome.status).toBe("submitted");
    expect(outcome.intent.state).toBe("accepted");

    await app.reconciler.pollOnce();

    const view = app.getClaimView(id)!;
    const fnol = view.intents.find((i) => i.intent.callType === "fnol_intake")!;
    expect(fnol.intent.state).toBe("terminal_verified");
    expect(fnol.result?.disposition).toBe("auto_ok");
    expect(fnol.result?.structuredResult?.incident_type).toBe("auto_collision");
    expect(fnol.result?.transcript.length).toBeGreaterThan(0);
  });

  it("routes a voicemail to needs_human and never guesses a result", async () => {
    app = makeApp();
    app.seedDemo();
    const id = claimId(app, "CLM-1002");

    await app.dispatcher.dispatch(id, "fnol_intake", {
      confirm: true,
      fixtureScenario: "voicemail",
    });
    await app.reconciler.pollOnce();

    const view = app.getClaimView(id)!;
    const intent = view.intents[0]!;
    expect(intent.intent.state).toBe("needs_human");
    expect(intent.result?.disposition).toBe("needs_human");
    expect(intent.result?.structuredResult).toBeNull();
  });

  it("routes a failed call to needs_human", async () => {
    app = makeApp();
    app.seedDemo();
    const id = claimId(app, "CLM-1001");

    await app.dispatcher.dispatch(id, "fnol_intake", {
      confirm: true,
      fixtureScenario: "failed",
    });
    await app.reconciler.pollOnce();

    const view = app.getClaimView(id)!;
    const intent = view.intents.find((i) => i.intent.callType === "fnol_intake")!;
    expect(intent.intent.state).toBe("needs_human");
  });

  it("does not place a call without confirmation (preview stays reserved)", async () => {
    app = makeApp();
    app.seedDemo();
    const id = claimId(app, "CLM-1001");

    const outcome = await app.dispatcher.dispatch(id, "fnol_intake", {
      confirm: false,
    });
    expect(outcome.status).toBe("preview");
    expect(outcome.intent.state).toBe("reserved");
    expect(outcome.intent.callId).toBeNull();
  });

  it("is idempotent: dispatching the same authorized call twice makes one intent", async () => {
    app = makeApp();
    app.seedDemo();
    const id = claimId(app, "CLM-1001");

    const first = await app.dispatcher.dispatch(id, "fnol_intake", { confirm: true });
    const second = await app.dispatcher.dispatch(id, "fnol_intake", { confirm: true });

    expect(first.status).toBe("submitted");
    expect(second.status).toBe("duplicate");
    expect(second.intent.id).toBe(first.intent.id);
    const fnolIntents = app.store
      .listIntentsByClaim(id)
      .filter((i) => i.callType === "fnol_intake");
    expect(fnolIntents.length).toBe(1);
  });

  it("cancels a reserved intent before dialing", async () => {
    app = makeApp();
    app.seedDemo();
    const id = claimId(app, "CLM-1001");

    const preview = await app.dispatcher.dispatch(id, "fnol_intake", { confirm: false });
    const canceled = app.dispatcher.cancel(preview.intent.id);
    expect(canceled.state).toBe("canceled");
    expect(() => app.dispatcher.cancel(preview.intent.id)).toThrow();
  });

  it("records a human decision only after a terminal state", async () => {
    app = makeApp();
    app.seedDemo();
    const id = claimId(app, "CLM-1001");

    const outcome = await app.dispatcher.dispatch(id, "fnol_intake", {
      confirm: true,
      fixtureScenario: "fnol_ok",
    });
    // Cannot decide while the call is still accepted.
    expect(() =>
      app.applyDecision(outcome.intent.id, { decidedBy: "p", decision: "accept" }),
    ).toThrow();

    await app.reconciler.pollOnce();
    const applied = app.applyDecision(outcome.intent.id, {
      decidedBy: "Priya",
      decision: "accept_intake",
      note: "looks good",
    });
    expect(applied.state).toBe("applied");
    expect(app.store.getDecision(outcome.intent.id)?.decision).toBe("accept_intake");
  });

  it("dedupes webhook inbox entries by event id", () => {
    app = makeApp();
    const first = app.store.insertInboxEntry({
      eventId: "evt_1",
      callId: "call_1",
      payload: "{}",
    });
    const dup = app.store.insertInboxEntry({
      eventId: "evt_1",
      callId: "call_1",
      payload: "{}",
    });
    expect(first.inserted).toBe(true);
    expect(dup.inserted).toBe(false);
  });
});
