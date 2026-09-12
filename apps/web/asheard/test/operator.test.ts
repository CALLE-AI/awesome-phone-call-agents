import assert from "node:assert/strict";
import test from "node:test";

import { mint, parseInbox, verify } from "../src/lib/operator.ts";

const SECRET = "s".repeat(40);

test("a dial token covers exactly one number", () => {
  const token = mint("dial", "+13035550100", SECRET);
  assert.ok(token);
  assert.equal(verify("dial", "+13035550100", token, SECRET), true);
  assert.equal(verify("dial", "+13035550101", token, SECRET), false);
});

test("a token for one purpose does not pass as another", () => {
  const post = mint("inbox-post", "a".repeat(32), SECRET);
  assert.equal(verify("inbox-read", "a".repeat(32), post, SECRET), false);
  assert.equal(verify("dial", "a".repeat(32), post, SECRET), false);
});

test("no secret, or a short one, means nothing verifies", () => {
  const token = mint("dial", "+13035550100", SECRET);
  assert.equal(mint("dial", "+13035550100", null), null);
  assert.equal(mint("dial", "+13035550100", "short"), null);
  assert.equal(verify("dial", "+13035550100", token, null), false);
  assert.equal(verify("dial", "+13035550100", token, "short"), false);
});

test("a caller-minted string is not a token", () => {
  assert.equal(verify("dial", "+13035550100", crypto.randomUUID(), SECRET), false);
  assert.equal(verify("dial", "+13035550100", "", SECRET), false);
  assert.equal(verify("dial", "+13035550100", undefined, SECRET), false);
  const otherSecret = mint("dial", "+13035550100", "t".repeat(40));
  assert.equal(verify("dial", "+13035550100", otherSecret, SECRET), false);
});

test("an inbox address is an id and its post token, nothing else", () => {
  const id = "0123456789abcdef0123456789abcdef";
  const sig = mint("inbox-post", id, SECRET)!;
  assert.deepEqual(parseInbox(`${id}.${sig}`), { id, sig });
  assert.equal(parseInbox(id), null);
  assert.equal(parseInbox(`${id}.nothex`), null);
  assert.equal(parseInbox(`../${id}.${sig}`), null);
});
