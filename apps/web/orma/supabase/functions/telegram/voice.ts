/**
 * T3.3 Telegram voice capture.
 *
 * Acknowledge first. Then download Opus, transcribe with Gemini, and store audio.
 * Edit the ack in place with the transcript and a confirm control.
 *
 * The bot never stays silent while the model runs.
 * A failed transcription edits the ack with a line a human can act on.
 *
 * Pin ack, edit, stored audio, and failure with:
 * `deno test --allow-read supabase/functions/telegram/voice.ts`
 *
 * T3.1 should call `captureVoiceNote` for a voice update.
 * It should not wait on Gemini before that call returns the ack path.
 */
import { recordedCaptureReply, ITEM_SOURCE_TELEGRAM } from "./capture.ts";
import type { CaptureProfile } from "./capture.ts";
import { START_LINK_PROMPT } from "./link.ts";

export const ITEM_AUDIO_BUCKET = "item-audio";
export const VOICE_ACK_TEXT = "Got it. Transcribing now.";
export const VOICE_FAIL_TEXT =
  "I could not transcribe that voice note. Send the thought as text, or try another voice note.";
export const VOICE_CONFIRM_CALLBACK_PREFIX = "voice_ok:";
export const VOICE_CONFIRM_BUTTON = "Confirm";
export const DEFAULT_VOICE_MIME = "audio/ogg";

export type VoiceItem = {
  id: string;
  userId: string;
  text: string;
  source: typeof ITEM_SOURCE_TELEGRAM;
  audioUrl: string;
};

export type VoiceReplyMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export type AckMessage = {
  messageId: number;
};

