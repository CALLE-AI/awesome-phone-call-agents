/**
 * T3.1 Telegram webhook. Secret sits in the path, then grammY may parse.
 *
 * Runtime env, same names as GitHub secrets and `scripts/bootstrap-env.sh`:
 * `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ORMA_API_URL`,
 * `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_MODEL`, `GOOGLE_VERTEX_PROJECT`,
 * `GOOGLE_VERTEX_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`.
 * A missing name throws before any update is read.
 *
 * Webhook URL is `${ORMA_API_URL}/functions/v1/telegram/${TELEGRAM_WEBHOOK_SECRET}`.
 * Boot and GET on that path call Telegram `setWebhook`. POST handles updates.
 *
 * `/start` with a payload calls `completeLink`. Bare `/start` uses `START_LINK_PROMPT`.
 * Plain text calls `captureTextMessage`. Voice calls `captureVoiceNote`.
 * `voice_ok:` callbacks answer immediately so Confirm does not spin.
 *
 * Pin forged updates and wired paths with:
 * `deno test --allow-net --allow-env --allow-read supabase/functions/telegram/index.ts`
 *
 * Live forged POST against the front door should be 401 with an empty body.
 * JWT verification is off in `supabase/config.toml` `[functions.telegram]`.
 */
import { Bot, webhookCallback } from "npm:grammy@1.38.3";
import {
  START_LINK_PROMPT,
  completeLink,
  createRestLinkStore,
  messageForLinkOutcome,
  tokenFromStartText,
  type LinkStore,
} from "./link.ts";
import {
  captureTextMessage,
  createRestCaptureStore,
  isPlainCaptureText,
  type CaptureStore,
} from "./capture.ts";
import {
  captureVoiceNote,
  createRestVoiceStore,
  createTelegramVoiceChat,
  parseVoiceConfirmCallback,
  vertexTranscriberFromEnv,
  type TranscribeVoice,
  type VoiceChat,
  type VoiceStore,
} from "./voice.ts";

export { START_LINK_PROMPT };

export interface TelegramDeps {
  botToken: string;
  webhookSecret: string;
  apiUrl: string;
  serviceRoleKey: string;
  geminiModel: string;
  vertexProject: string;
  vertexLocation: string;
  vertexCredentialsJson: string;
  fetch: typeof fetch;
  linkStore?: LinkStore;
  captureStore?: CaptureStore;
  voiceStore?: VoiceStore;
  voiceChat?: VoiceChat;
  transcribe?: TranscribeVoice;
}

