// Smoke client: create one call against a running fake-calle-server, poll it
// to a terminal status, and print the structured result and transcript.
//
// Terminal 1: node fake-calle-server.mjs
// Terminal 2: node examples/smoke-client.mjs
// No credentials are needed; the fake server accepts any non-empty Bearer token.

const BASE_URL = process.env.FAKE_CALLE_BASE_URL ?? "http://127.0.0.1:8787";
const TERMINAL = new Set(["completed", "failed", "no_answer", "voicemail", "busy", "declined", "canceled"]);

const createResponse = await fetch(`${BASE_URL}/v1/calls`, {
  method: "POST",
  headers: {
    authorization: "Bearer smoke-client",
    "content-type": "application/json",
    "idempotency-key": `smoke_${Date.now()}`,
  },
  body: JSON.stringify({
    task: "Call the recipient and ask whether they can attend Friday lunch.",
    recipients: [{ phones: ["+15555550100"], region: "US", locale: "en-US" }],
    recipient_result_schema: {
      type: "object",
      required: ["can_attend"],
      properties: { can_attend: { type: "string", enum: ["yes", "no", "unknown"] } },
    },
    result_schema: {
      type: "object",
      required: ["completed_count"],
      properties: { completed_count: { type: "integer" } },
    },
    metadata: { scenario: "completed" },
  }),
});
const created = await createResponse.json();
console.log(`created: ${created.call_id} (status ${created.status})`);

let call = created;
while (!TERMINAL.has(call.status)) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const poll = await fetch(`${BASE_URL}/v1/calls/${created.call_id}`, {
    headers: { authorization: "Bearer smoke-client" },
  });
  call = await poll.json();
  console.log(`poll: ${call.status}`);
}

console.log("terminal:", call.status, "task_completed:", call.task_completed);
console.log("structured_result:", JSON.stringify(call.structured_result));
console.log("evidence:", JSON.stringify(call.evidence, null, 2));
const turns = call.recipients[0]?.attempts[0]?.transcript_turns ?? [];
for (const turn of turns) {
  console.log(`  [${String(turn.offset_seconds).padStart(2, "0")}s] ${turn.speaker.toUpperCase()}: ${turn.text}`);
}
