/**
 * Attempt reservations. The point of the file is that two runs of one request
 * cannot end up holding two different secrets for one provider key.
 */

import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defaultStateDir, reserveSecret, STATE_DIR_NAME } from "../src/reserve.js";

const FIRST = { code: "472913", phrase: ["anchor", "cobalt", "meadow"] };
const SECOND = { code: "111111", phrase: ["apple", "bronze", "cedar"] };

function stateDir(): string {
  return mkdtempSync(join(tmpdir(), "pag-reserve-"));
}

function reserve(dir: string | null, secret: { code: string; phrase: string[] }, content: unknown) {
  return reserveSecret({
    dir,
    requestId: "deploy-1842",
    approverId: "alice",
    attempt: 1,
    content,
    secret,
    reservedAt: "2026-07-30T10:00:00.000Z",
  });
}

test("the first run owns the reservation and later runs adopt its secret", () => {
  const dir = stateDir();
  const content = { change: "deploy 1.14.2" };
  const first = reserve(dir, FIRST, content);
  assert.equal(first.owned, true);
  assert.equal(first.secret.code, FIRST.code);

  const second = reserve(dir, SECOND, content);
  assert.equal(second.owned, false);
  assert.equal(second.secret.code, FIRST.code);
  assert.deepEqual(second.secret.phrase, FIRST.phrase);
  assert.equal(second.reservedAt, "2026-07-30T10:00:00.000Z");
  assert.equal(second.path, first.path);
});

test("a different request content reserves afresh instead of adopting", () => {
  const dir = stateDir();
  const first = reserve(dir, FIRST, { change: "deploy 1.14.2" });
  const other = reserve(dir, SECOND, { change: "deploy 1.14.3" });
  assert.equal(other.owned, true);
  assert.equal(other.secret.code, SECOND.code);
  assert.notEqual(other.path, first.path);
  assert.equal(readdirSync(join(dir, "deploy-1842")).length, 2);
});

test("the reservation is readable by its owner only", () => {
  const dir = stateDir();
  const reserved = reserve(dir, FIRST, { change: "deploy 1.14.2" });
  assert.equal(statSync(reserved.path!).mode & 0o777, 0o600);
});

test("a null directory turns reservations off and writes nothing", () => {
  const dir = stateDir();
  const reserved = reserve(null, FIRST, { change: "deploy 1.14.2" });
  assert.equal(reserved.owned, true);
  assert.equal(reserved.path, null);
  assert.deepEqual(readdirSync(dir), []);
});

test("a reservation with no secret in it fails closed", () => {
  const dir = stateDir();
  const reserved = reserve(dir, FIRST, { change: "deploy 1.14.2" });
  writeFileSync(reserved.path!, JSON.stringify({ request_id: "deploy-1842" }), "utf8");
  assert.throws(
    () => reserve(dir, SECOND, { change: "deploy 1.14.2" }),
    /does not hold a secret/,
  );
});

test("a reservation other accounts can read is refused, not adopted", () => {
  const dir = stateDir();
  const reserved = reserve(dir, FIRST, { change: "deploy 1.14.2" });
  // Nothing this app writes is ever wider than 0600, so a wider file is somebody
  // else's. It holds a live code in clear, so the run stops instead of trusting it.
  chmodSync(reserved.path!, 0o644);
  assert.throws(
    () => reserve(dir, SECOND, { change: "deploy 1.14.2" }),
    /mode 0644, which other accounts can read/,
  );
});

test("the default directory sits beside the record file", () => {
  assert.equal(defaultStateDir("/srv/runs/approvals.jsonl"), join("/srv/runs", STATE_DIR_NAME));
  assert.equal(defaultStateDir(null), join(tmpdir(), "phone-approval-gate"));
});
