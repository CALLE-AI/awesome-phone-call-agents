/**
 * T3.5 Telegram start-press linking.
 *
 * The web app mints a short-lived single-use token.
 * The user opens the bot with that token as the deep-link payload.
 * This module binds `profiles.telegram_chat_id` to that chat.
 *
 * Token hashes persist in `public.telegram_link_tokens`.
 * That table is outside this owns path. See the T3.5 contract change.
 *
 * Pin bind, replay, expiry, and unlink with:
 * `deno test --allow-read supabase/functions/telegram/link.ts`
 *
 * T3.1 should call `completeLink` from `/start`.
 * T6.5 should call `mintLinkToken` and `unlinkTelegram`.
 */
export const LINK_TOKEN_TTL_MS = 10 * 60 * 1000;
export const LINK_TOKEN_BYTES = 32;
export const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const START_LINK_PROMPT =
  "Welcome to Orma. This chat is not linked yet. Open Orma in the browser, go to Settings, and start this bot with the link from your account. That one press lets Orma record thoughts you send here.";

export const LINK_BOUND_MESSAGE =
  "This chat is linked to your Orma account. You can send thoughts here.";

export const LINK_REPLAY_MESSAGE =
  "That link was already used. Open Settings and get a new link.";

export const LINK_EXPIRED_MESSAGE =
  "That link has expired. Open Settings and get a new link.";

export const LINK_TAKEN_MESSAGE =
  "This Telegram chat is already linked to another Orma account.";

export const LINK_INVALID_MESSAGE =
  "That link is not valid. Open Settings and get a new link.";

export type LinkTokenRow = {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

export type ProfileTelegramRow = {
  id: string;
  telegramChatId: number | null;
};

export type BindChatResult = "ok" | "taken" | "missing";

export interface LinkStore {
  insertToken(row: LinkTokenRow): Promise<void>;
  findToken(tokenHash: string): Promise<LinkTokenRow | null>;
  markTokenConsumed(tokenHash: string, consumedAt: Date): Promise<boolean>;
  unmarkTokenConsumed(tokenHash: string): Promise<void>;
  replaceOpenTokenForUser(row: LinkTokenRow): Promise<void>;
  deleteOpenTokensForUser(userId: string): Promise<void>;
  deleteTokensForUser(userId: string): Promise<void>;
  findProfileById(userId: string): Promise<ProfileTelegramRow | null>;
  findProfileByChatId(chatId: number): Promise<ProfileTelegramRow | null>;
  bindChatId(userId: string, chatId: number): Promise<BindChatResult>;
  clearChatId(userId: string): Promise<void>;
}

const mintLockByUser = new Map<string, Promise<void>>();

async function runSerializedMint<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const previous = mintLockByUser.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  mintLockByUser.set(
    userId,
    previous.then(
      () => held,
      () => held,
    ),
  );
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
  }
}

export type LinkOutcome =
  | { status: "bound"; userId: string; chatId: number }
  | { status: "replay" }
  | { status: "expired" }
  | { status: "taken" }
  | { status: "invalid" }
  | { status: "missing" };

export function messageForLinkOutcome(outcome: LinkOutcome): string {
  switch (outcome.status) {
    case "bound":
      return LINK_BOUND_MESSAGE;
    case "replay":
      return LINK_REPLAY_MESSAGE;
    case "expired":
      return LINK_EXPIRED_MESSAGE;
    case "taken":
      return LINK_TAKEN_MESSAGE;
    case "invalid":
      return LINK_INVALID_MESSAGE;
    case "missing":
      return START_LINK_PROMPT;
  }
}

export function telegramStartDeepLink(botUsername: string, token: string): string {
  const name = botUsername.replace(/^@/, "");
  return `https://t.me/${name}?start=${token}`;
}

export function tokenFromStartText(text: string | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  const command = trimmed.match(/^\/start(?:@[_A-Za-z0-9]+)?(?:\s+(.+))?$/s);
  if (!command) return null;
  const payload = command[1]?.trim() ?? "";
  return payload === "" ? null : payload;
}

