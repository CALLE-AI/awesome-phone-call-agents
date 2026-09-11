import assert from "node:assert/strict";
import test from "node:test";
import { signApproval, verifyApproval } from "../lib/calle/approval.ts";
import { calculateCalleCapabilities } from "../lib/calle/capabilities.ts";
import { createHistoryAccessCredential, hashHistoryAccessToken, historyTokenFromAuthorization } from "../lib/history-access.ts";
import { parseRememberedHistoryAccess, shouldRefreshHistoryRun } from "../lib/history-store.ts";
import {
  buildCallTask,
  createSourcingCallPlan,
  isTerminalExecution,
  parseSourcingRequest,
  type SourcingRequest,
} from "../lib/calle/contracts.ts";
import { executeFixture } from "../lib/calle/fixtures.ts";
import { executeSourcingPlan, getSourcingExecution, safeCalleBaseUrl } from "../lib/calle/server.ts";
import {
  assertAuthorizedLiveRecipients,
  isAuthorizedLiveOperator,
  liveRecipientAllowlist,
} from "../lib/live-security.ts";
import { FICTIONAL_FIXTURE_PHONES, SUPPORTED_MARKETS, supportsMarketLocale } from "../lib/markets.ts";

const request: SourcingRequest = {
  executionMode: "fixture",
  recipientConsentConfirmed: false,
  authorizedCallWindow: "No live call — fixture",
  vehicle: "2014 Toyota Fielder",
  part: "front-left wheel bearing",
  fitmentReference: "NKE165-705K9",
  budgetAmount: 8000,
  currency: "KES",
  deliveryLocation: "Nairobi CBD",
  neededBy: "today",
  countryCode: "KE",
  locale: "en-KE",
  suppliers: [
    { id: "supplier-1", name: "Example Auto One", phone: FICTIONAL_FIXTURE_PHONES[0] },
    { id: "supplier-2", name: "Example Auto Two", phone: FICTIONAL_FIXTURE_PHONES[1] },
  ],
};

test("validates global sourcing inputs and E.164 suppliers", () => {
  assert.deepEqual(parseSourcingRequest(request), request);
  assert.throws(
    () => parseSourcingRequest({ ...request, suppliers: [{ ...request.suppliers[0], phone: "0700000001" }] }),
    /E\.164/,
  );
  assert.throws(
    () => parseSourcingRequest({ ...request, suppliers: [request.suppliers[0], request.suppliers[0]] }),
    /unique/,
  );
  assert.throws(() => parseSourcingRequest({ ...request, countryCode: "NZ", locale: "en-NZ" }), /not currently supported/);
  assert.throws(() => parseSourcingRequest({ ...request, locale: "sw-KE" }), /not a supported CALL-E language/);
  assert.throws(
    () => parseSourcingRequest({ ...request, executionMode: "live", authorizedCallWindow: "17 Aug, 3–4 PM EAT" }),
    /directly consented/i,
  );
  assert.throws(
    () => parseSourcingRequest({ ...request, executionMode: "live", recipientConsentConfirmed: true, authorizedCallWindow: "" }),
    /authorizedCallWindow is required/,
  );
});

test("exposes live calling only when every trusted runtime binding is present", () => {
  const liveSecurity = {
    SPARESCOUT_OPERATOR_TOKEN: "o".repeat(43),
    SPARESCOUT_LIVE_RECIPIENT_ALLOWLIST: FICTIONAL_FIXTURE_PHONES.join(","),
  };
  assert.deepEqual(calculateCalleCapabilities({}), { fixtureAvailable: true, liveAvailable: false });
  assert.equal(calculateCalleCapabilities({ CALLE_MODE: "live", CALLE_API_KEY: "calle_test_key" }).liveAvailable, false);
  assert.equal(calculateCalleCapabilities({ CALLE_MODE: "fixture", CALLE_API_KEY: "calle_test_key", SPARESCOUT_APPROVAL_SECRET: "test-secret" }).liveAvailable, false);
  assert.equal(calculateCalleCapabilities({ CALLE_MODE: "live", CALLE_API_KEY: "calle_test_key", SPARESCOUT_APPROVAL_SECRET: "test-secret" }).liveAvailable, false);
  assert.equal(calculateCalleCapabilities({
    CALLE_MODE: "live",
    CALLE_API_KEY: "calle_test_key",
    SPARESCOUT_APPROVAL_SECRET: "test-secret",
    ...liveSecurity,
  }).liveAvailable, true);
});

