/**
 * T3.2 Telegram text capture.
 *
 * A plain message becomes an `items` row with `source = 'telegram'`.
 * The reply quotes the stored text so a misheard thought is visible at once.
 *
 * A chat with no linked profile gets `START_LINK_PROMPT` from `link.ts`.
 * It never drops that message in silence.
 *
 * Pin linked insert, quoted reply, and unlinked prompt with:
 * `deno test --allow-read supabase/functions/telegram/capture.ts`
 *
 * T3.1 should call `captureTextMessage` for non-command text updates.
 * It should `ctx.reply` with the returned `reply`. Do not edit `index.ts` here.
 */
import { START_LINK_PROMPT } from "./link.ts";

export const ITEM_SOURCE_TELEGRAM = "telegram" as const;

export type CapturedItem = {
  id: string;
  userId: string;
  text: string;
  source: typeof ITEM_SOURCE_TELEGRAM;
};

export type CaptureProfile = {
  id: string;
};

export interface CaptureStore {
  findProfileByChatId(chatId: number): Promise<CaptureProfile | null>;
  insertItem(input: { userId: string; text: string }): Promise<CapturedItem>;
  listItemsByUser(userId: string): Promise<CapturedItem[]>;
}

export type CaptureResult =
  | { status: "unlinked"; reply: string }
  | { status: "captured"; reply: string; item: CapturedItem }
  | { status: "ignored" };

export function recordedCaptureReply(text: string): string {
  return `Recorded: "${text}"`;
}

export function isPlainCaptureText(text: string | undefined): boolean {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed === "") return false;
  if (trimmed.startsWith("/")) return false;
  return true;
}

export async function captureTextMessage(args: {
  store: CaptureStore;
  chatId: number;
  text: string | undefined;
}): Promise<CaptureResult> {
  const profile = await args.store.findProfileByChatId(args.chatId);
  if (profile === null) {
    return { status: "unlinked", reply: START_LINK_PROMPT };
  }

  if (!isPlainCaptureText(args.text)) {
    return { status: "ignored" };
  }

  const text = args.text!.trim();
  const item = await args.store.insertItem({ userId: profile.id, text });
  if (item.userId !== profile.id) {
    throw new Error("inserted item user must match the linked profile");
  }
  if (item.source !== ITEM_SOURCE_TELEGRAM) {
    throw new Error("inserted item source must be telegram");
  }
  if (item.text !== text) {
    throw new Error("inserted item text must match the recorded message");
  }
  return {
    status: "captured",
    reply: recordedCaptureReply(item.text),
    item,
  };
}

export function createMemoryCaptureStore(
  seed: Array<{ id: string; telegramChatId?: number | null }> = [],
): CaptureStore {
  const profiles = new Map<string, CaptureProfile & { telegramChatId: number | null }>();
  const items: CapturedItem[] = [];
  for (const profile of seed) {
    profiles.set(profile.id, {
      id: profile.id,
      telegramChatId: profile.telegramChatId ?? null,
    });
  }

  return {
    async findProfileByChatId(chatId) {
      for (const profile of profiles.values()) {
        if (profile.telegramChatId === chatId) return { id: profile.id };
      }
      return null;
    },
    async insertItem(input) {
      const item: CapturedItem = {
        id: crypto.randomUUID(),
        userId: input.userId,
        text: input.text,
        source: ITEM_SOURCE_TELEGRAM,
      };
      items.push(item);
      return { ...item };
    },
    async listItemsByUser(userId) {
      return items.filter((item) => item.userId === userId).map((item) => ({ ...item }));
    },
  };
}

export type RestCaptureStoreDeps = {
  apiUrl: string;
  serviceRoleKey: string;
  fetch: typeof fetch;
};

/**
 * PostgREST adapter for `profiles` lookup and `items` insert.
 * Reach the API through `ORMA_API_URL`. Never use a project host.
 * Auth uses `SUPABASE_SERVICE_ROLE_KEY`. Do not log the key.
 */
