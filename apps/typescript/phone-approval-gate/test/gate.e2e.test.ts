/**
 * End to end over the real `@call-e/calle` client against a local fake CALL-E.
 * No credentials, no network beyond localhost, no phone line.
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyAudit } from "../src/audit.js";
import { createSdkPort } from "../src/calle.js";
import { runGate, type RunGateOptions } from "../src/gate.js";
import type { ApprovalRequest, GateResult } from "../src/types.js";
import { startFakeCalle, type FakeScenario } from "../fake/calle-server.js";
import { ALICE_PHONE, BOB_PHONE, FIXED_SECRET, approvalRequest, requestInput } from "./fixtures.js";

const APPROVE_LINES = ["Hello?", "Four seven two nine one three, I approve."];

function auditPath(): string {
  return join(mkdtempSync(join(tmpdir(), "pag-gate-")), "audit.jsonl");
}

function statePath(): string {
  return mkdtempSync(join(tmpdir(), "pag-state-"));
}

/** Every run reserves its secrets somewhere, so each test gets its own directory. */
function gate(options: RunGateOptions): Promise<GateResult> {
  return runGate({ stateDir: statePath(), ...options });
}

async function withFake(
  scenarios: FakeScenario[],
  body: (port: Awaited<ReturnType<typeof createSdkPort>>, fake: Awaited<ReturnType<typeof startFakeCalle>>) => Promise<void>,
): Promise<void> {
  const fake = await startFakeCalle(scenarios);
  const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
  try {
    await body(port, fake);
  } finally {
    await fake.close();
  }
}

function twoApprovers(mode: "single" | "dual"): ApprovalRequest {
  const first = requestInput().approvers[0]!;
  return approvalRequest({
    policy: { mode },
    approvers: [first, { ...first, id: "bob", name: "Bob", phone: BOB_PHONE }],
  });
}

test("a spoken approval opens the gate and lands in a verifiable record", async () => {
  await withFake(
    [
      {
        phone: ALICE_PHONE,
        userLines: APPROVE_LINES,
        structuredResult: { decision: "approve", spoken_code: "472913", reason: "Said approve." },
      },
    ],
    async (port, fake) => {
      const path = auditPath();
      const result = await gate({
        request: approvalRequest(),
        port,
        auditPath: path,
        pollIntervalMs: 5,
        makeSecret: () => FIXED_SECRET,
      });
      assert.equal(result.verdict, "approved");
      assert.deepEqual(result.approved_by, ["alice"]);
      assert.equal(result.attempts.length, 1);
      assert.equal(result.audit_record_hash !== null, true);

      const created = fake.created[0]!;
      assert.match(created.idempotencyKey ?? "", /^pag-deploy-1842-alice-1-[0-9a-f]{12}$/);
      assert.equal(created.task.includes(FIXED_SECRET.code), false);
      assert.equal(created.metadata.request_id, "deploy-1842");
      assert.equal(created.resultSchema?.additionalProperties, false);
      assert.deepEqual(created.phones, [ALICE_PHONE]);

      const audit = verifyAudit(path);
      assert.equal(audit.ok, true);
      assert.equal(audit.records, 1);
    },
  );
});

test("a spoken rejection closes the gate and stops the ladder", async () => {
  await withFake(
    [
      {
        phone: ALICE_PHONE,
        userLines: ["I reject that, we are mid incident."],
        structuredResult: { decision: "reject", spoken_code: "", reason: "Said reject." },
      },
      { phone: BOB_PHONE, userLines: APPROVE_LINES },
    ],
    async (port, fake) => {
      const result = await gate({
        request: twoApprovers("single"),
        port,
        pollIntervalMs: 5,
        makeSecret: () => FIXED_SECRET,
      });
      assert.equal(result.verdict, "rejected");
      assert.equal(fake.created.length, 1, "the second approver must not be called after a rejection");
    },
  );
});

