/**
 * Deno tests for T3.3 voice (part C).
 */
import { START_LINK_PROMPT } from "./link.ts";
import { ITEM_SOURCE_TELEGRAM } from "./capture.ts";
import {
  DEFAULT_VOICE_MIME,
  VOICE_FAIL_TEXT,
  captureVoiceNote,
  createMemoryVoiceStore,
  itemAudioUrl,
  type VoiceChat,
} from "./voice.ts";
import { createRestVoiceStore } from "./voice_rest.ts";

const testFn = (Deno as { test?: (name: string, fn: () => Promise<void>) => void }).test;
if (typeof testFn === "function" && !import.meta.main) {
  const userA = "00000000-0000-4000-8000-00000000000a";
  const userB = "00000000-0000-4000-8000-00000000000b";
  const chatA = 1001;
  const thought = "Book a dentist appointment";
  const opus = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x01]);

  function recordingChat(log: string[]): VoiceChat & { ackAt?: number; workAt?: number } {
    const chat: VoiceChat & { ackAt?: number; workAt?: number } = {
      async sendAck() {
        chat.ackAt = Date.now();
        log.push("ack");
        return { messageId: 9 };
      },
      async editMessage(_chatId, messageId, text, replyMarkup) {
        log.push(`edit:${messageId}:${text}`);
        if (replyMarkup) {
          log.push(`markup:${replyMarkup.inline_keyboard[0][0].callback_data}`);
        }
      },
      async sendMessage(_chatId, text, replyMarkup) {
        log.push(`send:${text}`);
        if (replyMarkup) {
          log.push(`send-markup:${replyMarkup.inline_keyboard[0][0].callback_data}`);
        }
      },
      async downloadVoice() {
        chat.workAt = Date.now();
        log.push("download");
        return { bytes: opus, mimeType: DEFAULT_VOICE_MIME };
      },
    };
    return chat;
  }

  testFn("an empty transcript is a failed capture the user can act on", async () => {
    const store = createMemoryVoiceStore([{ id: userA, telegramChatId: chatA }]);
    const result = await captureVoiceNote({
      store,
      chat: recordingChat([]),
      transcribe: async () => "   ",
      chatId: chatA,
      messageId: 3,
      fileId: "file-1",
    });
    if (result.status !== "failed") throw new Error(`expected failed, got ${result.status}`);
    if (result.editText !== VOICE_FAIL_TEXT) throw new Error("empty transcript must use VOICE_FAIL_TEXT");
    const owned = await store.listItemsByUser(userA);
    if (owned.length !== 0) throw new Error("empty transcript must not insert an item");
  });

  testFn("an unlinked chat is acknowledged then prompted, with no item", async () => {
    const log: string[] = [];
    const store = createMemoryVoiceStore([{ id: userA }]);
    const result = await captureVoiceNote({
      store,
      chat: recordingChat(log),
      transcribe: async () => {
        throw new Error("transcribe must not run for an unlinked chat");
      },
      chatId: chatA,
      messageId: 3,
      fileId: "file-1",
    });
    if (result.status !== "unlinked") throw new Error(`expected unlinked, got ${result.status}`);
    if (log[0] !== "ack") throw new Error("unlinked voice must still ack first");
    if (!log.includes(`edit:9:${START_LINK_PROMPT}`)) {
      throw new Error("unlinked voice must edit the ack to START_LINK_PROMPT");
    }
    if (log.includes("download")) throw new Error("unlinked voice must not download audio");
    const owned = await store.listItemsByUser(userA);
    if (owned.length !== 0) throw new Error("unlinked voice must not insert an item");
  });

  testFn("rest store uploads audio then inserts audio_url through ORMA_API_URL", async () => {
    const calls: Array<{ url: string; method: string; body: string; contentType: string }> = [];
    const itemId = "30000000-0000-4000-8000-00000000000a";
    const store = createRestVoiceStore({
      apiUrl: "https://orma-api.nryn.dev",
      serviceRoleKey: "service-role-test-value",
      fetch: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const contentType = new Headers(init?.headers).get("content-type") ?? "";
        let body = "";
        if (typeof init?.body === "string") body = init.body;
        else if (init?.body instanceof ArrayBuffer) body = `bytes:${init.body.byteLength}`;
        else if (init?.body instanceof Uint8Array) body = `bytes:${init.body.length}`;
        else if (init?.body instanceof Blob) body = `bytes:${init.body.size}`;
        calls.push({ url, method, body, contentType });
        if (url.includes("supabase.co")) throw new Error("must not use the project host");
        if (url.includes("profiles") && method === "GET") {
          return new Response(
            JSON.stringify([{ id: userA, telegram_chat_id: chatA }]),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/storage/v1/object/") && method === "POST") {
          return new Response(JSON.stringify({ Key: "item-audio/x" }), { status: 200 });
        }
        if (url.includes("/items") && method === "POST") {
          const posted = JSON.parse(body) as {
            id: string;
            user_id: string;
            text: string;
            source: string;
            audio_url: string;
          };
          return new Response(JSON.stringify([posted]), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`unexpected fetch ${method} ${url}`);
      },
    });
    const item = await store.insertVoiceItem({
      id: itemId,
      userId: userA,
      text: thought,
      audio: opus,
      mimeType: DEFAULT_VOICE_MIME,
    });
    const upload = calls.find((call) => call.method === "POST" && call.url.includes("/storage/v1/object/"));
    if (!upload) throw new Error("voice store must POST the audio object");
    if (!upload.url.startsWith("https://orma-api.nryn.dev/storage/v1/object/item-audio/")) {
      throw new Error("audio upload must use ORMA_API_URL and item-audio");
    }
    if (!upload.url.includes(itemId)) throw new Error("object path must include the item id");
    if (upload.contentType !== DEFAULT_VOICE_MIME) {
      throw new Error("upload must send the Opus mime type");
    }
    const insert = calls.find((call) => call.method === "POST" && call.url.includes("/rest/v1/items"));
    if (!insert) throw new Error("voice store must POST /rest/v1/items");
    if (!insert.body.includes(`"audio_url":"${item.audioUrl}"`)) {
      throw new Error("insert body must set audio_url to the storage link");
    }
    if (!insert.body.includes(`"source":"${ITEM_SOURCE_TELEGRAM}"`)) {
      throw new Error("insert body must set source telegram");
    }
    if (insert.body.includes("service-role-test-value")) {
      throw new Error("service role key must not appear in the items body");
    }
    if (item.audioUrl !== itemAudioUrl("https://orma-api.nryn.dev", userA, itemId)) {
      throw new Error("returned item must carry the storage link");
    }
    const uploadIndex = calls.findIndex((call) => call.url.includes("/storage/v1/object/"));
    const insertIndex = calls.findIndex((call) => call.url.includes("/rest/v1/items"));
    if (uploadIndex < 0 || insertIndex < 0 || uploadIndex > insertIndex) {
      throw new Error("audio must upload before the items insert");
    }
  });

}
