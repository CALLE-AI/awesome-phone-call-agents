import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FileCallCheckpointStore } from "../src/checkpoints.js";

test("file checkpoint atomically claims once and preserves completed state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recallready-checkpoint-contract-"));
  const path = join(directory, "calls.json");
  const key = "0123456789abcdef";
  try {
    const store = new FileCallCheckpointStore(path);
    const claims = await Promise.all([store.claim(key), store.claim(key)]);
    assert.deepEqual(claims.sort(), [false, true]);
    await store.complete(key, "call_synthetic_1");
    const reopened = new FileCallCheckpointStore(path);
    assert.equal(await reopened.claim(key), false);
    const persisted = JSON.parse(await readFile(path, "utf8"));
    assert.equal(persisted[key].state, "completed");
    assert.equal(persisted[key].callId, "call_synthetic_1");
    assert.equal(JSON.stringify(persisted).includes("+1"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("file checkpoint refuses completion without a prior claim", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recallready-checkpoint-corrupt-"));
  const path = join(directory, "calls.json");
  try {
    const store = new FileCallCheckpointStore(path);
    await store.claim("0123456789abcdef");
    await assert.rejects(() => store.complete("fedcba9876543210", "call_missing"), /not claimed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("file checkpoint fails closed on malformed persisted records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recallready-checkpoint-malformed-"));
  const path = join(directory, "calls.json");
  try {
    await writeFile(path, JSON.stringify({ "0123456789abcdef": { state: "completed" } }));
    const store = new FileCallCheckpointStore(path);
    await assert.rejects(() => store.claim("fedcba9876543210"), /invalid record/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
