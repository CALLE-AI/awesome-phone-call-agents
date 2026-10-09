import assert from "node:assert/strict";
import test from "node:test";

import { extractConversationNotes, readSavedConversations, saveConversation } from "../lib/realtime/conversation-notes";

test("conversation notes include caller and assistant text but exclude tools", () => {
  assert.deepEqual(extractConversationNotes([
    { id: "u1", role: "user", content: [{ type: "input_audio", transcript: "Please find an event." }] },
    { id: "tool1", role: "tool", content: [{ text: "untrusted payload" }] },
    { id: "a1", role: "assistant", content: [{ type: "audio", transcript: "I found three options." }] },
  ]), [
    { id: "u1", role: "caller", text: "Please find an event." },
    { id: "a1", role: "assistant", text: "I found three options." },
  ]);
});

test("saved conversation parsing fails closed and retention is bounded", () => {
  assert.deepEqual(readSavedConversations("not-json"), []);
  const conversations = Array.from({ length: 12 }, (_, index) => ({
    id: `session-${index}`,
    notes: [{ id: `note-${index}`, role: "caller" as const, text: `Note ${index}` }],
    savedAt: "2026-09-11T00:00:00.000Z",
  })).reduce((items, item) => saveConversation(items, item), [] as ReturnType<typeof readSavedConversations>);
  assert.equal(conversations.length, 10);
});
