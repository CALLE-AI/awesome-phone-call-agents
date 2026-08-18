/**
 * Phase-A smoke test — ONE real call through the CALL-E SDK.
 * Usage: CALLE_API_KEY=... npx tsx scripts/smoke-call.ts +1XXXXXXXXXX
 * (or: node --experimental-strip-types scripts/smoke-call.ts +1XXXXXXXXXX)
 *
 * Asks a single harmless question and prints the full terminal result:
 * status, structured_result, confidence, evidence, transcript turns.
 * This is the binary resource gate (CLAUDE.md rule 1) + physics pre-check.
 */
import { CalleClient } from "@call-e/calle";

const phone = process.argv[2];
if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone)) {
  console.error("usage: smoke-call.ts <E.164 phone you own, e.g. +15551234567>");
  process.exit(1);
}
const apiKey = process.env.CALLE_API_KEY;
if (!apiKey) {
  console.error("CALLE_API_KEY not set (put it in CALL-E/.env and `source` it)");
  process.exit(1);
}

const client = new CalleClient({ apiKey });

const call = await client.calls.createAndWait({
  task:
    `Call ${phone}. Say: "This is a test call from Caucus, a hackathon project. ` +
    `Please say the words 'amber falcon' back to me, and tell me if the audio is clear." ` +
    `Then thank them and end the call politely.`,
  resultSchema: {
    type: "object",
    required: ["phrase_echoed", "audio_clear"],
    properties: {
      phrase_echoed: {
        type: "string",
        description:
          "The exact words the callee repeated back, verbatim. Empty string if they did not repeat anything.",
      },
      audio_clear: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description: "Whether the callee said the audio was clear. unknown if not stated.",
      },
    },
    additionalProperties: false,
  },
});

console.log(JSON.stringify(call, null, 2));
