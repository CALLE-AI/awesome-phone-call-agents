/**
 * The three places a call could be reported as a call that never happened.
 *
 * A create whose reply was lost, a reconciliation of that create that fails, then a
 * call CALL-E has not finished with. None of the three can be produced reliably
 * against the fake server, because the fake answers a replayed idempotency key with
 * the call it already holds, so each one gets a port that does exactly it and nothing
 * else. A port asked for something its case does not script throws, which is how each
 * test proves the path it cares about is the path that ran.
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CalleApiError, CalleWaitTimeout, type CallePort } from "../src/calle.js";
import { runCheck } from "../src/check.js";
import { verifyRecord } from "../src/record.js";
import { idempotencyKey } from "../src/script.js";
import type { CallSnapshot } from "../src/types.js";
import { answered, claim, snapshot } from "./fixtures.js";

const CLAIM = claim();
const CONFIDENT = { contact_confirmed: "yes", callee_quote: "That was us.", notes: "" };

interface Stub {
  port: CallePort;
  /** Every idempotency key a create was made with, in order. */
  keys: string[];
}

/** Each entry is thrown when it is an error and returned when it is a snapshot. */
function stubPort(script: { creates: unknown[]; wait?: unknown; get?: unknown }): Stub {
  const keys: string[] = [];
  const answer = (value: unknown, what: string): CallSnapshot => {
    if (value === undefined) {
      throw new Error(`the stub was asked to ${what} and this case does not script it`);
    }
    if (value instanceof Error) {
      throw value;
    }
    return value as CallSnapshot;
  };
  return {
    keys,
    port: {
      async createCall(_input, idempotencyKeyUsed) {
        keys.push(idempotencyKeyUsed);
        return answer(script.creates[keys.length - 1], `create call ${keys.length}`);
      },
      async waitForResult() {
        return answer(script.wait, "wait for a result");
      },
      async getCall() {
        return answer(script.get, "read the call back");
      },
    },
  };
}

function recordPath(): string {
  return join(mkdtempSync(join(tmpdir(), "vcc-unresolved-")), "record.jsonl");
}

test("an ambiguous create followed by a definite refusal resolves nothing", async () => {
  // Reading the call back is the only thing that can settle an ambiguous create. The
  // class of the second answer says nothing about the first request: that one may
  // already have been accepted. A 401 or a 403 here can be decided before the
  // idempotency key is ever looked up. So a definite second failure must not be read
  // as proof that no call exists.
  for (const [status, code] of [
    [400, "invalid_request"],
    [401, "unauthorized"],
    [402, "insufficient_balance"],
    [403, "forbidden"],
  ] as const) {
    const path = recordPath();
    const stub = stubPort({
      creates: [
        new CalleApiError("service_unavailable", "no reply came back", 503),
        new CalleApiError(code, "refused", status),
      ],
    });
    const result = await runCheck({ claim: CLAIM, port: stub.port, recordPath: path });
    assert.equal(result.outcome, "outcome_unknown", String(status));
    assert.equal(result.reason, "call_state_unknown", String(status));
    assert.equal(result.evidence.call_status, "state_unknown", String(status));
    // Both failures, in order, because the record is where somebody reconciles from.
    assert.equal(result.evidence.failure_code, `service_unavailable, then ${code}`);
    assert.equal(result.callee_quote, "");
    assert.equal(stub.keys.length, 2, "the reconciliation is the second create and there is no third");
    assert.equal(stub.keys[0], stub.keys[1], "the reconciliation has to reuse the key, not mint a new one");
    assert.equal(stub.keys[0], idempotencyKey(CLAIM));
    assert.equal(verifyRecord(path).ok, true, "the record of a run that settled nothing still has to verify");
  }
});

test("a definite refusal on the first create is no call at all", async () => {
  // The control. A status the server chose to send about the request means nothing
  // was placed, so this one is a refusal rather than an unknown state and it is not
  // reconciled.
  const stub = stubPort({ creates: [new CalleApiError("insufficient_balance", "no funds", 402)] });
  const result = await runCheck({ claim: CLAIM, port: stub.port });
  assert.equal(result.outcome, "outcome_unknown");
  assert.equal(result.reason, "api_error");
  assert.equal(result.evidence.call_status, "api_error");
  assert.equal(result.evidence.failure_code, "insufficient_balance");
  assert.equal(result.call_id, null);
  assert.equal(stub.keys.length, 1, "nothing was placed, so there is nothing to reconcile");
});

test("a call CALL-E has not finished with is never read as a result", async () => {
  // The read back carries a full transcript and a confident extraction. The status
  // says the line may still be open, so none of that is an answer.
  for (const status of ["queued", "in_progress", "dialing", ""]) {
    const stub = stubPort({
      creates: [snapshot({ status: "queued" })],
      wait: new CalleWaitTimeout("gave up waiting"),
      get: snapshot({ status, turns: answered("Yes, that was us."), structured: CONFIDENT }),
    });
    const result = await runCheck({ claim: CLAIM, port: stub.port });
    assert.equal(result.outcome, "outcome_unknown", status);
    assert.equal(result.reason, "call_state_unknown", status);
    assert.equal(result.evidence.failure_code, `wait_timeout, then call_${status}`, status);
    assert.equal(result.callee_quote, "", status);
    // The id is kept, because somebody has to be able to go and settle that call.
    assert.equal(result.call_id, "call_test1", status);
    assert.equal(stub.keys.length, 1, status);
  }
});

test("a wait that timed out and a read that failed keeps the call id and names both", async () => {
  const stub = stubPort({
    creates: [snapshot({ status: "queued" })],
    wait: new CalleWaitTimeout("gave up waiting"),
    get: new CalleApiError("service_unavailable", "cannot read it", 503),
  });
  const result = await runCheck({ claim: CLAIM, port: stub.port });
  assert.equal(result.outcome, "outcome_unknown");
  assert.equal(result.reason, "call_state_unknown");
  assert.equal(result.evidence.failure_code, "wait_timeout, then service_unavailable");
  assert.equal(result.call_id, "call_test1");
});