test("requires operator authentication and an exact server-side live recipient allowlist", async () => {
  const bindings = {
    SPARESCOUT_OPERATOR_TOKEN: "operator-secret-with-at-least-32-characters",
    SPARESCOUT_LIVE_RECIPIENT_ALLOWLIST: FICTIONAL_FIXTURE_PHONES.join(","),
  };
  assert.equal(await isAuthorizedLiveOperator(`Bearer ${bindings.SPARESCOUT_OPERATOR_TOKEN}`, bindings), true);
  assert.equal(await isAuthorizedLiveOperator("Bearer wrong-token-with-at-least-32-characters", bindings), false);
  assert.equal(liveRecipientAllowlist(bindings.SPARESCOUT_LIVE_RECIPIENT_ALLOWLIST).size, 3);
  assert.doesNotThrow(() => assertAuthorizedLiveRecipients(request.suppliers, bindings));
  assert.throws(
    () => assertAuthorizedLiveRecipients([{ ...request.suppliers[0], phone: "+12025550199" }], bindings),
    /pre-authorized/i,
  );
});

test("issues separate high-entropy credentials for private durable history", async () => {
  const first = await createHistoryAccessCredential();
  const second = await createHistoryAccessCredential();
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.equal(await hashHistoryAccessToken(first.token), first.hash);
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.hash, second.hash);
  assert.equal(historyTokenFromAuthorization(`Bearer ${first.token}`), first.token);
  assert.equal(historyTokenFromAuthorization(first.token), null);
  assert.equal(historyTokenFromAuthorization("Bearer short"), null);
});

test("accepts only bounded, well-formed browser history capabilities", () => {
  const valid = {
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    token: "a".repeat(43),
    savedAt: "2026-08-17T12:00:00.000Z",
  };
  assert.deepEqual(parseRememberedHistoryAccess(JSON.stringify([valid])), [valid]);
  assert.deepEqual(parseRememberedHistoryAccess("not-json"), []);
  assert.deepEqual(parseRememberedHistoryAccess(JSON.stringify([{ ...valid, token: "short" }])), []);
  assert.equal(parseRememberedHistoryAccess(JSON.stringify(Array(25).fill(valid))).length, 20);
});

test("resumes only non-terminal live history runs", () => {
  assert.equal(shouldRefreshHistoryRun({ mode: "live", status: "queued" }), true);
  assert.equal(shouldRefreshHistoryRun({ mode: "live", status: "in_progress" }), true);
  assert.equal(shouldRefreshHistoryRun({ mode: "live", status: "completed" }), false);
  assert.equal(shouldRefreshHistoryRun({ mode: "fixture", status: "queued" }), false);
});

test("defines a valid localized configuration for every supported CALL-E market", () => {
  assert.equal(SUPPORTED_MARKETS.length, 17);
  for (const market of SUPPORTED_MARKETS) {
    assert.match(market.countryCode, /^[A-Z]{2}$/);
    assert.match(market.currency, /^[A-Z]{3}$/);
    assert.equal(supportsMarketLocale(market.countryCode, market.defaultLocale), true);
    assert.equal(market.fixturePhones.length, 3);
    for (const phone of market.fixturePhones) assert.match(phone, /^\+[1-9]\d{7,14}$/);
    assert.deepEqual(market.fixturePhones, FICTIONAL_FIXTURE_PHONES);
  }
});

