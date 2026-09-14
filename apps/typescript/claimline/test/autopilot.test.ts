import { afterEach, describe, expect, it } from "vitest";
import type { ClaimLineApp } from "../src/app.js";
import { createNotifier, SimulatedNotifier, SlackNotifier } from "../src/notify/index.js";
import { createPaymentGateway, SimulatedPaymentGateway } from "../src/payments/index.js";
import { makeApp, makeConfig } from "./helpers.js";

let app: ClaimLineApp;

afterEach(() => {
  try {
    app?.close();
  } catch {
    // already closed
  }
  app = undefined as unknown as ClaimLineApp;
});

function bikeClaimId(a: ClaimLineApp): string {
  const claim = a.store.listClaims().find((c) => c.incidentType === "injury");
  if (!claim) throw new Error("missing injury claim");
  return claim.id;
}

describe("autopilot", () => {
  it("calls every party, then generates and delivers the report", async () => {
    app = makeApp();
    app.seedDemo();
    const claimId = bikeClaimId(app);
    const reference = app.store.getClaim(claimId)!.reference;

    const result = await app.runAutopilot(claimId, { placedBy: "fixture" });

    // claimant + treating doctor + hospital billing.
    expect(result.dispatched).toBeGreaterThanOrEqual(3);
    // Fixture calls complete on the inline reconcile, so the report is sent.
    expect(result.notified).toBe(true);
    expect(result.report).not.toBeNull();
    expect(result.report!.text).toContain(reference);
    expect(app.store.getClaimAutopilot(claimId).reportSentAt).not.toBeNull();
  });

  it("marks the report sent exactly once", async () => {
    app = makeApp();
    app.seedDemo();
    const claimId = bikeClaimId(app);
    await app.runAutopilot(claimId, { placedBy: "fixture" });
    const first = app.store.getClaimAutopilot(claimId).reportSentAt;
    const again = await app.maybeSendAutopilotReport(claimId);
    expect(again.sent).toBe(false);
    expect(app.store.getClaimAutopilot(claimId).reportSentAt).toBe(first);
  });

  it("report includes parties, total, decision and payout", async () => {
    app = makeApp();
    app.seedDemo();
    const claimId = bikeClaimId(app);
    await app.runAutopilot(claimId, { placedBy: "fixture" });
    app.sanctionClaim(claimId, {
      decidedBy: "Priya",
      decision: "approved",
      sanctionedAmount: 2450,
      currency: "USD",
    });
    await app.payoutClaim(claimId);

    const report = app.buildReportFor(claimId)!;
    expect(report.structured.callsMade).toBeGreaterThanOrEqual(3);
    expect(report.structured.decision).toBe("approved");
    expect(report.structured.payment?.status).toBe("succeeded");
    expect(report.text).toContain("Payout:");
  });
});

describe("payments (Stripe demo)", () => {
  it("pays an approved claim with the simulated gateway and is idempotent", async () => {
    app = makeApp();
    app.seedDemo();
    const claimId = bikeClaimId(app);
    app.sanctionClaim(claimId, {
      decidedBy: "Priya",
      decision: "approved",
      sanctionedAmount: 2450,
      currency: "USD",
    });

    const p1 = await app.payoutClaim(claimId);
    expect(p1.status).toBe("succeeded");
    expect(p1.provider).toBe("simulated");
    expect(p1.amount).toBe(2450);
    expect(p1.currency).toBe("USD");

    const p2 = await app.payoutClaim(claimId);
    expect(p2.id).toBe(p1.id); // no double payout
  });

  it("refuses to pay out a claim that is not approved", async () => {
    app = makeApp();
    app.seedDemo();
    const claimId = bikeClaimId(app);
    await expect(app.payoutClaim(claimId)).rejects.toThrow(/approved/);
  });

  it("createPaymentGateway falls back to simulated without a key", () => {
    expect(createPaymentGateway(makeConfig())).toBeInstanceOf(SimulatedPaymentGateway);
  });
});

describe("notifier", () => {
  it("defaults to a simulated notifier that reports delivery", async () => {
    const notifier = createNotifier(makeConfig());
    expect(notifier).toBeInstanceOf(SimulatedNotifier);
    const res = await notifier.send({ title: "t", text: "body" });
    expect(res.delivered).toBe(true);
    expect(res.channel).toBe("simulated");
  });

  it("selects Slack when a Slack webhook is configured", () => {
    const notifier = createNotifier(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/services/x" }),
    );
    expect(notifier).toBeInstanceOf(SlackNotifier);
    expect(notifier.channel).toBe("slack");
  });
});
