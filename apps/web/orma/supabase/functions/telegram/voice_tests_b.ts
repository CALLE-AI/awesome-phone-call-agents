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

  testFn("acknowledge is the first side effect and lands within a second", async () => {
    const log: string[] = [];
    const chat = recordingChat(log);
    let transcribeStarted = false;
    const store = createMemoryVoiceStore([{ id: userA, telegramChatId: chatA }]);
    const result = await captureVoiceNote({
      store,
      chat,
      transcribe: async () => {
        transcribeStarted = true;
        if (log[0] !== "ack") throw new Error("transcribe must not start before ack");
        log.push("transcribe");
        return thought;
      },
      chatId: chatA,
      messageId: 3,
      fileId: "file-1",
    });
    if (log[0] !== "ack") throw new Error(`expected ack first, got ${log.join(",")}`);
    if (typeof chat.ackAt !== "number" || typeof chat.workAt !== "number") {
      throw new Error("ack and download must both run");
    }
    if (chat.workAt < chat.ackAt) throw new Error("download must not precede ack");
    if (chat.workAt - chat.ackAt >= 1000) {
      throw new Error("ack to download must stay under one second in this double");
    }
    if (!transcribeStarted) throw new Error("transcribe must run after ack");
    if (result.status !== "captured") throw new Error(`expected captured, got ${result.status}`);
    if (result.ackMessageId !== 9) throw new Error("result must name the ack message");
  });

  testFn("the ack message is edited in place with the transcript and confirm control", async () => {
    const log: string[] = [];
    const chat = recordingChat(log);
    const store = createMemoryVoiceStore([{ id: userA, telegramChatId: chatA }]);
    const result = await captureVoiceNote({
      store,
      chat,
      transcribe: async () => thought,
      chatId: chatA,
      messageId: 3,
      fileId: "file-1",
    });
    if (result.status !== "captured") throw new Error(`expected captured, got ${result.status}`);
    const expected = recordedVoiceReply(thought);
    if (result.editText !== expected) throw new Error("edit text must quote the transcript");
    const edit = log.find((line) => line.startsWith("edit:9:"));
    if (edit !== `edit:9:${expected}`) {
      throw new Error("must edit the ack message with the recorded transcript");
    }
    const markup = log.find((line) => line.startsWith("markup:"));
    if (markup !== `markup:${voiceConfirmCallbackData(result.item.id)}`) {
      throw new Error("edit must attach the confirm control for this item");
    }
    if (parseVoiceConfirmCallback(voiceConfirmCallbackData(result.item.id)) !== result.item.id) {
      throw new Error("confirm callback must round-trip the item id");
    }
  });

}