export function requireNamedEnv(
  name: string,
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
): string {
  const value = getEnv(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

export function depsFromEnv(
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
  fetchImpl: typeof fetch = fetch,
): TelegramDeps {
  return {
    botToken: requireNamedEnv("TELEGRAM_BOT_TOKEN", getEnv),
    webhookSecret: requireNamedEnv("TELEGRAM_WEBHOOK_SECRET", getEnv),
    apiUrl: requireNamedEnv("ORMA_API_URL", getEnv),
    serviceRoleKey: requireNamedEnv("SUPABASE_SERVICE_ROLE_KEY", getEnv),
    geminiModel: requireNamedEnv("GEMINI_MODEL", getEnv),
    vertexProject: requireNamedEnv("GOOGLE_VERTEX_PROJECT", getEnv),
    vertexLocation: requireNamedEnv("GOOGLE_VERTEX_LOCATION", getEnv),
    vertexCredentialsJson: requireNamedEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", getEnv),
    fetch: fetchImpl,
  };
}

export function telegramWebhookUrl(apiUrl: string, secret: string): string {
  const base = apiUrl.replace(/\/+$/, "");
  return `${base}/functions/v1/telegram/${secret}`;
}

export function presentedWebhookSecret(pathname: string): string | null {
  const marker = "/telegram/";
  const index = pathname.indexOf(marker);
  if (index === -1) return null;
  const rest = pathname.slice(index + marker.length).replace(/\/+$/, "");
  if (!rest) return null;
  return rest;
}

export function webhookSecretsMatch(presented: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(presented);
  const right = encoder.encode(expected);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function discarded(): Response {
  return new Response(null, { status: 401 });
}

function restStoreDeps(deps: TelegramDeps) {
  return {
    apiUrl: deps.apiUrl,
    serviceRoleKey: deps.serviceRoleKey,
    fetch: deps.fetch,
  };
}

function transcribeFromDeps(deps: TelegramDeps): TranscribeVoice {
  if (deps.transcribe) return deps.transcribe;
  const values: Record<string, string> = {
    GEMINI_MODEL: deps.geminiModel,
    GOOGLE_VERTEX_PROJECT: deps.vertexProject,
    GOOGLE_VERTEX_LOCATION: deps.vertexLocation,
    GOOGLE_APPLICATION_CREDENTIALS_JSON: deps.vertexCredentialsJson,
  };
  return vertexTranscriberFromEnv((key) => values[key], deps.fetch);
}

export function createTelegramBot(deps: TelegramDeps): Bot {
  const linkStore = deps.linkStore ?? createRestLinkStore(restStoreDeps(deps));
  const captureStore = deps.captureStore ?? createRestCaptureStore(restStoreDeps(deps));
  const voiceStore = deps.voiceStore ?? createRestVoiceStore(restStoreDeps(deps));
  const voiceChat = deps.voiceChat ?? createTelegramVoiceChat({
    botToken: deps.botToken,
    fetch: deps.fetch,
  });

  const bot = new Bot(deps.botToken, { client: { fetch: deps.fetch } });

  bot.command("start", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (typeof chatId !== "number") return;
    const token = tokenFromStartText(ctx.message?.text);
    if (token === null) {
      await ctx.reply(START_LINK_PROMPT);
      return;
    }
    const outcome = await completeLink({ store: linkStore, token, chatId });
    await ctx.reply(messageForLinkOutcome(outcome));
  });

  bot.on("message:text", async (ctx) => {
    if (!isPlainCaptureText(ctx.message.text)) return;
    const chatId = ctx.chat?.id;
    if (typeof chatId !== "number") return;
    const result = await captureTextMessage({
      store: captureStore,
      chatId,
      text: ctx.message.text,
    });
    if (result.status === "ignored") return;
    await ctx.reply(result.reply);
  });

  bot.on("message:voice", async (ctx) => {
    const chatId = ctx.chat?.id;
    const messageId = ctx.message.message_id;
    const fileId = ctx.message.voice.file_id;
    if (typeof chatId !== "number") return;
    await captureVoiceNote({
      store: voiceStore,
      chat: voiceChat,
      transcribe: transcribeFromDeps(deps),
      chatId,
      messageId,
      fileId,
    });
  });

  bot.on("callback_query:data", async (ctx) => {
    const itemId = parseVoiceConfirmCallback(ctx.callbackQuery.data);
    if (itemId === null) return;
    await ctx.answerCallbackQuery();
  });

  return bot;
}

export function createTelegramHandler(deps: TelegramDeps): (req: Request) => Promise<Response> {
  const bot = createTelegramBot(deps);
  const handleUpdate = webhookCallback(bot, "std/http");

  return async (req: Request): Promise<Response> => {
    const presented = presentedWebhookSecret(new URL(req.url).pathname);
    if (presented === null || !webhookSecretsMatch(presented, deps.webhookSecret)) {
      return discarded();
    }

    if (req.method === "GET") {
      return registerWebhook(deps);
    }

    if (req.method !== "POST") return discarded();

    try {
      return await handleUpdate(req);
    } catch {
      console.error("telegram update failed");
      return new Response(null, { status: 500 });
    }
  };
}

export async function registerWebhook(deps: TelegramDeps): Promise<Response> {
  const webhookUrl = telegramWebhookUrl(deps.apiUrl, deps.webhookSecret);
  const telegramUrl = `https://api.telegram.org/bot${deps.botToken}/setWebhook`;
  const response = await deps.fetch(telegramUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: webhookUrl }),
  });
  const body = await response.text();
  let ok = false;
  try {
    const parsed = JSON.parse(body) as { ok?: boolean };
    ok = parsed.ok === true;
  } catch {
    ok = false;
  }
  if (!ok) return new Response(null, { status: 502 });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

