import { afterEach, describe, expect, it } from "vitest";
import type { ClaimLineApp } from "../src/app.js";
import { buildServer } from "../src/server/app.js";
import { makeApp } from "./helpers.js";

let app: ClaimLineApp;

afterEach(() => {
  app?.close();
});

describe("HTTP server", () => {
  it("reports health and seeds via the API", async () => {
    app = makeApp();
    const server = buildServer(app);

    const health = await server.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true, mode: "fixture" });

    const seed = await server.inject({ method: "POST", url: "/api/seed" });
    expect(seed.json().claims.length).toBe(3);
    await server.close();
  });

  it("dispatches, then processes a webhook wake-signal to a verified result", async () => {
    app = makeApp();
    const server = buildServer(app);
    const { claims } = (await server.inject({ method: "POST", url: "/api/seed" })).json();
    const claimId = claims.find((c: { reference: string }) => c.reference === "CLM-1001").id;

    const dispatch = await server.inject({
      method: "POST",
      url: `/api/claims/${claimId}/dispatch`,
      payload: { callType: "fnol_intake", confirm: true, fixtureScenario: "fnol_ok" },
    });
    const callId = dispatch.json().intent.callId;
    expect(callId).toBeTruthy();

    const webhook = await server.inject({
      method: "POST",
      url: "/calle/webhook",
      payload: { id: "evt_1", type: "call.completed", data: { id: callId } },
    });
    expect(webhook.json()).toEqual({ ok: true, duplicate: false });

    const view = (await server.inject({ method: "GET", url: `/api/claims/${claimId}` })).json();
    const fnol = view.intents.find(
      (i: { intent: { callType: string } }) => i.intent.callType === "fnol_intake",
    );
    expect(fnol.intent.state).toBe("terminal_verified");
    await server.close();
  });

  it("rejects a webhook with a bad secret", async () => {
    app = makeApp({ webhookSecret: "s3cret" });
    const server = buildServer(app);
    const res = await server.inject({
      method: "POST",
      url: "/calle/webhook",
      payload: { data: { id: "call_x" } },
    });
    expect(res.statusCode).toBe(401);
    await server.close();
  });

  it("masks phone numbers in the JSON API", async () => {
    app = makeApp();
    const server = buildServer(app);
    await server.inject({ method: "POST", url: "/api/seed" });
    const res = await server.inject({ method: "GET", url: "/api/claims" });
    const body = res.body;
    // Full seeded numbers must never appear in the API response.
    expect(body).not.toContain("2025550142");
    expect(body).not.toContain("2025550188");
    const json = res.json();
    expect(json.claims[0].claim.claimantPhone).toMatch(/^\+\*/);
    await server.close();
  });

  it("renders the dashboard HTML", async () => {
    app = makeApp();
    const server = buildServer(app);
    const res = await server.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("ClaimLine");
    await server.close();
  });

  it("serves the multi-page routes", async () => {
    app = makeApp();
    app.seedDemo();
    const server = buildServer(app);
    for (const url of ["/", "/customers", "/claims", "/submit", "/how"]) {
      const res = await server.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["content-type"], url).toContain("text/html");
    }
    // customer + claim detail pages
    const customers = app.listCustomers();
    const cRes = await server.inject({
      method: "GET",
      url: `/customers/${customers[0]!.id}`,
    });
    expect(cRes.statusCode).toBe(200);
    const claims = app.listCaseViews();
    const clRes = await server.inject({
      method: "GET",
      url: `/claims/${claims[0]!.claim.id}`,
    });
    expect(clRes.statusCode).toBe(200);
    await server.close();
  });

  it("submits a new claim for a customer and redirects to the claim page", async () => {
    app = makeApp();
    app.seedDemo();
    const server = buildServer(app);
    const customer = app.listCustomers()[0]!;
    const before = app.listCaseViews().length;
    const res = await server.inject({
      method: "POST",
      url: "/submit",
      payload: {
        customerId: customer.id,
        incidentType: "auto_collision",
        language: "hi",
        doctor_name: "Dr. Test",
        doctor_phone: "+919812345699",
      },
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toMatch(/^\/claims\//);
    expect(app.listCaseViews().length).toBe(before + 1);
    await server.close();
  });

  it("serves the flow diagram PNG", async () => {
    app = makeApp();
    const server = buildServer(app);
    const res = await server.inject({ method: "GET", url: "/assets/calle-flow.png" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    await server.close();
  });

  it("serves the new-customer page (not shadowed by /customers/:id)", async () => {
    app = makeApp();
    const server = buildServer(app);
    const res = await server.inject({ method: "GET", url: "/customers/new" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("New customer");
    await server.close();
  });

  it("onboards a new customer with a first policy and redirects to their page", async () => {
    app = makeApp();
    const server = buildServer(app);
    const before = app.listCustomers().length;
    const res = await server.inject({
      method: "POST",
      url: "/customers",
      payload: {
        name: "Asha Verma",
        phone: "+919812345699",
        email: "asha@example.com",
        language: "hi",
        policyNumber: "POL-AUTO-2001",
        policyType: "auto",
        coverageLimit: "500000",
        currency: "INR",
      },
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toMatch(/^\/customers\//);
    expect(app.listCustomers().length).toBe(before + 1);
    const created = app.listCustomers().find((c) => c.name === "Asha Verma")!;
    const view = app.getCustomerView(created.id)!;
    expect(view.policies.length).toBe(1);
    expect(view.policies[0]!.policyNumber).toBe("POL-AUTO-2001");
    await server.close();
  });

  it("rejects a new customer with an invalid phone number", async () => {
    app = makeApp();
    const server = buildServer(app);
    const res = await server.inject({
      method: "POST",
      url: "/customers",
      payload: { name: "No Phone", phone: "not-a-number" },
    });
    expect(res.statusCode).toBe(400);
    await server.close();
  });
});
