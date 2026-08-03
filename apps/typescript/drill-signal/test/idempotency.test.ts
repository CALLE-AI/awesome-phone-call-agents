import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileLaunchClaimStore } from "../src/store.js";

test("launch claim prevents duplicate launches with different keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "drill-claim-"));
  const store = new FileLaunchClaimStore(dir);
  assert.equal(store.tryClaim("drill-1", "key-a"), "new");
  assert.equal(store.tryClaim("drill-1", "key-a"), "replay");
  assert.equal(store.tryClaim("drill-1", "key-b"), "conflict");
  rmSync(dir, { recursive: true, force: true });
});