if (import.meta.main) {
  const deps = depsFromEnv();
  registerWebhook(deps).catch(() => {
    console.error("telegram setWebhook failed");
  });
  Deno.serve(createTelegramHandler(deps));
}

function startUpdate(text = "/start"): string {
  return JSON.stringify({
    update_id: 1,
    message: {
      message_id: 1,
      date: 1,
      chat: { id: 42, type: "private" },
      from: { id: 42, is_bot: false, first_name: "Ada" },
      text,
      entities: text.startsWith("/start")
        ? [{ offset: 0, length: 6, type: "bot_command" }]
        : undefined,
    },
  });
}

function textUpdate(text: string): string {
  return JSON.stringify({
    update_id: 2,
    message: {
      message_id: 3,
      date: 3,
      chat: { id: 42, type: "private" },
      from: { id: 42, is_bot: false, first_name: "Ada" },
      text,
    },
  });
}

function voiceUpdate(fileId = "voice-file-1"): string {
  return JSON.stringify({
    update_id: 3,
    message: {
      message_id: 4,
      date: 4,
      chat: { id: 42, type: "private" },
      from: { id: 42, is_bot: false, first_name: "Ada" },
      voice: { file_id: fileId, duration: 2, mime_type: "audio/ogg" },
    },
  });
}

function voiceOkCallback(itemId: string): string {
  return JSON.stringify({
    update_id: 4,
    callback_query: {
      id: "cb-1",
      from: { id: 42, is_bot: false, first_name: "Ada" },
      chat_instance: "1",
      data: `voice_ok:${itemId}`,
      message: {
        message_id: 5,
        date: 5,
        chat: { id: 42, type: "private" },
        text: "Recorded",
      },
    },
  });
}

function telegramOk(text = "ok"): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      result: {
        message_id: 2,
        date: 2,
        chat: { id: 42, type: "private" },
        text,
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
}

