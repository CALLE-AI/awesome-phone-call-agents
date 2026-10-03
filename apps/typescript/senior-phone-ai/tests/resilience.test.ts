import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { parseCalleCallSnapshot } from "../lib/calle/status";
import { createSafeWorkflowEvent } from "../lib/observability/safe-event";
import { RealtimeLatencyTracker } from "../lib/realtime/metrics";

test("malformed provider results fail closed without leaking provider fields", () => {
  for (const value of [null, [], {}, { id: "../secret", status: "completed" }]) {
    assert.throws(() => parseCalleCallSnapshot(value), /invalid CALL-E/);
  }
  const snapshot = parseCalleCallSnapshot({
    id: "call_malformed-safe",
    status: "unexpected",
    api_key: "fixture-secret-that-must-not-escape",
    failure: { stack: "private provider stack" },
    recipients: "wrong shape",
  });
  assert.equal(snapshot.outcome, "unknown");
  assert.equal(JSON.stringify(snapshot).includes("fixture-secret"), false);
  assert.equal(JSON.stringify(snapshot).includes("provider stack"), false);
});

test("disconnected realtime turns discard unfinished latency state", () => {
  const tracker = new RealtimeLatencyTracker();
  tracker.recordTransportEvent("input_audio_buffer.speech_stopped", 100);
  tracker.reset();
  assert.equal(tracker.recordTransportEvent("output_audio_buffer.started", 200), undefined);
});

test("safe workflow events contain correlation, bounded metrics and masked destinations only", () => {
  const event = createSafeWorkflowEvent({
    at: "2026-09-11T03:00:00.000Z",
    component: "call",
    correlationId: "44444444-4444-4444-8444-444444444444",
    destinationE164: "+61449852021",
    latencyMs: 845,
    outcome: "unknown",
    providerCode: "timeout <secret detail>",
  });
  assert.deepEqual(event, {
    at: "2026-09-11T03:00:00.000Z", component: "call",
    correlationId: "44444444-4444-4444-8444-444444444444",
    destination: "[phone ending 2021]", latencyMs: 845,
    outcome: "unknown", providerCode: "timeout__secret_detail_",
  });
  assert.equal(JSON.stringify(event).includes("+61449852021"), false);
  assert.throws(() => createSafeWorkflowEvent({ component: "call", correlationId: "bad", outcome: "completed" }));
  assert.throws(() => createSafeWorkflowEvent({ component: "call", correlationId: "44444444-4444-4444-8444-444444444444", outcome: "completed", latencyMs: 999_999 }));
});

test("untrusted provider HTML is escaped when rendered", () => {
  const malicious = '<img src=x onerror="alert(1)"> Call 0449 852 021';
  const html = renderToStaticMarkup(createElement("p", null, malicious));
  assert.equal(html.includes("<img"), false);
  assert.match(html, /&lt;img/);
});