test("no answer escalates to the next approver", async () => {
  await withFake(
    [
      { phone: ALICE_PHONE, status: "failed", failureCode: "no_answer", transcript: false },
      {
        phone: BOB_PHONE,
        userLines: APPROVE_LINES,
        structuredResult: { decision: "approve", spoken_code: "472913", reason: "ok" },
      },
    ],
    async (port, fake) => {
      const result = await gate({
        request: twoApprovers("single"),
        port,
        pollIntervalMs: 5,
        makeSecret: () => FIXED_SECRET,
      });
      assert.equal(result.verdict, "approved");
      assert.deepEqual(result.approved_by, ["bob"]);
      assert.equal(result.attempts[0]!.reason, "no_answer");
      assert.equal(fake.created.length, 2);
    },
  );
});

test("dual control needs both handsets", async () => {
  const approve = {
    userLines: APPROVE_LINES,
    structuredResult: { decision: "approve", spoken_code: "472913", reason: "ok" },
  };
  await withFake(
    [
      { phone: ALICE_PHONE, ...approve },
      { phone: BOB_PHONE, ...approve },
    ],
    async (port) => {
      const path = auditPath();
      const result = await gate({
        request: twoApprovers("dual"),
        port,
        auditPath: path,
        pollIntervalMs: 5,
        makeSecret: () => FIXED_SECRET,
      });
      assert.equal(result.verdict, "approved");
      assert.deepEqual(result.approved_by, ["alice", "bob"]);
      assert.equal(verifyAudit(path).ok, true);
    },
  );

  await withFake(
    [
      { phone: ALICE_PHONE, ...approve },
      { phone: BOB_PHONE, status: "failed", failureCode: "no_answer", transcript: false },
    ],
    async (port) => {
      const result = await gate({
        request: twoApprovers("dual"),
        port,
        pollIntervalMs: 5,
        makeSecret: () => FIXED_SECRET,
      });
      assert.equal(result.verdict, "not_approved");
      assert.equal(result.reason, "quorum_not_met");
    },
  );
});

test("a retried workflow step reuses the call instead of ringing twice", async () => {
  await withFake(
    [
      {
        phone: ALICE_PHONE,
        userLines: APPROVE_LINES,
        structuredResult: { decision: "approve", spoken_code: "472913", reason: "ok" },
      },
    ],
    async (port, fake) => {
      const request = approvalRequest();
      const stateDir = statePath();
      const first = await gate({ request, port, stateDir, pollIntervalMs: 5, makeSecret: () => FIXED_SECRET });
      const second = await gate({ request, port, stateDir, pollIntervalMs: 5, makeSecret: () => FIXED_SECRET });
      assert.equal(first.verdict, "approved");
      assert.equal(second.verdict, "approved");
      assert.equal(fake.created.length, 1, "the same idempotency key must not create a second call");
    },
  );
});

test("a second run adopts the reserved secret instead of inventing one", async () => {
  await withFake(
    [
      {
        phone: ALICE_PHONE,
        userLines: APPROVE_LINES,
        structuredResult: { decision: "approve", spoken_code: "472913", reason: "ok" },
      },
    ],
    async (port, fake) => {
      const request = approvalRequest();
      const stateDir = statePath();
      const first = await gate({ request, port, stateDir, pollIntervalMs: 5, makeSecret: () => FIXED_SECRET });
      // The second run generates its own code. Without the reservation it would
      // read the call back against a code the approver was never shown.
      const second = await gate({
        request,
        port,
        stateDir,
        pollIntervalMs: 5,
        makeSecret: () => ({ code: "111111", phrase: ["apple", "bronze", "cedar"] }),
      });
      assert.equal(second.verdict, "approved");
      assert.equal(second.attempts[0]!.secret_digest, first.attempts[0]!.secret_digest);
      assert.equal(fake.created.length, 1);
    },
  );
});

test("a call that never finishes stays unresolved and holds the ladder", async () => {
  await withFake(
    [
      { phone: ALICE_PHONE, stall: true, userLines: APPROVE_LINES },
      { phone: BOB_PHONE, userLines: APPROVE_LINES },
    ],
    async (port, fake) => {
      const base = twoApprovers("single");
      const request: ApprovalRequest = {
        ...base,
        policy: { ...base.policy, perCallTimeoutSeconds: 1, windowSeconds: 60 },
      };
      const result = await gate({ request, port, pollIntervalMs: 5, makeSecret: () => FIXED_SECRET });
      assert.equal(result.verdict, "not_approved");
      // The wait timed out and the read-back came back in_progress. Alice's call
      // is still live, so Bob's handset must stay quiet.
      assert.equal(result.reason, "call_state_unknown");
      assert.equal(result.attempts.length, 1);
      assert.equal(result.attempts[0]!.call_id, fake.created[0]!.id);
      assert.equal(fake.created.length, 1, "bob must not be called over a live call");
    },
  );
});