const testFn = (Deno as { test?: (name: string, fn: () => void | Promise<void>) => void }).test;
if (typeof testFn === "function" && !import.meta.main) {
  const { createMemoryLinkStore, mintLinkToken, LINK_BOUND_MESSAGE } = await import("./link.ts");
  const { createMemoryCaptureStore, recordedCaptureReply } = await import("./capture.ts");
  const { createMemoryVoiceStore, VOICE_ACK_TEXT } = await import("./voice.ts");

  const secret = crypto.randomUUID();
  const botToken = `1:${crypto.randomUUID()}`;
  const apiUrl = "https://orma-api.nryn.dev";
  const userA = "00000000-0000-4000-8000-00000000000a";

  function baseDeps(overrides: Partial<TelegramDeps> = {}): TelegramDeps {
    return {
      botToken,
      webhookSecret: secret,
      apiUrl,
      serviceRoleKey: "service-role-test-value",
      geminiModel: "gemini-test",
      vertexProject: "nryn-personal",
      vertexLocation: "global",
      vertexCredentialsJson: "{}",
      fetch: async () => telegramOk(),
      ...overrides,
    };
  }

  testFn("forged update without the path secret is discarded", async () => {
    const calls: string[] = [];
    const handler = createTelegramHandler(baseDeps({
      fetch: async (input) => {
        calls.push(String(input));
        throw new Error("fetch must not run for a forged update");
      },
    }));
    const response = await handler(
      new Request(`${apiUrl}/functions/v1/telegram/wrong-secret`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "this is not json and must not be parsed",
      }),
    );
    if (response.status !== 401) throw new Error(`expected 401, got ${response.status}`);
    if ((await response.text()) !== "") throw new Error("expected an empty body");
    if (calls.length !== 0) throw new Error("Telegram must not be called");
  });

  testFn("forged update with no path secret is discarded", async () => {
    const handler = createTelegramHandler(baseDeps({
      fetch: async () => {
        throw new Error("fetch must not run");
      },
    }));
    const response = await handler(
      new Request(`${apiUrl}/functions/v1/telegram`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: startUpdate(),
      }),
    );
    if (response.status !== 401) throw new Error(`expected 401, got ${response.status}`);
    if ((await response.text()) !== "") throw new Error("expected an empty body");
  });

  testFn("GET with the path secret registers the ORMA_API_URL webhook", async () => {
    let capturedUrl: string | undefined;
    const handler = createTelegramHandler(baseDeps({
      fetch: async (_input, init) => {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as { url?: string };
        capturedUrl = parsed.url;
        return new Response(JSON.stringify({ ok: true, result: true }), {
          headers: { "content-type": "application/json" },
        });
      },
    }));
    const response = await handler(new Request(`${apiUrl}/functions/v1/telegram/${secret}`));
    if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`);
    const expected = `${apiUrl}/functions/v1/telegram/${secret}`;
    if (capturedUrl !== expected) throw new Error("setWebhook url must use ORMA_API_URL");
    if (capturedUrl.includes("supabase.co")) throw new Error("setWebhook must not use the project host");
  });

  testFn("/start replies with the linking prompt from link.ts", async () => {
    const sendBodies: string[] = [];
    const handler = createTelegramHandler(baseDeps({
      fetch: async (_input, init) => {
        sendBodies.push(typeof init?.body === "string" ? init.body : String(init?.body ?? ""));
        return telegramOk(START_LINK_PROMPT);
      },
    }));
    const response = await handler(
      new Request(`${apiUrl}/functions/v1/telegram/${secret}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: startUpdate(),
      }),
    );
    if (!response.ok) throw new Error(`expected grammY to accept the update, got ${response.status}`);
    const matched = sendBodies.some((body) => body.includes(START_LINK_PROMPT));
    if (!matched) throw new Error("Bot API was not asked to send the linking prompt");
  });

  testFn("path secret with a percent sequence matches registration and POST", async () => {
    const percentSecret = "abc%2Fdef";
    const registered = telegramWebhookUrl(apiUrl, percentSecret);
    const fromPath = presentedWebhookSecret(new URL(registered).pathname);
    if (fromPath !== percentSecret) {
      throw new Error("presented secret must equal the registered path segment");
    }
    if (fromPath === decodeURIComponent(percentSecret)) {
      throw new Error("matcher must not decode percent sequences in the secret");
    }
    let capturedUrl: string | undefined;
    const handler = createTelegramHandler(baseDeps({
      webhookSecret: percentSecret,
      fetch: async (_input, init) => {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as { url?: string };
        capturedUrl = parsed.url;
        return new Response(JSON.stringify({ ok: true, result: true }), {
          headers: { "content-type": "application/json" },
        });
      },
    }));
    const getResponse = await handler(new Request(registered));
    if (getResponse.status !== 200) {
      throw new Error(`expected 200 on GET, got ${getResponse.status}`);
    }
    if (capturedUrl !== registered) {
      throw new Error("setWebhook url must keep the percent sequence in the secret");
    }
    const postResponse = await handler(
      new Request(registered, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: startUpdate(),
      }),
    );
    if (postResponse.status === 401) {
      throw new Error("POST with the percent secret must pass the matcher");
    }
  });

  testFn("depsFromEnv requires service role and Vertex names", () => {
    const empty = () => undefined;
    try {
      depsFromEnv(empty);
      throw new Error("depsFromEnv must throw when names are missing");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("missing ")) {
        throw new Error("missing env must name the variable");
      }
    }
    const names = [
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_WEBHOOK_SECRET",
      "ORMA_API_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "GEMINI_MODEL",
      "GOOGLE_VERTEX_PROJECT",
      "GOOGLE_VERTEX_LOCATION",
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    ];
    const seen: string[] = [];
    const values: Record<string, string> = {};
    for (const name of names) {
      try {
        depsFromEnv((key) => values[key]);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== `missing ${name}`) {
          throw new Error(`expected missing ${name}, got ${error}`);
        }
        seen.push(name);
        values[name] = `${name}-value`;
      }
    }
    if (seen.join(",") !== names.join(",")) {
      throw new Error("depsFromEnv must require names in order");
    }
    const deps = depsFromEnv((key) => values[key]);
    if (deps.serviceRoleKey !== "SUPABASE_SERVICE_ROLE_KEY-value") {
      throw new Error("service role must load from SUPABASE_SERVICE_ROLE_KEY");
    }
    if (deps.apiUrl.includes("supabase.co")) {
      throw new Error("ORMA_API_URL must not be a project host in tests");
    }
  });

  testFn("/start with a token binds through completeLink", async () => {
    const store = createMemoryLinkStore([{ id: userA }]);
    const minted = await mintLinkToken({
      store,
      userId: userA,
    });
    const sendBodies: string[] = [];
    const handler = createTelegramHandler(baseDeps({
      linkStore: store,
      fetch: async (_input, init) => {
        sendBodies.push(typeof init?.body === "string" ? init.body : String(init?.body ?? ""));
        return telegramOk(LINK_BOUND_MESSAGE);
      },
    }));
    const response = await handler(
      new Request(`${apiUrl}/functions/v1/telegram/${secret}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: startUpdate(`/start ${minted.token}`),
      }),
    );
    if (!response.ok) throw new Error(`expected grammY to accept the update, got ${response.status}`);
    const matched = sendBodies.some((body) => body.includes(LINK_BOUND_MESSAGE));
    if (!matched) throw new Error("bound start must reply with messageForLinkOutcome");
    const profile = await store.findProfileById(userA);
    if (profile?.telegramChatId !== 42) throw new Error("completeLink must bind the start chat");
  });

  testFn("plain text from a linked chat replies with the recorded quote", async () => {
    const thought = "Book a dentist appointment";
    const store = createMemoryCaptureStore([{ id: userA, telegramChatId: 42 }]);
    const sendBodies: string[] = [];
    const handler = createTelegramHandler(baseDeps({
      captureStore: store,
      fetch: async (_input, init) => {
        sendBodies.push(typeof init?.body === "string" ? init.body : String(init?.body ?? ""));
        return telegramOk();
      },
    }));
    const response = await handler(
      new Request(`${apiUrl}/functions/v1/telegram/${secret}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: textUpdate(thought),
      }),
    );
    if (!response.ok) throw new Error(`expected grammY to accept the update, got ${response.status}`);
    if (!sendBodies.some((body) => body.includes(thought) && body.includes("Recorded"))) {
      throw new Error("text capture must reply with the quoted item");
    }
    const owned = await store.listItemsByUser(userA);
    if (owned.length !== 1 || owned[0].text !== thought) {
      throw new Error("linked text must insert one telegram item");
    }
  });

  testFn("voice update acks through captureVoiceNote", async () => {
    const acks: number[] = [];
    const store = createMemoryVoiceStore([{ id: userA, telegramChatId: 42 }]);
    const handler = createTelegramHandler(baseDeps({
      voiceStore: store,
      transcribe: async () => "Walk after dinner",
      voiceChat: {
        async sendAck(_chatId, replyTo) {
          acks.push(replyTo);
          return { messageId: 99 };
        },
        async editMessage() {},
        async sendMessage() {},
        async downloadVoice() {
          return { bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/ogg" };
        },
      },
    }));
    const response = await handler(
      new Request(`${apiUrl}/functions/v1/telegram/${secret}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: voiceUpdate("file-voice-1"),
      }),
    );
    if (!response.ok) throw new Error(`expected grammY to accept the voice update, got ${response.status}`);
    if (acks.length !== 1 || acks[0] !== 4) {
      throw new Error("captureVoiceNote must ack the voice message first");
    }
    const owned = await store.listItemsByUser(userA);
    if (owned.length !== 1 || owned[0].text !== "Walk after dinner") {
      throw new Error("voice capture must insert the transcript item");
    }
    if (VOICE_ACK_TEXT.length === 0) throw new Error("ack helper text must stay exported");
  });

  testFn("voice_ok callback answers so Confirm does not spin", async () => {
    const calls: string[] = [];
    const handler = createTelegramHandler(baseDeps({
      fetch: async (input) => {
        calls.push(String(input));
        return telegramOk();
      },
    }));
    const response = await handler(
      new Request(`${apiUrl}/functions/v1/telegram/${secret}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: voiceOkCallback("item-123"),
      }),
    );
    if (!response.ok) throw new Error(`expected grammY to accept the callback, got ${response.status}`);
    if (!calls.some((url) => url.includes("/answerCallbackQuery"))) {
      throw new Error("voice_ok must call answerCallbackQuery");
    }
  });
}
