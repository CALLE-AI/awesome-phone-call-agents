/**
 * T3.4 Deno tests for deliver-telegram.ts.
 * Split from the owns file so MCP can land the module.
 * Pin with:
 * `deno test --allow-read supabase/functions/_shared/deliver-telegram.ts supabase/functions/_shared/deliver-telegram_tests.ts`
 */
import {
  DELIVERY_CHANNEL_TELEGRAM,
  DELIVERY_KIND_PATTERN,
  DELIVERY_KIND_POST_CALL,
  capturedTextsFromStructured,
  containsCallToAction,
  deliverPatternTelegram,
  deliverPostCallTelegram,
  formatPostCallMessage,
  retiredItemIdsFromStructured,
  type DeliverTelegramDeps,
} from "./deliver-telegram.ts";

type RestProfileRow = {
  id: string;
  telegram_chat_id: number | null;
  telegram_receipts: boolean;
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
  deliveries: RestDeliveryRow[];
  telegramCalls: Array<{ url: string; body: string }>;
  restCalls: Array<{ method: string; url: string; body: string }>;
  telegramOk: boolean;
};

function createMockFetch(state: MockState): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    if (url.includes("supabase.co")) throw new Error("must not use the project host");
    if (url.includes("/rest/v1/")) state.restCalls.push({ method, url, body });
    if (url.includes("/rest/v1/profiles") && method === "GET") {
      if (state.profile === null) {
        return new Response(JSON.stringify([]), { headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify([state.profile]), { headers: { "content-type": "application/json" } });
    }
    if (url.includes("/rest/v1/deliveries") && method === "POST") {
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
      const idMatch = url.match(/id=eq\.([^&]+)/);
      const id = idMatch ? decodeURIComponent(idMatch[1]) : "";
      const patch = JSON.parse(body) as { sent_at?: string | null; error?: string | null };
      const row = state.deliveries.find((d) => d.id === id);
      if (!row) return new Response("missing", { status: 404 });
      if ("sent_at" in patch) row.sent_at = patch.sent_at ?? null;
      if ("error" in patch) row.error = patch.error ?? null;
      return new Response(null, { status: 204 });
    }
    if (url.includes("api.telegram.org") && url.includes("/sendMessage")) {
      state.telegramCalls.push({ url, body });
      if (!state.telegramOk) return new Response("fail", { status: 500 });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as typeof fetch;
}

function baseDeps(state: MockState): DeliverTelegramDeps {
  return {
    apiUrl: "https://orma-api.nryn.dev",
    serviceRoleKey: "service-role-test-value",
    botToken: "bot-token-test",
    fetch: createMockFetch(state),
    nowIso: () => "2026-09-12T12:00:00.000Z",
    newId: () => "d0000000-0000-4000-8000-000000000001",
  };
}

function enabledState(userId: string, chatId: number): MockState {
  return {
    profile: { id: userId, telegram_chat_id: chatId, telegram_receipts: true },
    deliveries: [],
    telegramCalls: [],
    restCalls: [],
    telegramOk: true,
  };
}

const testFn = (Deno as { test?: (name: string, fn: () => void | Promise<void>) => void }).test;

if (typeof testFn === "function" && !import.meta.main) {
  const userId = "00000000-0000-4000-8000-00000000000a";
  const callRunId = "10000000-0000-4000-8000-000000000001";
  const chatId = 424242;

  testFn("disabled receipts skip send and write no deliveries row", async () => {
    const state = enabledState(userId, chatId);
    state.profile!.telegram_receipts = false;
    const result = await deliverPostCallTelegram(
      { userId, callRunId, capturedTexts: ["Continental"], retiredTexts: ["book the dentist"] },
      baseDeps(state),
    );
    if (result.status !== "skipped" || result.reason !== "receipts_disabled") {
      throw new Error(`expected skipped receipts_disabled, got ${JSON.stringify(result)}`);
    }
    if (state.telegramCalls.length !== 0 || state.deliveries.length !== 0) {
      throw new Error("disabled receipts must send nothing and write nothing");
    }
  });

  testFn("missing chat id skips send and writes no deliveries row", async () => {
    const state = enabledState(userId, chatId);
    state.profile!.telegram_chat_id = null;
    const result = await deliverPostCallTelegram(
      { userId, callRunId, capturedTexts: ["Continental"], retiredTexts: [] },
      baseDeps(state),
    );
    if (result.status !== "skipped" || result.reason !== "no_chat_id") {
      throw new Error("expected skipped no_chat_id");
    }
    if (state.telegramCalls.length !== 0 || state.deliveries.length !== 0) {
      throw new Error("no_chat_id must send nothing and write nothing");
    }
  });

  testFn("enabled post-call inserts deliveries then sends Telegram", async () => {
    const state = enabledState(userId, chatId);
    const result = await deliverPostCallTelegram(
      { userId, callRunId, capturedTexts: ["Continental"], retiredTexts: ["book the dentist"] },
      baseDeps(state),
    );
    if (result.status !== "sent") throw new Error(`expected sent, got ${JSON.stringify(result)}`);
    if (state.deliveries.length !== 1) throw new Error("expected one delivery");
    const row = state.deliveries[0];
    if (row.sent_at !== "2026-09-12T12:00:00.000Z") throw new Error("sent_at must be set");
    if (row.error !== null) throw new Error("error must stay null");
    if (row.kind !== DELIVERY_KIND_POST_CALL) throw new Error("kind must be post_call");
    if (row.channel !== DELIVERY_CHANNEL_TELEGRAM) throw new Error("channel must be telegram");
    if (row.call_run_id !== callRunId) throw new Error("call_run_id must be stored");
    if (state.telegramCalls.length !== 1) throw new Error("must send one Telegram message");
    const tgBody = JSON.parse(state.telegramCalls[0].body) as { chat_id: number; text: string };
    if (tgBody.chat_id !== chatId) throw new Error("chat_id must match");
    if (!tgBody.text.includes("Continental")) throw new Error("must name capture");
    if (!tgBody.text.includes("book the dentist")) throw new Error("must name retirement");
    if (containsCallToAction(tgBody.text)) throw new Error("must not contain CTA");
    const insert = state.restCalls.find((c) => c.method === "POST" && c.url.includes("/rest/v1/deliveries"));
    if (!insert) throw new Error("must POST deliveries before send");
    if (!insert.url.startsWith("https://orma-api.nryn.dev/rest/v1/")) throw new Error("must use ORMA_API_URL");
    if (insert.body.includes("service-role-test-value")) throw new Error("key must not appear in body");
  });

  testFn("telegram failure records error on the deliveries row", async () => {
    const state = enabledState(userId, chatId);
    state.telegramOk = false;
    const result = await deliverPostCallTelegram(
      { userId, callRunId, capturedTexts: ["Continental"], retiredTexts: [] },
      baseDeps(state),
    );
    if (result.status !== "failed") throw new Error(`expected failed, got ${result.status}`);
    const row = state.deliveries[0];
    if (row.sent_at !== null) throw new Error("sent_at must stay null");
    if (!row.error || !row.error.includes("telegram")) throw new Error("error must mention telegram");
  });

  testFn("fixture completed run names captured text and empty retirements", async () => {
    const structured = {
      captured_items: [{ text: "Continental", evidence_offset_seconds: 44 }],
      retired_items: [] as Array<{ item_id: string; evidence_offset_seconds: number }>,
      commitments: [],
      mood: "unknown",
      slot_change_requested: "no",
    };
    const captured = capturedTextsFromStructured(structured);
    const retiredIds = retiredItemIdsFromStructured(structured);
    if (captured[0] !== "Continental" || retiredIds.length !== 0) {
      throw new Error("fixture extracts must match call-completed.json shape");
    }
    const text = formatPostCallMessage({ capturedTexts: captured, retiredTexts: [] });
    if (!text.includes("Continental") || !text.includes("Retired: none")) {
      throw new Error("summary must name capture and empty retirements");
    }
    if (containsCallToAction(text)) throw new Error("fixture summary must not contain CTA");
    const state = enabledState(userId, chatId);
    const result = await deliverPostCallTelegram(
      { userId, callRunId, capturedTexts: captured, retiredTexts: [] },
      baseDeps(state),
    );
    if (result.status !== "sent") throw new Error("fixture path must send");
    if (state.deliveries[0].payload.text !== text) throw new Error("payload text mismatch");
  });

  testFn("post-call message names captures and retirements without CTA", () => {
    const text = formatPostCallMessage({
      capturedTexts: ["renew the passport", "call Amma"],
      retiredTexts: ["book the dentist"],
    });
    if (!text.includes("renew the passport") || !text.includes("call Amma")) {
      throw new Error("must name captures");
    }
    if (!text.includes("book the dentist")) throw new Error("must name retirement");
    if (containsCallToAction(text) || text.includes("?")) throw new Error("must not ask or chase");
  });

  testFn("pattern delivery sends prose and records outcome", async () => {
    const prose = "You mentioned the dentist three times across the week. Nothing was retired.";
    const state = enabledState(userId, chatId);
    const result = await deliverPatternTelegram({ userId, prose }, baseDeps(state));
    if (result.status !== "sent") throw new Error(`expected sent, got ${result.status}`);
    if (state.deliveries[0].kind !== DELIVERY_KIND_PATTERN) throw new Error("kind must be pattern");
    if (state.deliveries[0].call_run_id !== null) throw new Error("call_run_id must be null");
    const tgText = (JSON.parse(state.telegramCalls[0].body) as { text: string }).text;
    if (!tgText.includes(prose)) throw new Error("pattern message must carry prose");
    if (containsCallToAction(tgText)) throw new Error("pattern message must not contain CTA");
  });

  testFn("sent_at update failure still returns sent after Telegram success", async () => {
    const state = enabledState(userId, chatId);
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
    const result = await deliverPostCallTelegram(
      { userId, callRunId, capturedTexts: ["Continental"], retiredTexts: [] },
      deps,
    );
    if (result.status !== "sent") throw new Error(`expected sent, got ${result.status}`);
    if (state.telegramCalls.length !== 1) throw new Error("telegram must run once");
    if (state.deliveries[0].error !== null) throw new Error("must not mark error after telegram success");
  });

  testFn("insert happens before telegram even when send fails", async () => {
    const state = enabledState(userId, chatId);
    state.telegramOk = false;
    await deliverPostCallTelegram(
      { userId, callRunId, capturedTexts: ["x"], retiredTexts: [] },
      baseDeps(state),
    );
    const methods = state.restCalls.map((c) => c.method);
    if (methods[0] !== "GET" || methods[1] !== "POST" || methods[2] !== "PATCH") {
      throw new Error(`unexpected rest order ${methods.join(",")}`);
    }
    if (state.deliveries.length !== 1 || state.telegramCalls.length !== 1) {
      throw new Error("failed send must leave a row and attempt telegram");
    }
  });

  testFn("post-call message names commitments only when present", () => {
    const withCommitments = formatPostCallMessage({
      capturedTexts: ["renew the passport"],
      retiredTexts: [],
      committedTexts: ["send Amma the photos"],
    });
    if (!withCommitments.includes("send Amma the photos")) {
      throw new Error("must name the commitment");
    }
    if (containsCallToAction(withCommitments)) throw new Error("a commitment line must not ask");
    const withoutCommitments = formatPostCallMessage({
      capturedTexts: ["renew the passport"],
      retiredTexts: [],
    });
    if (withoutCommitments.includes("Committed")) {
      throw new Error("a receipt with no commitment must omit the commitment section");
    }
    const emptyCommitments = formatPostCallMessage({
      capturedTexts: ["renew the passport"],
      retiredTexts: [],
      committedTexts: [],
    });
    if (emptyCommitments.includes("Committed")) {
      throw new Error("an empty commitment list must omit the commitment section");
    }
  });
}
