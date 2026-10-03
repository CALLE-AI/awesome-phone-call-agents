/**
 * T7.3 Deno tests for deliver-email.ts.
 * Split from the owns file so MCP can land the module.
 * Pin with:
 * `deno test --allow-read supabase/functions/_shared/deliver-email.ts supabase/functions/_shared/deliver-email_tests.ts`
 */
import {
  DELIVERY_CHANNEL_EMAIL,
  PATTERN_EMAIL_SUBJECT,
  RESEND_ENDPOINT,
  deliverPatternEmail,
  type DeliverEmailDeps,
} from "./deliver-email.ts";
import { DELIVERY_KIND_PATTERN } from "./deliver-telegram.ts";

type RestProfileRow = {
  id: string;
  email_receipts: boolean;
};

type RestDeliveryRow = {
  id: string;
  user_id: string;
  channel: string;
  kind: string;
  call_run_id: string | null;
  payload: Record<string, unknown>;
  sent_at: string | null;
  error: string | null;
};

type MockState = {
  profile: RestProfileRow | null;
  authEmail: string | null;
  authAdminOk: boolean;
  authAdminCalls: Array<{ url: string; apikey: string | null; authorization: string | null }>;
  deliveries: RestDeliveryRow[];
  resendCalls: Array<{ url: string; authorization: string | null; body: string }>;
  restCalls: Array<{ method: string; url: string; body: string }>;
  order: string[];
  resendOk: boolean;
};