test("builds a disclosed, information-only call task", () => {
  const task = buildCallTask(request);
  assert.match(task, /disclose that you are an AI assistant/i);
  assert.match(task, /do not reserve, order, purchase, pay for, or commit/i);
  assert.match(task, /Do not accept a substitute part/i);
  assert.match(task, /medical, legal, financial, or emergency advice/i);
  assert.match(task, /KES 8000/);
});

test("binds live calls to a direct-consent attestation and authorized window", () => {
  const liveRequest: SourcingRequest = {
    ...request,
    executionMode: "live",
    recipientConsentConfirmed: true,
    authorizedCallWindow: "17 August 2026, 3:00–4:00 PM EAT",
  };
  const task = buildCallTask(liveRequest);
  assert.match(task, /directly consented/i);
  assert.match(task, /17 August 2026, 3:00–4:00 PM EAT/);
  assert.match(task, /withdraws consent/i);
});

test("blocks a live SDK request when the signed plan lacks consent evidence", async () => {
  let providerRequested = false;
  const unconsentedPlan = createSourcingCallPlan({ ...request, executionMode: "live" });
  await assert.rejects(
    () => executeSourcingPlan(unconsentedPlan, "approved-plan-token", {
      mode: "live",
      apiKey: "calle_test_key",
      fetch: async () => {
        providerRequested = true;
        throw new Error("Provider request should not occur.");
      },
    }),
    /recipient consent and the authorized call window are missing/i,
  );
  assert.equal(providerRequested, false);
});

test("requires an untampered, unexpired approval", async () => {
  const now = new Date("2026-08-17T08:00:00.000Z");
  const plan = createSourcingCallPlan(request, now);
  const secret = "a-long-test-secret-for-sparescout";
  const token = await signApproval(plan, secret);
  const verified = await verifyApproval(token, secret, now);
  assert.equal(verified.id, plan.id);
  assert.equal(verified.request.suppliers[0].phone, "[server-held]");
  assert.equal(token.includes(request.suppliers[0].phone), false);
  await assert.rejects(() => verifyApproval(`${token}x`, secret, now), /invalid/);
  await assert.rejects(
    () => verifyApproval(token, secret, new Date("2026-08-17T08:16:00.000Z")),
    /expired/,
  );
});

