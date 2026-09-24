/**
 * Telegram Bot API adapter for T3.3 voice ack/edit/send/download.
 */
import {
  DEFAULT_VOICE_MIME,
  VOICE_ACK_TEXT,
  type AckMessage,
  type VoiceChat,
  type VoiceReplyMarkup,
} from "./voice.ts";

export type TelegramVoiceChatDeps = {
  botToken: string;
  fetch: typeof fetch;
};

export function createTelegramVoiceChat(deps: TelegramVoiceChatDeps): VoiceChat {
  const api = `https://api.telegram.org/bot${deps.botToken}`;
  const files = `https://api.telegram.org/file/bot${deps.botToken}`;

  return {
    async sendAck(chatId, replyToMessageId) {
      const response = await deps.fetch(`${api}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: VOICE_ACK_TEXT,
          reply_to_message_id: replyToMessageId,
        }),
      });
      if (!response.ok) throw new Error("voice ack send failed");
      const parsed = (await response.json()) as {
        ok?: boolean;
        result?: { message_id?: number };
      };
      const messageId = parsed.result?.message_id;
      if (parsed.ok !== true || typeof messageId !== "number") {
        throw new Error("voice ack send failed");
      }
      return { messageId };
    },
    async editMessage(chatId, messageId, text, replyMarkup) {
      const body: Record<string, unknown> = {
        chat_id: chatId,
        message_id: messageId,
        text,
      };
      if (replyMarkup) body.reply_markup = replyMarkup;
      const response = await deps.fetch(`${api}/editMessageText`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("voice edit failed");
    },
    async sendMessage(chatId, text, replyMarkup) {
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text,
      };
      if (replyMarkup) body.reply_markup = replyMarkup;
      const response = await deps.fetch(`${api}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("voice follow-up send failed");
      const parsed = (await response.json()) as { ok?: boolean };
      if (parsed.ok !== true) throw new Error("voice follow-up send failed");
    },
    async downloadVoice(fileId) {
      const meta = await deps.fetch(`${api}/getFile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file_id: fileId }),
      });
      if (!meta.ok) throw new Error("voice file lookup failed");
      const parsed = (await meta.json()) as {
        ok?: boolean;
        result?: { file_path?: string };
      };
      const filePath = parsed.result?.file_path;
      if (parsed.ok !== true || typeof filePath !== "string" || filePath === "") {
        throw new Error("voice file lookup failed");
      }
      const file = await deps.fetch(`${files}/${filePath}`);
      if (!file.ok) throw new Error("voice file download failed");
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { bytes, mimeType: DEFAULT_VOICE_MIME };
    },
  };
}