export function createRestCaptureStore(deps: RestCaptureStoreDeps): CaptureStore {
  const base = deps.apiUrl.replace(/\/+$/, "");
  const key = deps.serviceRoleKey;

  const headers = (prefer?: string): HeadersInit => {
    const next: Record<string, string> = {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    };
    if (prefer) next.prefer = prefer;
    return next;
  };

  const url = (path: string, query: string) => `${base}/rest/v1/${path}?${query}`;

  return {
    async findProfileByChatId(chatId) {
      const response = await deps.fetch(
        url("profiles", `telegram_chat_id=eq.${chatId}&select=id,telegram_chat_id`),
        { headers: headers() },
      );
      if (!response.ok) throw new Error("profiles chat read failed");
      const rows = (await response.json()) as RestProfileRow[];
      if (rows.length === 0) return null;
      return { id: rows[0].id };
    },
    async insertItem(input) {
      const response = await deps.fetch(`${base}/rest/v1/items`, {
        method: "POST",
        headers: headers("return=representation"),
        body: JSON.stringify({
          user_id: input.userId,
          text: input.text,
          source: ITEM_SOURCE_TELEGRAM,
        }),
      });
      if (!response.ok) throw new Error("items insert failed");
      const rows = (await response.json()) as RestItemRow[];
      if (rows.length !== 1) throw new Error("items insert must return one row");
      return fromRestItem(rows[0]);
    },
    async listItemsByUser(userId) {
      const response = await deps.fetch(
        url("items", `user_id=eq.${encodeURIComponent(userId)}&select=id,user_id,text,source`),
        { headers: headers() },
      );
      if (!response.ok) throw new Error("items read failed");
      const rows = (await response.json()) as RestItemRow[];
      return rows.map(fromRestItem);
    },
  };
}

type RestProfileRow = {
  id: string;
  telegram_chat_id: number | null;
};

type RestItemRow = {
  id: string;
  user_id: string;
  text: string;
  source: string;
};

function fromRestItem(row: RestItemRow): CapturedItem {
  if (row.source !== ITEM_SOURCE_TELEGRAM) {
    throw new Error("items row source must be telegram");
  }
  return {
    id: row.id,
    userId: row.user_id,
    text: row.text,
    source: ITEM_SOURCE_TELEGRAM,
  };
}