test("restricts credential-bearing CALL-E requests to the official origin or loopback", () => {
  assert.equal(safeCalleBaseUrl(), "https://api.heycall-e.com");
  assert.equal(safeCalleBaseUrl("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  assert.throws(() => safeCalleBaseUrl("https://attacker.example"), /official HTTPS API origin/i);
  assert.throws(() => safeCalleBaseUrl("https://api.heycall-e.com.evil.example"), /official HTTPS API origin/i);
  assert.throws(() => safeCalleBaseUrl("https://api.heycall-e.com/proxy"), /must not contain a path/i);
});

test("returns deterministic structured fixture quotes without a call", () => {
  const execution = executeFixture(createSourcingCallPlan(request));
  assert.equal(execution.mode, "fixture");
  assert.equal(execution.status, "completed");
  assert.equal(execution.quotes.length, 2);
  assert.equal(execution.quotes[0].result?.currency, "KES");
  assert.match(String(execution.quotes[0].evidence[0]), /NKE165-705K9/);
});

test("keeps reserved fixture recipients outside the provider adapter", async () => {
  let providerRequested = false;
  const execution = await executeSourcingPlan(createSourcingCallPlan(request), "fixture-plan-token", {
    mode: "live",
    apiKey: "calle_test_key",
    fetch: async () => {
      providerRequested = true;
      throw new Error("Fixture execution must not reach the provider.");
    },
  });
  assert.equal(execution.mode, "fixture");
  assert.equal(providerRequested, false);
});

test("recognizes every terminal CALL-E state", () => {
  const base = executeFixture(createSourcingCallPlan(request));
  assert.equal(isTerminalExecution(base), true);
  assert.equal(isTerminalExecution({ ...base, status: "failed" }), true);
  assert.equal(isTerminalExecution({ ...base, status: "canceled" }), true);
  assert.equal(isTerminalExecution({ ...base, status: "queued" }), false);
  assert.equal(isTerminalExecution({ ...base, status: "in_progress" }), false);
});

test("uses the official SDK with schemas and an idempotency key in live mode", async () => {
  let outbound: Request | undefined;
  const livePlan = createSourcingCallPlan({
    ...request,
    executionMode: "live",
    recipientConsentConfirmed: true,
    authorizedCallWindow: "17 August 2026, 3:00–4:00 PM EAT",
  });
  const execution = await executeSourcingPlan(livePlan, "approved-plan-token", {
    mode: "live",
    apiKey: "calle_test_key",
    fetch: async (candidate) => {
      outbound = candidate;
      return Response.json(
        {
          id: "call_test_123",
          object: "call_task",
          status: "queued",
          task: livePlan.task,
          recipients: request.suppliers.map((supplier, index) => ({
            id: `recipient_${index + 1}`,
            phones: [supplier.phone],
            locale: request.locale,
            region: request.countryCode,
            status: "pending",
            structured_result: null,
            summary: null,
            attempts: [],
          })),
          structured_result: null,
          summary: null,
          task_completed: null,
          completion_confidence: null,
          evidence: [],
          metadata: { sparescout_plan_id: livePlan.id },
          failure_code: null,
          failure_message: null,
          created_at: "2026-08-17T08:00:00.000Z",
          completed_at: null,
        },
        { status: 201 },
      );
    },
  });

  assert.equal(execution.mode, "live");
  assert.equal(execution.callId, "call_test_123");
  assert.ok(outbound);
  assert.equal(outbound.headers.get("authorization"), "Bearer calle_test_key");
  assert.match(outbound.headers.get("idempotency-key") ?? "", /^sparescout_/);

  const body = await outbound.clone().json() as Record<string, unknown>;
  assert.equal((body.recipients as unknown[]).length, 2);
  assert.ok(body.result_schema);
  assert.ok(body.recipient_result_schema);
});

test("polls an existing CALL-E run without starting another call", async () => {
  let outbound: Request | undefined;
  const execution = await getSourcingExecution("call_existing_123", request.suppliers, {
    mode: "live",
    apiKey: "calle_test_key",
    fetch: async (candidate) => {
      outbound = candidate;
      return Response.json({
        id: "call_existing_123",
        object: "call_task",
        status: "completed",
        task: "source a part",
        recipients: request.suppliers.map((supplier, index) => ({
          id: `recipient_${index + 1}`,
          phones: [supplier.phone],
          locale: request.locale,
          region: request.countryCode,
          status: "completed",
          structured_result: {
            part_found: true,
            compatibility: "confirmed",
            brand: "SKF",
            condition: "new",
            price_amount: 6500,
            currency: "KES",
            available_quantity: 1,
            delivery_available: "yes",
            delivery_eta: "today",
            reservation_possible: "yes",
            evidence: ["Supplier confirmed the fitment reference."],
            notes: "",
          },
          summary: "Quote collected.",
          attempts: [],
        })),
        structured_result: { suppliers_contacted: 2, quotes_received: 2, compatible_quotes: 2 },
        summary: "Two compatible quotes collected.",
        task_completed: true,
        completion_confidence: { score: 0.96, label: "high" },
        evidence: ["Two suppliers provided compatible quotes."],
        metadata: { sparescout_plan_id: "request-123" },
        failure_code: null,
        failure_message: null,
        created_at: "2026-08-17T08:00:00.000Z",
        completed_at: "2026-08-17T08:04:00.000Z",
      });
    },
  });

  assert.ok(outbound);
  assert.equal(outbound.method, "GET");
  assert.match(outbound.url, /call_existing_123$/);
  assert.equal(execution.status, "completed");
  assert.equal(execution.quotes.length, 2);
  assert.equal(execution.quotes[0].supplierId, request.suppliers[0].id);
});
