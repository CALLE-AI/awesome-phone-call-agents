/**
 * Deno tests for T3.3 voice. Side-effect loaded from voice.ts.
 */
import { START_LINK_PROMPT } from "./link.ts";
import { ITEM_SOURCE_TELEGRAM } from "./capture.ts";
import {
  DEFAULT_VOICE_MIME,
  ITEM_AUDIO_BUCKET,
  VOICE_ACK_TEXT,
  VOICE_CONFIRM_BUTTON,
  VOICE_CONFIRM_CALLBACK_PREFIX,
  VOICE_FAIL_TEXT,
  captureVoiceNote,
  createMemoryVoiceStore,
  itemAudioObjectPath,
  itemAudioUrl,
  parseVoiceConfirmCallback,
  recordedVoiceReply,
  vertexGenerateContentUrl,
  voiceConfirmCallbackData,
  voiceConfirmMarkup,
  type VoiceChat,
} from "./voice.ts";
import { createRestVoiceStore } from "./voice_rest.ts";
import { createTelegramVoiceChat } from "./voice_telegram.ts";
import {
  createVertexTranscriber,
  testServiceAccountJson,
  vertexTranscriberFromEnv,
} from "./voice_vertex.ts";

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

  testFn("the item carries a storage link for the uploaded audio", async () => {
    const store = createMemoryVoiceStore([{ id: userA, telegramChatId: chatA }]);
    const result = await captureVoiceNote({
      store,
      chat: recordingChat([]),
      transcribe: async () => thought,
      chatId: chatA,
      messageId: 3,
      fileId: "file-1",
    });
    if (result.status !== "captured") throw new Error(`expected captured, got ${result.status}`);
    if (!result.item.audioUrl.includes(result.item.id)) {
      throw new Error("audio url must include the item id");
    }
    if (!result.item.audioUrl.includes(ITEM_AUDIO_BUCKET)) {
      throw new Error("audio url must point at the item-audio bucket");
    }
    if (result.item.audioUrl.includes("supabase.co")) {
      throw new Error("audio url must use ORMA_API_URL, not the project host");
    }
    const owned = await store.listItemsByUser(userA);
    if (owned.length !== 1) throw new Error(`expected one item, got ${owned.length}`);
    if (owned[0].audioUrl !== result.item.audioUrl) {
      throw new Error("listed item must keep the storage link");
    }
    const other = await store.listItemsByUser(userB);
    if (other.length !== 0) throw new Error("voice capture must not insert under another user");
  });

  testFn("a failed transcription edits the ack with an actionable message and inserts nothing", async () => {
    const log: string[] = [];
    const store = createMemoryVoiceStore([{ id: userA, telegramChatId: chatA }]);
    const result = await captureVoiceNote({
      store,
      chat: recordingChat(log),
      transcribe: async () => {
        throw new Error("model down");
      },
      chatId: chatA,
      messageId: 3,
      fileId: "file-1",
    });
    if (result.status !== "failed") throw new Error(`expected failed, got ${result.status}`);
    if (result.editText !== VOICE_FAIL_TEXT) throw new Error("failed edit must be VOICE_FAIL_TEXT");
    if (result.editText.toLowerCase().includes("error")) {
      throw new Error("failed message must not read as an error dump");
    }
    if (!log.includes(`edit:9:${VOICE_FAIL_TEXT}`)) {
      throw new Error("failed transcription must edit the ack in place");
    }
    if (log.some((line) => line.startsWith("markup:"))) {
      throw new Error("failed transcription must not attach confirm");
    }
    const owned = await store.listItemsByUser(userA);
    if (owned.length !== 0) throw new Error("failed transcription must not insert an item");
  });
}
