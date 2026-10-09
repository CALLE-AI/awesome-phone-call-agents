/**
 * T7.4 Deno tests for receipt.ts.
 * Pin with:
 * `deno test --allow-read supabase/functions/_shared/receipt.ts supabase/functions/_shared/receipt_tests.ts`
 */
import { loadCallFixtures } from "./fixtures.ts";
import {
  capturedTextsFromStructured,
  containsCallToAction,
  type DeliverTelegramDeps,
} from "./deliver-telegram.ts";
import { deliverIngestionReceipt } from "./receipt.ts";

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
  profile: RestProfileRow;
  deliveries: RestDeliveryRow[];
  telegramTexts: string[];
};

function createMockFetch(state: MockState): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    if (url.includes("supabase.co")) throw new Error("must not use the project host");
    if (url.includes("/rest/v1/profiles") && method === "GET") {
      return new Response(JSON.stringify([state.profile]), {
        headers: { "content-type": "application/json" },
      });
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
      return new Response(JSON.stringify([row]), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/deliveries") && method === "PATCH") {
      return new Response(null, { status: 204 });
    }
    if (url.includes("api.telegram.org") && url.includes("/sendMessage")) {
      const parsed = JSON.parse(body) as { text: string };
      state.telegramTexts.push(parsed.text);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as typeof fetch;
}

function depsFor(state: MockState): DeliverTelegramDeps {
  return {
    apiUrl: "https://orma-api.nryn.dev",
    serviceRoleKey: "service-role-test-value",
    botToken: "bot-token-test",
    fetch: createMockFetch(state),
    nowIso: () => "2026-09-12T12:00:00.000Z",
    newId: () => "d0000000-0000-4000-8000-000000000001",
  };
}

const testFn = (Deno as { test?: (name: string, fn: () => void | Promise<void>) => void }).test;

if (typeof testFn === "function" && !import.meta.main) {
  const userId = "00000000-0000-4000-8000-00000000000a";
  const callRunId = "10000000-0000-4000-8000-000000000001";

  testFn("completed fixture receipt names captured text and no CTA", async () => {
    const fixtures = await loadCallFixtures();
    const captured = capturedTextsFromStructured(fixtures.completed.structured_result);
    if (captured[0] !== "Continental") {
      throw new Error("fixture captured text must stay Continental");
    }
    const state: MockState = {
      profile: { id: userId, telegram_chat_id: 424242, telegram_receipts: true },
      deliveries: [],
      telegramTexts: [],
    };
    const result = await deliverIngestionReceipt(
      {
        userId,
        callRunId,
        structured: fixtures.completed.structured_result,
      },
      depsFor(state),
    );
    if (result.status !== "sent") throw new Error(`expected sent, got ${result.status}`);
    const text = state.telegramTexts[0] ?? "";
    if (!text.includes("Continental")) throw new Error("receipt must name the fixture capture");
    if (!text.includes("Retired: none")) throw new Error("empty retirements must read as none");
    if (containsCallToAction(text)) throw new Error("receipt must not ask or chase");
    if (!state.deliveries[0].payload || state.deliveries[0].kind !== "post_call") {
      throw new Error("deliveries row must be a post_call receipt");
    }
  });

  testFn("failed fixture still sends a receipt that names nothing", async () => {
    const fixtures = await loadCallFixtures();
    const state: MockState = {
      profile: { id: userId, telegram_chat_id: 424242, telegram_receipts: true },
      deliveries: [],
      telegramTexts: [],
    };
    const result = await deliverIngestionReceipt(
      {
        userId,
        callRunId,
        structured: fixtures.failed.structured_result,
      },
      depsFor(state),
    );
    if (result.status !== "sent") throw new Error(`expected sent, got ${result.status}`);
    const text = state.telegramTexts[0] ?? "";
    if (!text.includes("Captured: none") || !text.includes("Retired: none")) {
      throw new Error("a null structured result must name none rather than fail");
    }
    if (containsCallToAction(text)) throw new Error("failed-run receipt must not ask");
  });

  testFn("retired item ids resolve to caller-supplied texts", async () => {
    const itemId = "item-dentist";
    const state: MockState = {
      profile: { id: userId, telegram_chat_id: 424242, telegram_receipts: true },
      deliveries: [],
      telegramTexts: [],
    };
    const result = await deliverIngestionReceipt(
      {
        userId,
        callRunId,
        structured: {
          captured_items: [],
          retired_items: [{ item_id: itemId, evidence_offset_seconds: 10 }],
        },
        resolveRetiredText: async (id) => (id === itemId ? "book the dentist" : null),
      },
      depsFor(state),
    );
    if (result.status !== "sent") throw new Error(`expected sent, got ${result.status}`);
    const text = state.telegramTexts[0] ?? "";
    if (!text.includes("book the dentist")) {
      throw new Error("receipt must name the resolved retirement text");
    }
    if (containsCallToAction(text)) throw new Error("resolved retirement must not ask");
  });

  testFn("a completed fixture names captures, retirements and commitments", async () => {
    const committedId = "20000000-0000-4000-8000-000000000042";
    const fixtures = await loadCallFixtures();
    const structured = {
      ...(fixtures.completed.structured_result as Record<string, unknown>),
      retired_items: [{ item_id: "item-dentist", evidence_offset_seconds: 62 }],
      commitments: [{ item_id: committedId, due: "2026-09-14", evidence_offset_seconds: 80 }],
    };
    const texts: Record<string, string> = {
      "item-dentist": "book the dentist",
      [committedId]: "send Amma the photos",
    };
    const state: MockState = {
      profile: { id: userId, telegram_chat_id: 424242, telegram_receipts: true },
      deliveries: [],
      telegramTexts: [],
    };
    const result = await deliverIngestionReceipt(
      {
        userId,
        callRunId,
        structured,
        resolveRetiredText: async (id) => texts[id] ?? null,
      },
      depsFor(state),
    );
    if (result.status !== "sent") throw new Error(`expected sent, got ${result.status}`);
    const text = state.telegramTexts[0] ?? "";
    if (!text.includes("Continental")) throw new Error("receipt must name the capture");
    if (!text.includes("book the dentist")) throw new Error("receipt must name the retirement");
    if (!text.includes("send Amma the photos")) throw new Error("receipt must name the commitment");
    if (text.includes(committedId)) throw new Error("receipt must not print a raw item id");
    if (containsCallToAction(text)) throw new Error("a commitment must not turn a receipt into a prompt");
  });

  testFn("an invalid result still sends a receipt that reveals no failure", async () => {
    const rawId = "30000000-0000-4000-8000-000000000077";
    const state: MockState = {
      profile: { id: userId, telegram_chat_id: 424242, telegram_receipts: true },
      deliveries: [],
      telegramTexts: [],
    };
    const result = await deliverIngestionReceipt(
      {
        userId,
        callRunId,
        structured: {
          captured_items: "not a list",
          retired_items: [{ item_id: rawId }],
          commitments: [{ item_id: rawId, evidence_offset_seconds: "late" }],
        },
        resolveRetiredText: async () => null,
      },
      depsFor(state),
    );
    if (result.status !== "sent") throw new Error(`expected sent, got ${result.status}`);
    const text = state.telegramTexts[0] ?? "";
    for (const word of ["fail", "error", "invalid", "validation", "extract", "repair"]) {
      if (text.toLowerCase().includes(word)) {
        throw new Error(`an invalid result must not reveal ${word}`);
      }
    }
    if (text.includes(rawId)) throw new Error("an invalid result must not print a raw item id");
    if (containsCallToAction(text)) throw new Error("an invalid result must not ask");
  });
}