const testFn = (Deno as { test?: (name: string, fn: () => Promise<void>) => void }).test;
if (typeof testFn === "function" && !import.meta.main) {
  const userA = "00000000-0000-4000-8000-00000000000a";
  const userB = "00000000-0000-4000-8000-00000000000b";
  const chatA = 1001;
  const chatB = 2002;
  const thought = "Book a dentist appointment";

  testFn("a linked plain message creates one telegram item under that user", async () => {
    const store = createMemoryCaptureStore([
      { id: userA, telegramChatId: chatA },
      { id: userB, telegramChatId: chatB },
    ]);
    const result = await captureTextMessage({ store, chatId: chatA, text: thought });
    if (result.status !== "captured") throw new Error(`expected captured, got ${result.status}`);
    if (result.item.userId !== userA) throw new Error("item user_id must be the linked profile");
    if (result.item.source !== ITEM_SOURCE_TELEGRAM) {
      throw new Error("item source must be telegram");
    }
    if (result.item.text !== thought) throw new Error("item text must equal the message");
    const owned = await store.listItemsByUser(userA);
    if (owned.length !== 1) throw new Error(`expected one item, got ${owned.length}`);
    if (owned[0].id !== result.item.id) throw new Error("listed item must be the inserted row");
    const other = await store.listItemsByUser(userB);
    if (other.length !== 0) throw new Error("capture must not insert under another user");
  });

  testFn("the reply quotes the recorded item text", async () => {
    const store = createMemoryCaptureStore([{ id: userA, telegramChatId: chatA }]);
    const result = await captureTextMessage({
      store,
      chatId: chatA,
      text: `  ${thought}  `,
    });
    if (result.status !== "captured") throw new Error(`expected captured, got ${result.status}`);
    const expected = recordedCaptureReply(thought);
    if (result.reply !== expected) throw new Error("reply must equal recordedCaptureReply of stored text");
    if (!result.reply.includes(`"${thought}"`)) {
      throw new Error("reply must quote the recorded text");
    }
    if (result.item.text !== thought) throw new Error("store must keep trimmed recorded text");
  });

  testFn("an unlinked chat gets the linking prompt and no item", async () => {
    const store = createMemoryCaptureStore([{ id: userA }]);
    const result = await captureTextMessage({ store, chatId: chatA, text: thought });
    if (result.status !== "unlinked") throw new Error(`expected unlinked, got ${result.status}`);
    if (result.reply !== START_LINK_PROMPT) {
      throw new Error("unlinked reply must be START_LINK_PROMPT from link.ts");
    }
    const owned = await store.listItemsByUser(userA);
    if (owned.length !== 0) throw new Error("unlinked capture must not insert an item");
  });

  testFn("an unlinked chat is prompted even when the text is empty", async () => {
    const store = createMemoryCaptureStore([]);
    const result = await captureTextMessage({ store, chatId: chatA, text: "   " });
    if (result.status !== "unlinked") throw new Error(`expected unlinked, got ${result.status}`);
    if (result.reply !== START_LINK_PROMPT) {
      throw new Error("empty unlinked message must still use the linking prompt");
    }
  });

  testFn("a linked command is ignored and does not insert", async () => {
    const store = createMemoryCaptureStore([{ id: userA, telegramChatId: chatA }]);
    const result = await captureTextMessage({ store, chatId: chatA, text: "/start" });
    if (result.status !== "ignored") throw new Error(`expected ignored, got ${result.status}`);
    const owned = await store.listItemsByUser(userA);
    if (owned.length !== 0) throw new Error("a command must not become an item");
  });

  testFn("two linked messages create two items for the same user", async () => {
    const store = createMemoryCaptureStore([{ id: userA, telegramChatId: chatA }]);
    const first = await captureTextMessage({ store, chatId: chatA, text: "Call Amma" });
    const second = await captureTextMessage({ store, chatId: chatA, text: "Renew the passport" });
    if (first.status !== "captured" || second.status !== "captured") {
      throw new Error("both messages must capture");
    }
    if (first.item.id === second.item.id) throw new Error("each message must insert its own row");
    const owned = await store.listItemsByUser(userA);
    if (owned.length !== 2) throw new Error(`expected two items, got ${owned.length}`);
  });

  testFn("rest store inserts through ORMA_API_URL with source telegram", async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const itemId = "30000000-0000-4000-8000-00000000000a";
    const store = createRestCaptureStore({
      apiUrl: "https://orma-api.nryn.dev",
      serviceRoleKey: "service-role-test-value",
      fetch: async (input, init) => {
        const url = String(input);
        const body = typeof init?.body === "string" ? init.body : "";
        const method = init?.method ?? "GET";
        calls.push({ url, method, body });
        if (url.includes("supabase.co")) throw new Error("must not use the project host");
        if (url.includes("profiles") && method === "GET") {
          return new Response(
            JSON.stringify([{ id: userA, telegram_chat_id: chatA }]),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/items") && method === "POST") {
          const posted = JSON.parse(body) as RestItemRow & { user_id: string };
          return new Response(
            JSON.stringify([
              {
                id: itemId,
                user_id: posted.user_id,
                text: posted.text,
                source: posted.source,
              },
            ]),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`unexpected fetch ${method} ${url}`);
      },
    });
    const result = await captureTextMessage({ store, chatId: chatA, text: thought });
    if (result.status !== "captured") throw new Error(`expected captured, got ${result.status}`);
    const insert = calls.find((call) => call.method === "POST" && call.url.includes("/rest/v1/items"));
    if (!insert) throw new Error("capture must POST /rest/v1/items");
    if (!insert.url.startsWith("https://orma-api.nryn.dev/rest/v1/")) {
      throw new Error("rest calls must use ORMA_API_URL");
    }
    if (!insert.body.includes(`"source":"${ITEM_SOURCE_TELEGRAM}"`)) {
      throw new Error("insert body must set source telegram");
    }
    if (insert.body.includes("service-role-test-value")) {
      throw new Error("service role key must not appear in the items body");
    }
    if (result.item.id !== itemId) throw new Error("captured item must be the returned row");
    if (result.reply !== recordedCaptureReply(thought)) {
      throw new Error("rest capture reply must quote the recorded text");
    }
  });
}