export interface VoiceChat {
  sendAck(chatId: number, replyToMessageId: number): Promise<AckMessage>;
  editMessage(
    chatId: number,
    messageId: number,
    text: string,
    replyMarkup?: VoiceReplyMarkup,
  ): Promise<void>;
  sendMessage(
    chatId: number,
    text: string,
    replyMarkup?: VoiceReplyMarkup,
  ): Promise<void>;
  downloadVoice(fileId: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
}

export interface VoiceStore {
  findProfileByChatId(chatId: number): Promise<CaptureProfile | null>;
  insertVoiceItem(input: {
    id: string;
    userId: string;
    text: string;
    audio: Uint8Array;
    mimeType: string;
  }): Promise<VoiceItem>;
  listItemsByUser(userId: string): Promise<VoiceItem[]>;
}

export type TranscribeVoice = (audio: Uint8Array, mimeType: string) => Promise<string>;

export type VoiceCaptureResult =
  | { status: "unlinked"; ackMessageId: number }
  | { status: "captured"; ackMessageId: number; item: VoiceItem; editText: string }
  | { status: "failed"; ackMessageId: number; editText: string };

export function itemAudioObjectPath(userId: string, itemId: string): string {
  return `${userId}/${itemId}.ogg`;
}

export function itemAudioUrl(apiUrl: string, userId: string, itemId: string): string {
  const base = apiUrl.replace(/\/+$/, "");
  const objectPath = itemAudioObjectPath(userId, itemId);
  return `${base}/storage/v1/object/${ITEM_AUDIO_BUCKET}/${objectPath}`;
}

export function voiceConfirmCallbackData(itemId: string): string {
  return `${VOICE_CONFIRM_CALLBACK_PREFIX}${itemId}`;
}

export function parseVoiceConfirmCallback(data: string | undefined): string | null {
  if (typeof data !== "string") return null;
  if (!data.startsWith(VOICE_CONFIRM_CALLBACK_PREFIX)) return null;
  const itemId = data.slice(VOICE_CONFIRM_CALLBACK_PREFIX.length);
  if (itemId === "") return null;
  return itemId;
}

export function voiceConfirmMarkup(itemId: string): VoiceReplyMarkup {
  return {
    inline_keyboard: [
      [{ text: VOICE_CONFIRM_BUTTON, callback_data: voiceConfirmCallbackData(itemId) }],
    ],
  };
}

export function recordedVoiceReply(text: string): string {
  return recordedCaptureReply(text);
}

export { vertexGenerateContentUrl } from "../_shared/vertex.ts";

export async function captureVoiceNote(args: {
  store: VoiceStore;
  chat: VoiceChat;
  transcribe: TranscribeVoice;
  chatId: number;
  messageId: number;
  fileId: string;
}): Promise<VoiceCaptureResult> {
  const ack = await args.chat.sendAck(args.chatId, args.messageId);

  try {
    const profile = await args.store.findProfileByChatId(args.chatId);
    if (profile === null) {
      await args.chat.editMessage(args.chatId, ack.messageId, START_LINK_PROMPT);
      return { status: "unlinked", ackMessageId: ack.messageId };
    }

    const file = await args.chat.downloadVoice(args.fileId);
    const raw = await args.transcribe(file.bytes, file.mimeType);
    const text = raw.trim();
    if (text === "") {
      await args.chat.editMessage(args.chatId, ack.messageId, VOICE_FAIL_TEXT);
      return {
        status: "failed",
        ackMessageId: ack.messageId,
        editText: VOICE_FAIL_TEXT,
      };
    }

    const itemId = crypto.randomUUID();
    const item = await args.store.insertVoiceItem({
      id: itemId,
      userId: profile.id,
      text,
      audio: file.bytes,
      mimeType: file.mimeType,
    });
    if (item.userId !== profile.id) {
      throw new Error("inserted voice item user must match the linked profile");
    }
    if (item.source !== ITEM_SOURCE_TELEGRAM) {
      throw new Error("inserted voice item source must be telegram");
    }
    if (item.text !== text) {
      throw new Error("inserted voice item text must match the transcript");
    }
    if (!item.audioUrl.includes(item.id)) {
      throw new Error("inserted voice item must carry a storage link for this item");
    }

    const editText = recordedVoiceReply(item.text);
    const markup = voiceConfirmMarkup(item.id);
    try {
      await args.chat.editMessage(
        args.chatId,
        ack.messageId,
        editText,
        markup,
      );
    } catch {
      try {
        await args.chat.sendMessage(args.chatId, editText, markup);
      } catch {
        // Item is stored. Leave the ack rather than show VOICE_FAIL_TEXT.
      }
    }
    return {
      status: "captured",
      ackMessageId: ack.messageId,
      item,
      editText,
    };
  } catch {
    try {
      await args.chat.editMessage(args.chatId, ack.messageId, VOICE_FAIL_TEXT);
    } catch {
      // Best effort on the fail path. Status is already failed.
    }
    return {
      status: "failed",
      ackMessageId: ack.messageId,
      editText: VOICE_FAIL_TEXT,
    };
  }
}

export function createMemoryVoiceStore(
  seed: Array<{ id: string; telegramChatId?: number | null }> = [],
): VoiceStore {
  const profiles = new Map<string, CaptureProfile & { telegramChatId: number | null }>();
  const items: VoiceItem[] = [];
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
    async insertVoiceItem(input) {
      const item: VoiceItem = {
        id: input.id,
        userId: input.userId,
        text: input.text,
        source: ITEM_SOURCE_TELEGRAM,
        audioUrl: itemAudioUrl("https://orma-api.nryn.dev", input.userId, input.id),
      };
      items.push(item);
      return { ...item };
    },
    async listItemsByUser(userId) {
      return items.filter((item) => item.userId === userId).map((item) => ({ ...item }));
    },
  };
}

export type { RestVoiceStoreDeps } from "./voice_rest.ts";
export { createRestVoiceStore } from "./voice_rest.ts";
export type { TelegramVoiceChatDeps } from "./voice_telegram.ts";
export { createTelegramVoiceChat } from "./voice_telegram.ts";
export type { VertexTranscriberDeps } from "./voice_vertex.ts";
export { createVertexTranscriber, vertexTranscriberFromEnv } from "./voice_vertex.ts";
import "./voice_tests.ts";
