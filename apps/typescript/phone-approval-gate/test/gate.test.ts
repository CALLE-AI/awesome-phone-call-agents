/**
 * Gate behaviour against a stub port.
 *
 * The end to end suite drives the real `@call-e/calle` client against the fake
 * server. These tests reach the paths a server cannot produce on demand: a poll
 * that fails after the call exists, a clock that runs past the window while a
 * call is in flight and a call that finished before this run's window opened.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { GateApiError, type CallePort, type CreateCallInput } from "../src/calle.js";
import { decidedInWindow, runGate } from "../src/gate.js";
import type { CallSnapshot, TranscriptTurn } from "../src/types.js";
import { BOB_PHONE, FIXED_SECRET, approvalRequest, requestInput } from "./fixtures.js";

const APPROVE_TURNS: TranscriptTurn[] = [
  { offset_seconds: 0, speaker: "bot", text: "Decision please." },
  { offset_seconds: 4, speaker: "user", text: "Four seven two nine one three, I approve." },
];

function snapshot(options: { id: string; completedAt: string; status?: string }): CallSnapshot {
  return {
    id: options.id,
    status: options.status ?? "completed",
    recipients: [
      {
        id: "rcp_1",
        phones: ["+14155550100"],
        status: "completed",
        structuredResult: { decision: "approve", spoken_code: "472913", reason: "ok" },
        summary: "done",
        attempts: [
          {
            id: "att_1",
            phone: "+14155550100",
            status: "completed",
            startedAt: options.completedAt,
            completedAt: options.completedAt,
            summary: null,
            transcriptTurns: APPROVE_TURNS,
            providerCallId: "provider_1",
            failureCode: null,
            failureMessage: null,
          },
        ],
      },
    ],
    structuredResult: { decision: "approve", spoken_code: "472913", reason: "ok" },
    summary: "done",
    taskCompleted: true,
    completionConfidence: { score: 0.9, label: "high" },
    evidence: [],
    failureCode: null,
    failureMessage: null,
    createdAt: options.completedAt,
    completedAt: options.completedAt,
  };
}

function twoApprovers() {
  const first = requestInput().approvers[0]!;
  return approvalRequest({
    approvers: [first, { ...first, id: "bob", name: "Bob", phone: BOB_PHONE }],
  });
}

test("the window is checked against the local clock and against the call itself", () => {
  const windowStart = 1_700_000_000_000;
  const deadline = windowStart + 600_000;
  const inside = new Date(windowStart + 60_000).toISOString();
  assert.equal(decidedInWindow({ completedAt: inside, windowStart, deadline, now: windowStart + 90_000 }), true);
  assert.equal(decidedInWindow({ completedAt: null, windowStart, deadline, now: windowStart + 90_000 }), true);
  assert.equal(decidedInWindow({ completedAt: inside, windowStart, deadline, now: deadline + 1 }), false);
  assert.equal(
    decidedInWindow({
      completedAt: new Date(windowStart - 3_600_000).toISOString(),
      windowStart,
      deadline,
      now: windowStart + 1_000,
    }),
    false,
  );
  assert.equal(
    decidedInWindow({ completedAt: "not a date", windowStart, deadline, now: windowStart + 1_000 }),
    true,
  );
});

test("a poll that cannot be read back leaves the state unknown and stops the ladder", async () => {
  const created: string[] = [];
  const port: CallePort = {
    async createCall(input: CreateCallInput, key: string) {
      created.push(key);
      return snapshot({ id: "call_stub1", completedAt: new Date().toISOString(), status: "queued" });
    },
    async waitForResult() {
      throw new GateApiError("service_unavailable", "poll failed", 503);
    },
    async getCall() {
      throw new GateApiError("service_unavailable", "read failed", 503);
    },
  };
  const result = await runGate({
    request: twoApprovers(),
    port,
    stateDir: null,
    pollIntervalMs: 1,
    makeSecret: () => FIXED_SECRET,
  });
  assert.equal(result.verdict, "not_approved");
  assert.equal(result.reason, "call_state_unknown");
  assert.equal(result.attempts.length, 1, "bob must not be called while alice's call may be live");
  assert.equal(result.attempts[0]!.call_id, "call_stub1", "the record keeps the id to reconcile");
  assert.equal(created.length, 1);
});

test("a decision that arrives after the window closed does not approve", async () => {
  let clock = 1_700_000_000_000;
  const request = approvalRequest();
  const port: CallePort = {
    async createCall() {
      return snapshot({ id: "call_stub2", completedAt: new Date(clock).toISOString(), status: "queued" });
    },
    async waitForResult() {
      // The person answered, but only after the window had closed.
      clock += request.policy.windowSeconds * 1000 + 1_000;
      return snapshot({ id: "call_stub2", completedAt: new Date(clock).toISOString() });
    },
    async getCall() {
      return snapshot({ id: "call_stub2", completedAt: new Date(clock).toISOString() });
    },
  };
  const result = await runGate({
    request,
    port,
    stateDir: null,
    pollIntervalMs: 1,
    now: () => clock,
    makeSecret: () => FIXED_SECRET,
  });
  assert.equal(result.verdict, "not_approved");
  assert.equal(result.reason, "window_expired");
  assert.equal(result.attempts[0]!.evidence.within_window, false);
});

test("a call that finished before this window opened does not approve", async () => {
  const request = approvalRequest();
  const old = new Date(Date.now() - 3_600_000).toISOString();
  const port: CallePort = {
    async createCall() {
      return snapshot({ id: "call_stub3", completedAt: old });
    },
    async waitForResult() {
      return snapshot({ id: "call_stub3", completedAt: old });
    },
    async getCall() {
      return snapshot({ id: "call_stub3", completedAt: old });
    },
  };
  const result = await runGate({
    request,
    port,
    stateDir: null,
    pollIntervalMs: 1,
    makeSecret: () => FIXED_SECRET,
  });
  assert.equal(result.verdict, "not_approved");
  assert.equal(result.reason, "window_expired");
});