test("two runners with their own state directory derive the same code", async () => {
  await withFake([{ phone: ALICE_PHONE, userLines: ["Hello? Who is this?"] }], async (port, fake) => {
    const request = approvalRequest();
    const codeKey = Buffer.from("shared operator key material for two runners", "utf8");
    // Separate state directories, so neither reservation can see the other. The
    // key is the only thing the two runs share and it is enough.
    const first = await runGate({ request, port, stateDir: statePath(), pollIntervalMs: 5, codeKey });
    const second = await runGate({ request, port, stateDir: statePath(), pollIntervalMs: 5, codeKey });
    assert.equal(second.attempts[0]!.secret_digest, first.attempts[0]!.secret_digest);
    assert.equal(fake.created.length, 1, "one derived code means one provider key and one call");
    assert.equal(first.attempts[0]!.reason, "secret_not_returned");
    assert.equal(second.attempts[0]!.reason, "secret_not_returned");
  });
});

test("an approval code is derived per approver and per attempt", async () => {
  await withFake(
    [
      { phone: ALICE_PHONE, userLines: ["Hello?"] },
      { phone: BOB_PHONE, userLines: ["Hello?"] },
    ],
    async (port) => {
      const codeKey = Buffer.from("shared operator key material for two runners", "utf8");
      const delivered: string[] = [];
      const result = await gate({
        request: twoApprovers("single"),
        port,
        pollIntervalMs: 5,
        codeKey,
        onSecret: (approver, display) => delivered.push(`${approver.id}:${display}`),
      });
      assert.equal(result.attempts.length, 2);
      assert.notEqual(result.attempts[0]!.secret_digest, result.attempts[1]!.secret_digest);
      assert.equal(delivered.length, 2);
      assert.notEqual(delivered[0], delivered[1]);
      for (const line of delivered) {
        assert.match(line, /^(alice|bob):(\d ){5}\d$/);
      }
    },
  );
});

test("an API error is recorded with its CALL-E code", async () => {
  await withFake(
    [{ phone: ALICE_PHONE, apiError: { status: 402, code: "insufficient_balance" } }],
    async (port) => {
      const result = await gate({
        request: approvalRequest(),
        port,
        pollIntervalMs: 5,
        makeSecret: () => FIXED_SECRET,
      });
      assert.equal(result.verdict, "not_approved");
      assert.equal(result.reason, "api_error");
      assert.equal(result.attempts[0]!.evidence.failure_code, "insufficient_balance");
    },
  );
});

test("a refused call is not ambiguous, so the ladder moves to the next approver", async () => {
  await withFake(
    [
      { phone: ALICE_PHONE, apiError: { status: 402, code: "insufficient_balance" } },
      {
        phone: BOB_PHONE,
        userLines: APPROVE_LINES,
        structuredResult: { decision: "approve", spoken_code: "472913", reason: "ok" },
      },
    ],
    async (port, fake) => {
      const result = await gate({
        request: twoApprovers("single"),
        port,
        pollIntervalMs: 5,
        makeSecret: () => FIXED_SECRET,
      });
      assert.equal(result.verdict, "approved");
      assert.deepEqual(result.approved_by, ["bob"]);
      assert.equal(result.attempts[0]!.reason, "api_error");
      assert.equal(fake.created.length, 1, "the refused create places nothing");
    },
  );
});

test("a create whose reply was lost is reconciled under the same key", async () => {
  await withFake(
    [
      {
        phone: ALICE_PHONE,
        apiError: { status: 503, code: "service_unavailable", times: 1, afterCreate: true },
        userLines: APPROVE_LINES,
        structuredResult: { decision: "approve", spoken_code: "472913", reason: "ok" },
      },
      { phone: BOB_PHONE, userLines: APPROVE_LINES },
    ],
    async (port, fake) => {
      const path = auditPath();
      const result = await gate({
        request: twoApprovers("single"),
        port,
        auditPath: path,
        pollIntervalMs: 5,
        makeSecret: () => FIXED_SECRET,
      });
      assert.equal(result.verdict, "approved");
      assert.deepEqual(result.approved_by, ["alice"]);
      assert.equal(fake.created.length, 1, "the replayed key must not create a second call");
      assert.equal(verifyAudit(path).ok, true);
    },
  );
});