export async function hashLinkToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function encodeLinkToken(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function mintLinkToken(args: {
  store: LinkStore;
  userId: string;
  now?: Date;
  ttlMs?: number;
  entropy?: Uint8Array;
}): Promise<{ token: string; expiresAt: Date; tokenHash: string }> {
  const now = args.now ?? new Date();
  const ttlMs = args.ttlMs ?? LINK_TOKEN_TTL_MS;
  const entropy = args.entropy ?? crypto.getRandomValues(new Uint8Array(LINK_TOKEN_BYTES));
  if (entropy.length !== LINK_TOKEN_BYTES) {
    throw new Error(`link token entropy must be ${LINK_TOKEN_BYTES} bytes`);
  }
  const token = encodeLinkToken(entropy);
  if (!LINK_TOKEN_PATTERN.test(token)) {
    throw new Error("minted token is not a valid Telegram start payload");
  }
  const tokenHash = await hashLinkToken(token);
  const expiresAt = new Date(now.getTime() + ttlMs);
  return await runSerializedMint(args.userId, async () => {
    await args.store.replaceOpenTokenForUser({
      tokenHash,
      userId: args.userId,
      expiresAt,
      consumedAt: null,
    });
    return { token, expiresAt, tokenHash };
  });
}

export async function completeLink(args: {
  store: LinkStore;
  token: string | null;
  chatId: number;
  now?: Date;
}): Promise<LinkOutcome> {
  const now = args.now ?? new Date();
  if (args.token === null || args.token === "") return { status: "missing" };
  if (!LINK_TOKEN_PATTERN.test(args.token)) return { status: "invalid" };

  const tokenHash = await hashLinkToken(args.token);
  const row = await args.store.findToken(tokenHash);
  if (row === null) return { status: "invalid" };
  if (row.consumedAt !== null) return { status: "replay" };
  if (row.expiresAt.getTime() <= now.getTime()) return { status: "expired" };

  const claimed = await args.store.markTokenConsumed(tokenHash, now);
  if (!claimed) return { status: "replay" };

  try {
    const bound = await args.store.bindChatId(row.userId, args.chatId);
    if (bound === "taken") return { status: "taken" };
    if (bound === "missing") return { status: "invalid" };
    return { status: "bound", userId: row.userId, chatId: args.chatId };
  } catch (error) {
    try {
      await args.store.unmarkTokenConsumed(tokenHash);
    } catch {
      // Keep the bind error. A failed rollback still surfaces the PATCH failure.
    }
    throw error;
  }
}

export async function unlinkTelegram(args: {
  store: LinkStore;
  userId: string;
}): Promise<void> {
  await args.store.deleteTokensForUser(args.userId);
  await args.store.clearChatId(args.userId);
}

export function createMemoryLinkStore(
  seed: Array<{ id: string; telegramChatId?: number | null }> = [],
): LinkStore {
  const profiles = new Map<string, ProfileTelegramRow>();
  const tokens = new Map<string, LinkTokenRow>();
  for (const profile of seed) {
    profiles.set(profile.id, {
      id: profile.id,
      telegramChatId: profile.telegramChatId ?? null,
    });
  }

  return {
    async insertToken(row) {
      if (tokens.has(row.tokenHash)) throw new Error("token hash already stored");
      dropOpenTokensForUser(tokens, row.userId, row.consumedAt);
      tokens.set(row.tokenHash, { ...row, expiresAt: new Date(row.expiresAt), consumedAt: row.consumedAt });
    },
    async findToken(tokenHash) {
      const row = tokens.get(tokenHash);
      if (!row) return null;
      return {
        tokenHash: row.tokenHash,
        userId: row.userId,
        expiresAt: new Date(row.expiresAt),
        consumedAt: row.consumedAt ? new Date(row.consumedAt) : null,
      };
    },
    async markTokenConsumed(tokenHash, consumedAt) {
      const row = tokens.get(tokenHash);
      if (!row || row.consumedAt !== null) return false;
      row.consumedAt = new Date(consumedAt);
      return true;
    },
    async unmarkTokenConsumed(tokenHash) {
      const row = tokens.get(tokenHash);
      if (row) row.consumedAt = null;
    },
    async replaceOpenTokenForUser(row) {
      dropOpenTokensForUser(tokens, row.userId, null);
      if (tokens.has(row.tokenHash)) throw new Error("token hash already stored");
      tokens.set(row.tokenHash, { ...row, expiresAt: new Date(row.expiresAt), consumedAt: row.consumedAt });
    },
    async deleteOpenTokensForUser(userId) {
      dropOpenTokensForUser(tokens, userId, null);
    },
    async deleteTokensForUser(userId) {
      for (const [hash, row] of tokens) {
        if (row.userId === userId) tokens.delete(hash);
      }
    },
    async findProfileById(userId) {
      return cloneProfile(profiles.get(userId));
    },
    async findProfileByChatId(chatId) {
      for (const profile of profiles.values()) {
        if (profile.telegramChatId === chatId) return cloneProfile(profile);
      }
      return null;
    },
    async bindChatId(userId, chatId) {
      const profile = profiles.get(userId);
      if (!profile) return "missing";
      for (const other of profiles.values()) {
        if (other.id !== userId && other.telegramChatId === chatId) return "taken";
      }
      profile.telegramChatId = chatId;
      return "ok";
    },
    async clearChatId(userId) {
      const profile = profiles.get(userId);
      if (profile) profile.telegramChatId = null;
    },
  };
}

function dropOpenTokensForUser(
  tokens: Map<string, LinkTokenRow>,
  userId: string,
  consumedAt: Date | null,
): void {
  if (consumedAt !== null) return;
  for (const [hash, row] of tokens) {
    if (row.userId === userId && row.consumedAt === null) tokens.delete(hash);
  }
}

function cloneProfile(profile: ProfileTelegramRow | undefined): ProfileTelegramRow | null {
  if (!profile) return null;
  return { id: profile.id, telegramChatId: profile.telegramChatId };
}

export type RestLinkStoreDeps = {
  apiUrl: string;
  serviceRoleKey: string;
  fetch: typeof fetch;
};

/**
 * PostgREST adapter for `telegram_link_tokens` and `profiles`.
 * Reach the API through `ORMA_API_URL`. Never use a project host.
 * Auth uses `SUPABASE_SERVICE_ROLE_KEY`. Do not log the key or the raw token.
 */
export function createRestLinkStore(deps: RestLinkStoreDeps): LinkStore {
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
    async insertToken(row) {
      const response = await deps.fetch(`${base}/rest/v1/telegram_link_tokens`, {
        method: "POST",
        headers: headers("return=minimal"),
        body: JSON.stringify({
          token_hash: row.tokenHash,
          user_id: row.userId,
          expires_at: row.expiresAt.toISOString(),
          consumed_at: row.consumedAt ? row.consumedAt.toISOString() : null,
        }),
      });
      if (!response.ok) throw new Error("telegram_link_tokens insert failed");
    },
    async findToken(tokenHash) {
      const response = await deps.fetch(
        url("telegram_link_tokens", `token_hash=eq.${encodeURIComponent(tokenHash)}&select=token_hash,user_id,expires_at,consumed_at`),
        { headers: headers() },
      );
      if (!response.ok) throw new Error("telegram_link_tokens read failed");
      const rows = (await response.json()) as RestTokenRow[];
      if (rows.length === 0) return null;
      return fromRestToken(rows[0]);
    },
    async markTokenConsumed(tokenHash, consumedAt) {
      const response = await deps.fetch(
        url(
          "telegram_link_tokens",
          `token_hash=eq.${encodeURIComponent(tokenHash)}&consumed_at=is.null`,
        ),
        {
          method: "PATCH",
          headers: headers("return=representation"),
          body: JSON.stringify({ consumed_at: consumedAt.toISOString() }),
        },
      );
      if (!response.ok) throw new Error("telegram_link_tokens consume failed");
      const rows = (await response.json()) as RestTokenRow[];
      return rows.length === 1;
    },
    async unmarkTokenConsumed(tokenHash) {
      const response = await deps.fetch(
        url("telegram_link_tokens", `token_hash=eq.${encodeURIComponent(tokenHash)}`),
        {
          method: "PATCH",
          headers: headers("return=minimal"),
          body: JSON.stringify({ consumed_at: null }),
        },
      );
      if (!response.ok) throw new Error("telegram_link_tokens consume rollback failed");
    },
    async replaceOpenTokenForUser(row) {
      await this.deleteOpenTokensForUser(row.userId);
      await this.insertToken(row);
    },
    async deleteOpenTokensForUser(userId) {
      const response = await deps.fetch(
        url("telegram_link_tokens", `user_id=eq.${encodeURIComponent(userId)}&consumed_at=is.null`),
        { method: "DELETE", headers: headers("return=minimal") },
      );
      if (!response.ok) throw new Error("telegram_link_tokens open delete failed");
    },
    async deleteTokensForUser(userId) {
      const response = await deps.fetch(
        url("telegram_link_tokens", `user_id=eq.${encodeURIComponent(userId)}`),
        { method: "DELETE", headers: headers("return=minimal") },
      );
      if (!response.ok) throw new Error("telegram_link_tokens delete failed");
    },
    async findProfileById(userId) {
      const response = await deps.fetch(
        url("profiles", `id=eq.${encodeURIComponent(userId)}&select=id,telegram_chat_id`),
        { headers: headers() },
      );
      if (!response.ok) throw new Error("profiles read failed");
      const rows = (await response.json()) as RestProfileRow[];
      if (rows.length === 0) return null;
      return fromRestProfile(rows[0]);
    },
    async findProfileByChatId(chatId) {
      const response = await deps.fetch(
        url("profiles", `telegram_chat_id=eq.${chatId}&select=id,telegram_chat_id`),
        { headers: headers() },
      );
      if (!response.ok) throw new Error("profiles chat read failed");
      const rows = (await response.json()) as RestProfileRow[];
      if (rows.length === 0) return null;
      return fromRestProfile(rows[0]);
    },
    async bindChatId(userId, chatId) {
      const taken = await this.findProfileByChatId(chatId);
      if (taken && taken.id !== userId) return "taken";
      const existing = await this.findProfileById(userId);
      if (existing === null) return "missing";
      const response = await deps.fetch(
        url("profiles", `id=eq.${encodeURIComponent(userId)}`),
        {
          method: "PATCH",
          headers: headers("return=minimal"),
          body: JSON.stringify({ telegram_chat_id: chatId }),
        },
      );
      if (response.status === 409) return "taken";
      if (!response.ok) throw new Error("profiles bind failed");
      return "ok";
    },
    async clearChatId(userId) {
      const response = await deps.fetch(
        url("profiles", `id=eq.${encodeURIComponent(userId)}`),
        {
          method: "PATCH",
          headers: headers("return=minimal"),
          body: JSON.stringify({ telegram_chat_id: null }),
        },
      );
      if (!response.ok) throw new Error("profiles unlink failed");
    },
  };
}

