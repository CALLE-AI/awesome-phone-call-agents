/**
 * What a port that would ring a real phone refuses.
 *
 * The port here is a hand written stub that records the key it was asked to dial
 * and then throws. That is the whole point: the check under test has to fire
 * before the first dial, so a passing test is one where the stub was never asked.
 * No fake server, no credentials, no network.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { CalleCallError, type CallePort } from "../src/calle.js";
import { ConfigError } from "../src/config.js";
import { runCoordination } from "../src/coordinate.js";
import { resumeCoordination } from "../src/resume.js";
import { coordinationRequest } from "./fixtures.js";

function stubPort(live: boolean): { port: CallePort; dialed: string[] } {
  const dialed: string[] = [];
  const port: CallePort = {
    live,
    async createCall(_input, idempotencyKey) {
      dialed.push(idempotencyKey);
      throw new CalleCallError("stub_port", "this stub never places a call");
    },
    async waitForResult() {
      throw new CalleCallError("stub_port", "this stub never places a call");
    },
    async getCall() {
      throw new CalleCallError("stub_port", "this stub never places a call");
    },
  };
  return { port, dialed };
}

test("a live run with no ledger never reaches a dial", async () => {
  const { port, dialed } = stubPort(true);
  await assert.rejects(
    () => runCoordination({ request: coordinationRequest(), port, pollIntervalMs: 5 }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError, `expected ConfigError, got ${String(error)}`);
      assert.match(error.message, /needs a ledger/);
      assert.match(error.message, /Nothing was dialled\./);
      return true;
    },
  );
  assert.deepEqual(dialed, [], "not one call was created");
});

test("a live resume with an empty ledger path is refused the same way", async () => {
  const { port, dialed } = stubPort(true);
  await assert.rejects(
    () => resumeCoordination({ request: coordinationRequest(), port, ledgerPath: "", pollIntervalMs: 5 }),
    ConfigError,
  );
  assert.deepEqual(dialed, []);
});

test("the same run against a port that dials nothing real is allowed to proceed", async () => {
  // The in memory path is for unit tests and for the local fake server. Proving
  // it still runs is what makes the test above a check on live ports rather than
  // on a missing ledger.
  const { port, dialed } = stubPort(false);
  const result = await runCoordination({ request: coordinationRequest(), port, pollIntervalMs: 5 });
  assert.equal(result.outcome, "not_reached");
  assert.equal(dialed.length, 1, "it got as far as asking for the first call");
  assert.equal(result.ledger_path, null);
});