function createMockFetch(state: MockState): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    if (url.includes("supabase.co")) throw new Error("must not use the project host");
    if (url.includes("/rest/v1/")) state.restCalls.push({ method, url, body });
    if (url.includes("/rest/v1/profiles") && method === "GET") {
      state.order.push("profiles");
      if (state.profile === null) {
        return new Response(JSON.stringify([]), { headers: { "content-type": "application/json" } });
      }
      const select = new URL(url).searchParams.get("select") ?? "id,email_receipts";
      const source = state.profile as unknown as Record<string, unknown>;
      const projected: Record<string, unknown> = {};
      for (const column of select.split(",").map((c) => c.trim())) {
        if (column !== "") projected[column] = source[column];
      }
      return new Response(JSON.stringify([projected]), { headers: { "content-type": "application/json" } });
    }
    if (url.includes("/rest/v1/deliveries") && method === "POST") {
      state.order.push("deliveries-insert");
      const posted = JSON.parse(body) as RestDeliveryRow;
      const row: RestDeliveryRow = {
        id: posted.id,
        user_id: posted.user_id,
        channel: posted.channel,
        kind: posted.kind,
        call_run_id: posted.call_run_id,
        payload: posted.payload,
        sent_at: null,
        error: null,
      };
      state.deliveries.push(row);
      return new Response(JSON.stringify([row]), { status: 201, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/rest/v1/deliveries") && method === "PATCH") {
      state.order.push("deliveries-patch");
      const idMatch = url.match(/id=eq\.([^&]+)/);
      const id = idMatch ? decodeURIComponent(idMatch[1]) : "";
      const patch = JSON.parse(body) as {
        sent_at?: string | null;
        error?: string | null;
        payload?: Record<string, unknown>;
      };
      const row = state.deliveries.find((d) => d.id === id);
      if (!row) return new Response("missing", { status: 404 });
      if ("sent_at" in patch) row.sent_at = patch.sent_at ?? null;
      if ("error" in patch) row.error = patch.error ?? null;
      if ("payload" in patch) row.payload = patch.payload ?? row.payload;
      return new Response(null, { status: 204 });
    }
    const adminMatch = url.match(/\/auth\/v1\/admin\/users\/([^/?]+)$/);
    if (adminMatch !== null && method === "GET") {
      state.order.push("auth-admin");
      const headers = (init?.headers ?? {}) as Record<string, string>;
      state.authAdminCalls.push({
        url,
        apikey: headers.apikey ?? null,
        authorization: headers.authorization ?? null,
      });
      if (!state.authAdminOk) return new Response("admin read failed", { status: 500 });
      const id = decodeURIComponent(adminMatch[1]);
      return new Response(JSON.stringify({ id, email: state.authEmail }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url === RESEND_ENDPOINT && method === "POST") {
      state.order.push("resend");
      const headers = (init?.headers ?? {}) as Record<string, string>;
      state.resendCalls.push({ url, authorization: headers.authorization ?? null, body });
      if (!state.resendOk) return new Response("fail", { status: 500 });
      return new Response(JSON.stringify({ id: "re_fixture_1" }), {
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as typeof fetch;
}

function baseDeps(state: MockState): DeliverEmailDeps {
  return {
    apiUrl: "https://orma-api.nryn.dev",
    serviceRoleKey: "service-role-test-value",
    resendApiKey: "resend-test-key",
    resendFrom: "Orma <reports@example.com>",
    fetch: createMockFetch(state),
    nowIso: () => "2026-09-14T12:00:00.000Z",
    newId: () => "e0000000-0000-4000-8000-000000000001",
  };
}

function enabledState(userId: string, authEmail: string | null): MockState {
  return {
    profile: { id: userId, email_receipts: true },
    authEmail,
    authAdminOk: true,
    authAdminCalls: [],
    deliveries: [],
    resendCalls: [],
    restCalls: [],
    order: [],
    resendOk: true,
  };
}

const testFn = (Deno as { test?: (name: string, fn: () => void | Promise<void>) => void }).test;

if (typeof testFn === "function" && !import.meta.main) {
  const userId = "00000000-0000-4000-8000-00000000000b";
  const email = "owner@example.com";
  const prose = "You mentioned the dentist three times across the week. Nothing was retired.";

  testFn("disabled email receipts skip send and write no deliveries row", async () => {
    const state = enabledState(userId, email);
    state.profile!.email_receipts = false;
    state.authAdminOk = false;
    const result = await deliverPatternEmail({ userId, prose }, baseDeps(state));
    if (result.status !== "skipped" || result.reason !== "receipts_disabled") {
      throw new Error(`expected skipped receipts_disabled, got ${JSON.stringify(result)}`);
    }
    if (state.authAdminCalls.length !== 0) {
      throw new Error("disabled receipts must not read the auth admin API");
    }
    if (state.resendCalls.length !== 0 || state.deliveries.length !== 0) {
      throw new Error("disabled receipts must send nothing and write nothing");
    }
  });

  testFn("missing email skips send and writes no deliveries row", async () => {
    for (const missing of [null, "   "]) {
      const state = enabledState(userId, email);
      state.authEmail = missing;
      const result = await deliverPatternEmail({ userId, prose }, baseDeps(state));
      if (result.status !== "skipped" || result.reason !== "no_email") {
        throw new Error("expected skipped no_email");
      }
      if (state.authAdminCalls.length !== 1) {
        throw new Error("an enabled profile must read the auth email once");
      }
      if (state.resendCalls.length !== 0 || state.deliveries.length !== 0) {
        throw new Error("a missing address must send nothing and write nothing");
      }
    }
  });

  testFn("enabled pattern inserts deliveries then sends through Resend", async () => {
    const state = enabledState(userId, email);
    const result = await deliverPatternEmail({ userId, prose }, baseDeps(state));
    if (result.status !== "sent") throw new Error(`expected sent, got ${JSON.stringify(result)}`);
    if (state.deliveries.length !== 1) throw new Error("expected one delivery");
    const row = state.deliveries[0];
    if (row.sent_at !== "2026-09-14T12:00:00.000Z") throw new Error("sent_at must be set");
    if (row.error !== null) throw new Error("error must stay null");
    if (row.channel !== DELIVERY_CHANNEL_EMAIL) throw new Error("channel must be email");
    if (row.kind !== DELIVERY_KIND_PATTERN) throw new Error("kind must be pattern");
    if (row.call_run_id !== null) throw new Error("call_run_id must be null");
    if (row.payload.text !== prose) throw new Error("payload text must carry the prose");
    if (row.payload.prose !== prose) throw new Error("payload prose must carry the prose");
    if (row.payload.subject !== PATTERN_EMAIL_SUBJECT) throw new Error("payload must name the subject");
    if ("to" in row.payload) throw new Error("payload must not store the recipient");
    if (row.payload.resend_id !== "re_fixture_1") throw new Error("payload must store the Resend id");
    if (state.resendCalls.length !== 1) throw new Error("must send one Resend request");
    const call = state.resendCalls[0];
    if (call.url !== RESEND_ENDPOINT) throw new Error("must post to the Resend endpoint");
    if (call.authorization !== "Bearer resend-test-key") throw new Error("must authorize with the Resend key");
    const sent = JSON.parse(call.body) as { from: string; to: string[]; subject: string; text: string };
    if (sent.from !== "Orma <reports@example.com>") throw new Error("must send from RESEND_FROM");
    if (JSON.stringify(sent.to) !== JSON.stringify([email])) throw new Error("must send to the auth email");
    if (sent.subject !== PATTERN_EMAIL_SUBJECT) throw new Error("must carry a short subject");
    if (sent.text !== prose) throw new Error("must send the prose as text");
    if (state.order[0] !== "profiles" || state.order[1] !== "auth-admin" ||
      state.order[2] !== "deliveries-insert" || state.order[3] !== "resend" ||
      state.order[4] !== "deliveries-patch") {
      throw new Error(`unexpected order ${state.order.join(",")}`);
    }
    const insert = state.restCalls.find((c) => c.method === "POST" && c.url.includes("/rest/v1/deliveries"));
    if (!insert) throw new Error("must POST deliveries before send");
    if (!insert.url.startsWith("https://orma-api.nryn.dev/rest/v1/")) throw new Error("must use ORMA_API_URL");
    const profilesRead = state.restCalls.find((c) => c.method === "GET" && c.url.includes("/rest/v1/profiles"));
    if (!profilesRead) throw new Error("must read the profile receipt toggle");
    const select = new URL(profilesRead.url).searchParams.get("select") ?? "";
    if (select !== "id,email_receipts") {
      throw new Error("the profile read must select id and email_receipts only");
    }
    if (state.authAdminCalls.length !== 1) throw new Error("must read the auth admin API once");
    const admin = state.authAdminCalls[0];
    if (admin.url !== `https://orma-api.nryn.dev/auth/v1/admin/users/${userId}`) {
      throw new Error(`unexpected admin url ${admin.url}`);
    }
    if (admin.apikey !== "service-role-test-value" ||
      admin.authorization !== "Bearer service-role-test-value") {
      throw new Error("the admin read must use the service role key");
    }
  });

  testFn("Resend failure records error on the deliveries row", async () => {
    const state = enabledState(userId, email);
    state.resendOk = false;
    const result = await deliverPatternEmail({ userId, prose }, baseDeps(state));
    if (result.status !== "failed") throw new Error(`expected failed, got ${result.status}`);
    const row = state.deliveries[0];
    if (row.sent_at !== null) throw new Error("sent_at must stay null");
    if (!row.error || !row.error.includes("resend")) throw new Error("error must mention resend");
    if (row.payload.resend_id !== undefined) throw new Error("a failed send must store no Resend id");
    if (state.deliveries.length !== 1 || state.resendCalls.length !== 1) {
      throw new Error("failed send must leave a row and attempt Resend");
    }
  });

  testFn("a failed auth admin read throws and writes no deliveries row", async () => {
    const state = enabledState(userId, email);
    state.authAdminOk = false;
    let threw = "";
    try {
      await deliverPatternEmail({ userId, prose }, baseDeps(state));
    } catch (error) {
      threw = error instanceof Error ? error.message : "unknown";
    }
    if (threw !== "auth admin user read failed") {
      throw new Error(`expected the admin read to throw, got ${threw || "no throw"}`);
    }
    if (state.deliveries.length !== 0 || state.resendCalls.length !== 0) {
      throw new Error("a failed admin read must write no row and send nothing");
    }
  });

  testFn("sent_at patch failure still returns sent after Resend success", async () => {
    const state = enabledState(userId, email);
    const deps = baseDeps(state);
    const innerFetch = deps.fetch;
    deps.fetch = (async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/rest/v1/deliveries") && method === "PATCH") {
        const body = typeof init?.body === "string" ? init.body : "";
        if (body.includes("sent_at")) return new Response("patch failed", { status: 500 });
      }
      return innerFetch(input, init);
    }) as typeof fetch;
    const result = await deliverPatternEmail({ userId, prose }, deps);
    if (result.status !== "sent") throw new Error(`expected sent, got ${result.status}`);
    if (state.resendCalls.length !== 1) throw new Error("Resend must run once");
    if (state.deliveries[0].error !== null) throw new Error("must not mark error after Resend success");
  });

  testFn("no secret reaches any request body or stored payload", async () => {
    const state = enabledState(userId, email);
    await deliverPatternEmail({ userId, prose }, baseDeps(state));
    const blobs = [
      ...state.restCalls.map((c) => `${c.url} ${c.body}`),
      ...state.resendCalls.map((c) => `${c.url} ${c.body}`),
      JSON.stringify(state.deliveries.map((d) => d.payload)),
    ];
    for (const secret of ["service-role-test-value", "resend-test-key"]) {
      for (const blob of blobs) {
        if (blob.includes(secret)) throw new Error("a secret must never leak into a request or a row");
      }
    }
    for (const call of state.restCalls) {
      if (!call.url.startsWith("https://orma-api.nryn.dev/")) {
        throw new Error("every PostgREST call must use ORMA_API_URL");
      }
    }
    for (const call of state.authAdminCalls) {
      if (!call.url.startsWith("https://orma-api.nryn.dev/auth/v1/admin/users/")) {
        throw new Error("the auth admin read must use ORMA_API_URL");
      }
      if (call.apikey !== "service-role-test-value" ||
        call.authorization !== "Bearer service-role-test-value") {
        throw new Error("the auth admin read must carry the service role key in headers only");
      }
    }
  });
}
