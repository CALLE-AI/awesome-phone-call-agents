export interface ConversationNote {
  readonly id: string;
  readonly role: "caller" | "assistant";
  readonly text: string;
}

export interface SavedConversation {
  readonly id: string;
  readonly notes: ConversationNote[];
  readonly savedAt: string;
}

const MAX_NOTE_LENGTH = 2_000;
const MAX_SAVED_CONVERSATIONS = 10;

export function extractConversationNotes(history: unknown): ConversationNote[] {
  if (!Array.isArray(history)) return [];
  return history.flatMap((value, index): ConversationNote[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (item.role !== "user" && item.role !== "assistant") return [];
    const content = Array.isArray(item.content) ? item.content : [];
    const text = content.flatMap((part): string[] => {
      if (!part || typeof part !== "object") return [];
      const record = part as Record<string, unknown>;
      const candidate = typeof record.transcript === "string"
        ? record.transcript
        : typeof record.text === "string" ? record.text : "";
      return candidate.trim() ? [candidate.trim()] : [];
    }).join(" ").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, "").slice(0, MAX_NOTE_LENGTH);
    if (!text) return [];
    return [{
      id: typeof item.id === "string" ? item.id.slice(0, 160) : `conversation-${index}`,
      role: item.role === "user" ? "caller" : "assistant",
      text,
    }];
  });
}

export function readSavedConversations(raw: string | null): SavedConversation[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_SAVED_CONVERSATIONS).flatMap((entry): SavedConversation[] => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const notes = extractConversationNotes(
        Array.isArray(record.notes)
          ? record.notes.map((note) => {
              const item = note as Record<string, unknown>;
              return { id: item.id, role: item.role === "caller" ? "user" : item.role, content: [{ text: item.text }] };
            })
          : [],
      );
      if (typeof record.id !== "string" || typeof record.savedAt !== "string" || notes.length === 0) return [];
      return [{ id: record.id.slice(0, 160), notes, savedAt: record.savedAt }];
    });
  } catch {
    return [];
  }
}

export function saveConversation(
  conversations: SavedConversation[],
  conversation: SavedConversation,
): SavedConversation[] {
  if (!conversation.notes.length) return conversations;
  return [conversation, ...conversations.filter((item) => item.id !== conversation.id)]
    .slice(0, MAX_SAVED_CONVERSATIONS);
}
