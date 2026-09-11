import assert from "node:assert/strict";
import test from "node:test";

import { parseWebhookEvent, WebhookInputError } from "../lib/calle/webhook-event";
import {
  hasValidWebhookToken,
  liveCalleWebhookUrl,
} from "../lib/calle/webhook-url";

const eventId = "evt_terminal_1";
const event = {
  id: eventId,
  type: "call.completed",
  created_at: "2026-08-29T12:00:00.000Z",
  data: {
    id: "call_123",
    status: "completed",
    structured_result: { qualified: true, next_step: "book_advisor" },
    summary: "The recipient requested an adviser appointment.",
    failure_code: null,
    failure_message: null,
    completed_at: "2026-08-29T11:59:59.000Z",
    metadata: {
      campaignId: "11111111-1111-4111-8111-111111111111",
      contactId: "22222222-2222-4222-8222-222222222222",
      veyraCallResultId: "33333333-3333-4333-8333-333333333333",
    },
    recipients: [
      {
        summary: "Appointment requested.",
        structured_result: null,
        attempts: [
          {
            transcript_turns: [
              { offset_seconds: 0, speaker: "bot", text: "Hello." },
              { offset_seconds: 2.5, speaker: "user", text: "Yes, go ahead." },
            ],
          },
        ],
      },
    ],
  },
};

test("terminal webhook parses structured result and readable transcript", () => {
  const parsed = parseWebhookEvent(event, eventId);
  assert.equal(parsed.call.status, "completed");
  assert.equal(parsed.call.qualified, true);
  assert.deepEqual(parsed.call.capturedData, event.data.structured_result);
  assert.equal(parsed.call.transcript, "[bot 0s] Hello.\n[user 2.5s] Yes, go ahead.");
});

test("webhook rejects mismatched event headers and unknown event types", () => {
  assert.throws(() => parseWebhookEvent(event, "evt_different"), WebhookInputError);
  assert.throws(
    () => parseWebhookEvent({ ...event, type: "call.started" }, eventId),
    WebhookInputError,
  );
});

test("result validation failures receive an explicit terminal failure code", () => {
  const parsed = parseWebhookEvent(
    {
      ...event,
      type: "call.result_validation_failed",
      data: { ...event.data, structured_result: null, failure_code: null },
    },
    eventId,
  );
  assert.equal(parsed.call.status, "result_validation_failed");
  assert.equal(parsed.call.failureCode, "result_validation_failed");
});

test("live webhook URL requires HTTPS and a long secret token", () => {
  const previousUrl = process.env.APP_URL;
  const previousToken = process.env.CALLE_WEBHOOK_TOKEN;
  try {
    process.env.APP_URL = "https://veyra.example/base";
    process.env.CALLE_WEBHOOK_TOKEN = "w".repeat(32);
    const url = liveCalleWebhookUrl();
    assert.equal(url, `https://veyra.example/api/calle/webhook?token=${"w".repeat(32)}`);
    assert.equal(hasValidWebhookToken(url), true);
    assert.equal(
      hasValidWebhookToken("https://veyra.example/api/calle/webhook?token=wrong"),
      false,
    );

    process.env.APP_URL = "http://localhost:3000";
    assert.throws(() => liveCalleWebhookUrl(), /HTTPS/);
  } finally {
    if (previousUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousUrl;
    if (previousToken === undefined) delete process.env.CALLE_WEBHOOK_TOKEN;
    else process.env.CALLE_WEBHOOK_TOKEN = previousToken;
  }
});
