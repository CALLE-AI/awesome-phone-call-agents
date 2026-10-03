/**
 * Rest/storage adapter for T3.3 voice items.
 * Reach the API through ORMA_API_URL. Never use a project host.
 */
import { ITEM_SOURCE_TELEGRAM } from "./capture.ts";
import {
  ITEM_AUDIO_BUCKET,
  itemAudioObjectPath,
  itemAudioUrl,
  type VoiceItem,
  type VoiceStore,
} from "./voice.ts";

export type RestVoiceStoreDeps = {
  apiUrl: string;
  serviceRoleKey: string;
  fetch: typeof fetch;
};

/**
 * PostgREST plus Storage adapter for a voice item.
 * Reach the API through `ORMA_API_URL`. Never use a project host.
 * Auth uses `SUPABASE_SERVICE_ROLE_KEY`. Do not log the key.
 */
export function createRestVoiceStore(deps: RestVoiceStoreDeps): VoiceStore {
  const base = deps.apiUrl.replace(/\/+$/, "");
  const key = deps.serviceRoleKey;

  const headers = (prefer?: string): Record<string, string> => {
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
    async insertVoiceItem(input) {
      const objectPath = itemAudioObjectPath(input.userId, input.id);
      const audioUrl = itemAudioUrl(base, input.userId, input.id);
      const audioBody = new ArrayBuffer(input.audio.byteLength);
      new Uint8Array(audioBody).set(input.audio);
      const upload = await deps.fetch(
        `${base}/storage/v1/object/${ITEM_AUDIO_BUCKET}/${objectPath}`,
        {
          method: "POST",
          headers: {
            apikey: key,
            authorization: `Bearer ${key}`,
            "content-type": input.mimeType,
            "x-upsert": "true",
          },
          body: audioBody,
        },
      );
      if (!upload.ok) throw new Error("voice audio upload failed");

      const response = await deps.fetch(`${base}/rest/v1/items`, {
        method: "POST",
        headers: headers("return=representation"),
        body: JSON.stringify({
          id: input.id,
          user_id: input.userId,
          text: input.text,
          source: ITEM_SOURCE_TELEGRAM,
          audio_url: audioUrl,
        }),
      });
      if (!response.ok) throw new Error("items insert failed");
      const rows = (await response.json()) as RestVoiceItemRow[];
      if (rows.length !== 1) throw new Error("items insert must return one row");
      return fromRestVoiceItem(rows[0]);
    },
    async listItemsByUser(userId) {
      const response = await deps.fetch(
        url(
          "items",
          `user_id=eq.${encodeURIComponent(userId)}&select=id,user_id,text,source,audio_url`,
        ),
        { headers: headers() },
      );
      if (!response.ok) throw new Error("items read failed");
      const rows = (await response.json()) as RestVoiceItemRow[];
      return rows.map(fromRestVoiceItem);
    },
  };
}

type RestProfileRow = {
  id: string;
  telegram_chat_id: number | null;
};

type RestVoiceItemRow = {
  id: string;
  user_id: string;
  text: string;
  source: string;
  audio_url: string;
};

function fromRestVoiceItem(row: RestVoiceItemRow): VoiceItem {
  if (row.source !== ITEM_SOURCE_TELEGRAM) {
    throw new Error("items row source must be telegram");
  }
  if (!row.audio_url) {
    throw new Error("items row must carry audio_url");
  }
  return {
    id: row.id,
    userId: row.user_id,
    text: row.text,
    source: ITEM_SOURCE_TELEGRAM,
    audioUrl: row.audio_url,
  };
}
