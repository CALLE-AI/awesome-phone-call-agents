import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeRealtimeSessionRequest,
  FixedWindowRateLimiter,
  readRealtimeAccessConfig,
} from "../lib/realtime/access";
import { describeRealtimeError } from "../lib/realtime/errors";
import { RealtimeLatencyTracker } from "../lib/realtime/metrics";

function headers(origin: string | null, host = "localhost:3000"): Headers {
  const result = new Headers();
  if (origin) result.set("origin", origin);
  result.set("host", host);
  return result;
}

test("realtime access requires an exact same loopback origin", () => {
  assert.deepEqual(authorizeRealtimeSessionRequest(headers(null)), {
    allowed: false,
    status: 403,
    message: "Origin is not allowed",
  });
  assert.equal(
    authorizeRealtimeSessionRequest(headers("https://attacker.example")).allowed,
    false,
  );
  assert.equal(
    authorizeRealtimeSessionRequest(headers("https://phone.example", "phone.example")).allowed,
    false,
  );
  assert.deepEqual(
    authorizeRealtimeSessionRequest(headers("http://localhost:3000")),
    { allowed: true },
  );
  assert.deepEqual(
    authorizeRealtimeSessionRequest(headers("http://127.0.0.1:3000", "127.0.0.1:3000")),
    { allowed: true },
  );
  assert.equal(
    authorizeRealtimeSessionRequest(headers("http://127.0.0.1:3000", "localhost:3000")).allowed,
    false,
  );
});

test("live realtime configuration fails closed", () => {
  assert.throws(() => readRealtimeAccessConfig({}));
  assert.deepEqual(readRealtimeAccessConfig({ OPENAI_API_KEY: "api-key-long-enough-for-test" }), {
    apiKey: "api-key-long-enough-for-test",
  });
});

test("session creation is rate limited within a fixed window", () => {
  const limiter = new FixedWindowRateLimiter(2, 1_000);
  assert.equal(limiter.consume(100), true);
  assert.equal(limiter.consume(200), true);
  assert.equal(limiter.consume(300), false);
  assert.equal(limiter.consume(1_100), true);
});

test("latency tracker records one first-audio measurement per turn", () => {
  const tracker = new RealtimeLatencyTracker();
  assert.equal(tracker.recordTransportEvent("input_audio_buffer.speech_stopped", 100), undefined);
  const measurement = tracker.recordTransportEvent("output_audio_buffer.started", 475);
  assert.equal(measurement?.milliseconds, 375);
  assert.equal(measurement?.turn, 1);
  assert.equal(typeof measurement?.measuredAt, "string");
  assert.equal(tracker.recordTransportEvent("response.output_audio.delta", 500), undefined);
});

test("latency tracker also supports audio deltas used by non-WebRTC transports", () => {
  const tracker = new RealtimeLatencyTracker();
  tracker.recordTransportEvent("input_audio_buffer.speech_stopped", 200);
  assert.equal(tracker.recordTransportEvent("response.output_audio.delta", 550)?.milliseconds, 350);
});

test("realtime diagnostics expose only a bounded provider code", () => {
  assert.deepEqual(
    describeRealtimeError({ error: { code: "conversation_already_has_active_response", message: "private detail" } }),
    { code: "conversation_already_has_active_response" },
  );
  assert.deepEqual(describeRealtimeError(new Error("private detail")), { code: "unknown" });
  assert.equal(describeRealtimeError({ code: "x".repeat(200) }).code.length, 80);
});