type RestTokenRow = {
  token_hash: string;
  user_id: string;
  expires_at: string;
  consumed_at: string | null;
};

type RestProfileRow = {
  id: string;
  telegram_chat_id: number | null;
};

function fromRestToken(row: RestTokenRow): LinkTokenRow {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    expiresAt: new Date(row.expires_at),
    consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
  };
}

function fromRestProfile(row: RestProfileRow): ProfileTelegramRow {
  return { id: row.id, telegramChatId: row.telegram_chat_id };
}

const testFn = (Deno as { test?: (name: string, fn: () => Promise<void>) => void }).test;
if (typeof testFn === "function" && !import.meta.main) {
  const userA = "00000000-0000-4000-8000-00000000000a";
  const userB = "00000000-0000-4000-8000-00000000000b";
  const chatA = 1001;
  const chatB = 2002;
  const now = new Date("2026-09-12T06:00:00.000Z");

  testFn("a fresh link binds the chat on the profile row", async () => {
    const store = createMemoryLinkStore([{ id: userA }, { id: userB }]);
    const minted = await mintLinkToken({ store, userId: userA, now });
    const storedPlain = await store.findToken(minted.token);
    if (storedPlain !== null) throw new Error("store must keep the hash, not the raw token");
    const outcome = await completeLink({ store, token: minted.token, chatId: chatA, now });
    if (outcome.status !== "bound") throw new Error(`expected bound, got ${outcome.status}`);
    if (outcome.userId !== userA) throw new Error("bound user must match the token owner");
    const profile = await store.findProfileById(userA);
    if (profile?.telegramChatId !== chatA) {
      throw new Error("profiles.telegram_chat_id must equal the start chat");
    }
    const byChat = await store.findProfileByChatId(chatA);
    if (byChat?.id !== userA) throw new Error("chat id must resolve to the linked profile");
    const tokenRow = await store.findToken(minted.tokenHash);
    if (tokenRow?.consumedAt === null) throw new Error("token must be consumed on first use");
  });

  testFn("a replayed token is refused and the binding stays put", async () => {
    const store = createMemoryLinkStore([{ id: userA }, { id: userB }]);
    const minted = await mintLinkToken({ store, userId: userA, now });
    const first = await completeLink({ store, token: minted.token, chatId: chatA, now });
    if (first.status !== "bound") throw new Error("first use must bind");
    const replay = await completeLink({ store, token: minted.token, chatId: chatB, now });
    if (replay.status !== "replay") throw new Error(`expected replay, got ${replay.status}`);
    const profile = await store.findProfileById(userA);
    if (profile?.telegramChatId !== chatA) {
      throw new Error("replay must not move telegram_chat_id");
    }
    const stolen = await store.findProfileByChatId(chatB);
    if (stolen !== null) throw new Error("replay must not bind a second chat");
  });

  testFn("a token older than its window is refused and does not bind", async () => {
    const store = createMemoryLinkStore([{ id: userA }]);
    const minted = await mintLinkToken({
      store,
      userId: userA,
      now,
      ttlMs: LINK_TOKEN_TTL_MS,
    });
    const late = new Date(now.getTime() + LINK_TOKEN_TTL_MS + 1);
    const outcome = await completeLink({
      store,
      token: minted.token,
      chatId: chatA,
      now: late,
    });
    if (outcome.status !== "expired") throw new Error(`expected expired, got ${outcome.status}`);
    const profile = await store.findProfileById(userA);
    if (profile?.telegramChatId !== null) {
      throw new Error("an expired token must leave telegram_chat_id null");
    }
    const tokenRow = await store.findToken(minted.tokenHash);
    if (tokenRow?.consumedAt !== null) {
      throw new Error("expiry refuse must not count as consumption");
    }
  });

  testFn("unlinking clears the profile chat id and outstanding tokens", async () => {
    const store = createMemoryLinkStore([{ id: userA }, { id: userB }]);
    const minted = await mintLinkToken({ store, userId: userA, now });
    const linked = await completeLink({ store, token: minted.token, chatId: chatA, now });
    if (linked.status !== "bound") throw new Error("setup bind failed");
    const leftover = await mintLinkToken({ store, userId: userA, now });
    await unlinkTelegram({ store, userId: userA });
    const profile = await store.findProfileById(userA);
    if (profile?.telegramChatId !== null) {
      throw new Error("unlink must null profiles.telegram_chat_id");
    }
    const stillLinked = await store.findProfileByChatId(chatA);
    if (stillLinked !== null) throw new Error("unlink must clear the chat side of the binding");
    const leftoverRow = await store.findToken(leftover.tokenHash);
    if (leftoverRow !== null) throw new Error("unlink must drop outstanding tokens");
    const leftoverUse = await completeLink({
      store,
      token: leftover.token,
      chatId: chatA,
      now,
    });
    if (leftoverUse.status !== "invalid") {
      throw new Error(`expected leftover token invalid, got ${leftoverUse.status}`);
    }
    const rebound = await mintLinkToken({ store, userId: userB, now });
    const other = await completeLink({ store, token: rebound.token, chatId: chatA, now });
    if (other.status !== "bound" || other.userId !== userB) {
      throw new Error("a freed chat must be bindable to another profile");
    }
  });

  testFn("a chat already bound to another profile is refused", async () => {
    const store = createMemoryLinkStore([
      { id: userA, telegramChatId: chatA },
      { id: userB },
    ]);
    const minted = await mintLinkToken({ store, userId: userB, now });
    const outcome = await completeLink({ store, token: minted.token, chatId: chatA, now });
    if (outcome.status !== "taken") throw new Error(`expected taken, got ${outcome.status}`);
    const owner = await store.findProfileByChatId(chatA);
    if (owner?.id !== userA) throw new Error("taken chat must stay on the original profile");
    const guest = await store.findProfileById(userB);
    if (guest?.telegramChatId !== null) throw new Error("refused bind must not write the guest");
  });

  testFn("bare /start is missing and does not bind", async () => {
    const store = createMemoryLinkStore([{ id: userA }]);
    const token = tokenFromStartText("/start");
    const outcome = await completeLink({ store, token, chatId: chatA, now });
    if (outcome.status !== "missing") throw new Error(`expected missing, got ${outcome.status}`);
    if (messageForLinkOutcome(outcome) !== START_LINK_PROMPT) {
      throw new Error("missing payload must use the settings prompt");
    }
    const fromAt = tokenFromStartText(`/start@orma_tele_bot ${"a".repeat(10)}`);
    if (fromAt !== "a".repeat(10)) throw new Error("payload after /start@bot must parse");
  });

  testFn("rest store writes the hash and never the raw token", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const store = createRestLinkStore({
      apiUrl: "https://orma-api.nryn.dev",
      serviceRoleKey: "service-role-test-value",
      fetch: async (input, init) => {
        const url = String(input);
        const body = typeof init?.body === "string" ? init.body : "";
        calls.push({ url, body });
        if (url.includes("supabase.co")) throw new Error("must not use the project host");
        if (init?.method === "POST" && url.includes("telegram_link_tokens")) {
          return new Response(null, { status: 201 });
        }
        if (url.includes("telegram_link_tokens") && (init?.method === "DELETE" || !init?.method)) {
          return new Response("[]", { headers: { "content-type": "application/json" } });
        }
        throw new Error(`unexpected fetch ${init?.method ?? "GET"} ${url}`);
      },
    });
    const entropy = new Uint8Array(LINK_TOKEN_BYTES).fill(7);
    const minted = await mintLinkToken({ store, userId: userA, now, entropy });
    const insert = calls.find((call) => call.body.includes("token_hash"));
    if (!insert) throw new Error("insert must send token_hash");
    if (insert.body.includes(minted.token)) throw new Error("raw token must not be posted");
    if (!insert.body.includes(minted.tokenHash)) throw new Error("insert must post the hash");
    if (!insert.url.startsWith("https://orma-api.nryn.dev/rest/v1/")) {
      throw new Error("rest calls must use ORMA_API_URL");
    }
  });

  testFn("a failed bind rolls back consume so retry is not replay", async () => {
    const store = createMemoryLinkStore([{ id: userA }]);
    const minted = await mintLinkToken({ store, userId: userA, now });
    const bind = store.bindChatId;
    store.bindChatId = async () => {
      throw new Error("profiles PATCH failed");
    };
    let threw = false;
    try {
      await completeLink({ store, token: minted.token, chatId: chatA, now });
    } catch (error) {
      threw = error instanceof Error && error.message === "profiles PATCH failed";
    }
    if (!threw) throw new Error("completeLink must surface the bind failure");
    const burned = await store.findToken(minted.tokenHash);
    if (burned?.consumedAt !== null) {
      throw new Error("failed bind must not leave consumed_at set");
    }
    const profile = await store.findProfileById(userA);
    if (profile?.telegramChatId !== null) {
      throw new Error("failed bind must leave telegram_chat_id null");
    }
    store.bindChatId = bind;
    const retry = await completeLink({ store, token: minted.token, chatId: chatA, now });
    if (retry.status !== "bound") {
      throw new Error(`expected bound retry, got ${retry.status}`);
    }
    const linked = await store.findProfileById(userA);
    if (linked?.telegramChatId !== chatA) {
      throw new Error("retry after rolled-back consume must bind the chat");
    }
  });

  testFn("overlapping mints leave one live open token for a user", async () => {
    const store = createMemoryLinkStore([{ id: userA }]);
    const entropyA = new Uint8Array(LINK_TOKEN_BYTES).fill(3);
    const entropyB = new Uint8Array(LINK_TOKEN_BYTES).fill(4);
    const [first, second] = await Promise.all([
      mintLinkToken({ store, userId: userA, now, entropy: entropyA }),
      mintLinkToken({ store, userId: userA, now, entropy: entropyB }),
    ]);
    if (first.tokenHash === second.tokenHash) {
      throw new Error("overlapping mints must use distinct hashes");
    }
    const rowA = await store.findToken(first.tokenHash);
    const rowB = await store.findToken(second.tokenHash);
    const live = [rowA, rowB].filter((row) => row !== null && row.consumedAt === null);
    if (live.length !== 1) {
      throw new Error(`expected one live open token, got ${live.length}`);
    }
  });

  testFn("a failed token delete does not clear chat while leaving a usable token", async () => {
    const store = createMemoryLinkStore([{ id: userA }]);
    const minted = await mintLinkToken({ store, userId: userA, now });
    const linked = await completeLink({ store, token: minted.token, chatId: chatA, now });
    if (linked.status !== "bound") throw new Error("setup bind failed");
    const leftover = await mintLinkToken({ store, userId: userA, now });
    store.deleteTokensForUser = async () => {
      throw new Error("token delete failed");
    };
    let threw = false;
    try {
      await unlinkTelegram({ store, userId: userA });
    } catch (error) {
      threw = error instanceof Error && error.message === "token delete failed";
    }
    if (!threw) throw new Error("unlink must surface the token delete failure");
    const profile = await store.findProfileById(userA);
    if (profile?.telegramChatId !== chatA) {
      throw new Error("failed unlink must not clear telegram_chat_id");
    }
    const leftoverRow = await store.findToken(leftover.tokenHash);
    if (leftoverRow === null) throw new Error("failed unlink must leave the leftover hash stored");
    if (profile?.telegramChatId === null && leftoverRow.consumedAt === null) {
      throw new Error("partial unlink must not clear chat while a live token remains");
    }
  });

  testFn("mint rejects entropy shorter than LINK_TOKEN_BYTES", async () => {
    const store = createMemoryLinkStore([{ id: userA }]);
    let threw = false;
    try {
      await mintLinkToken({ store, userId: userA, now, entropy: new Uint8Array([1]) });
    } catch (error) {
      threw = error instanceof Error && error.message.includes(`${LINK_TOKEN_BYTES}`);
    }
    if (!threw) throw new Error("one-byte entropy must be rejected");
    const outcome = await completeLink({ store, token: "AQ", chatId: chatA, now });
    if (outcome.status === "bound") {
      throw new Error("short entropy must not mint a bindable start payload");
    }
  });
}