test("a call state that cannot be settled stops the ladder and says so", async () => {
  await withFake(
    [
      {
        phone: ALICE_PHONE,
        // 503 twice: the request may have been accepted and the replay under the
        // same key could not settle it either.
        apiError: { status: 503, code: "service_unavailable" },
        userLines: APPROVE_LINES,
      },
      { phone: BOB_PHONE, userLines: APPROVE_LINES },
    ],
    async (port, fake) => {
      const path = auditPath();
      const result = await gate({
        request: twoApprovers("single"),
        port,
        auditPath: path,
        pollIntervalMs: 5,
        makeSecret: () => FIXED_SECRET,
      });
      assert.equal(result.verdict, "not_approved");
      assert.equal(result.reason, "call_state_unknown");
      assert.equal(result.attempts.length, 1, "the second approver must not be called");
      assert.equal(result.attempts[0]!.evidence.call_status, "state_unknown");
      assert.equal(fake.created.length, 0);
      const audit = verifyAudit(path);
      assert.equal(audit.ok, true);
      assert.equal(audit.records, 1);
    },
  );
});

test("the window closes the gate before it calls the next approver", async () => {
  await withFake(
    [
      { phone: ALICE_PHONE, status: "failed", failureCode: "no_answer", transcript: false },
      { phone: BOB_PHONE, userLines: APPROVE_LINES },
    ],
    async (port, fake) => {
      let clock = 1_700_000_000_000;
      const base = twoApprovers("single");
      const request: ApprovalRequest = {
        ...base,
        policy: { ...base.policy, windowSeconds: 60, perCallTimeoutSeconds: 60 },
      };
      const result = await gate({
        request,
        port,
        pollIntervalMs: 5,
        makeSecret: () => FIXED_SECRET,
        now: () => clock,
        onProgress: (line) => {
          if (line.startsWith("Attempt for alice")) {
            clock += 61_000;
          }
        },
      });
      assert.equal(result.verdict, "not_approved");
      assert.equal(result.reason, "window_expired");
      assert.equal(fake.created.length, 1);
    },
  );
});

test("the code is delivered on the request channel, once, before the call", async () => {
  await withFake(
    [
      {
        phone: ALICE_PHONE,
        userLines: APPROVE_LINES,
        structuredResult: { decision: "approve", spoken_code: "472913", reason: "ok" },
      },
    ],
    async (port) => {
      const delivered: string[] = [];
      await gate({
        request: approvalRequest(),
        port,
        pollIntervalMs: 5,
        makeSecret: () => FIXED_SECRET,
        onSecret: (approver, display) => delivered.push(`${approver.id}:${display}`),
      });
      assert.deepEqual(delivered, ["alice:4 7 2 9 1 3"]);
    },
  );
});

test("liveness phrase mode approves on a repeated phrase and never on a machine", async () => {
  const base = approvalRequest({ policy: { binding: "liveness_phrase" } });
  await withFake(
    [
      {
        phone: ALICE_PHONE,
        botLines: ["Repeat these words: anchor, cobalt, meadow."],
        userLines: ["anchor cobalt meadow, approved"],
        structuredResult: { decision: "approve", spoken_code: "", reason: "Repeated the words." },
      },
    ],
    async (port) => {
      const result = await gate({ request: base, port, pollIntervalMs: 5, makeSecret: () => FIXED_SECRET });
      assert.equal(result.verdict, "approved");
    },
  );

  await withFake(
    [
      {
        phone: ALICE_PHONE,
        botLines: ["Repeat these words: anchor, cobalt, meadow."],
        userLines: ["You have reached Alice. Please leave a message after the tone."],
      },
    ],
    async (port) => {
      const result = await gate({ request: base, port, pollIntervalMs: 5, makeSecret: () => FIXED_SECRET });
      assert.equal(result.verdict, "not_approved");
      assert.equal(result.reason, "voicemail");
    },
  );
});
