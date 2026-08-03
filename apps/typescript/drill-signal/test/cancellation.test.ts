import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cancelBoundaryMessage } from "../src/state-machine.js";
import { JsonDrillStore, LaunchClaimStore } from "../src/store.js";
import * as service from "../src/service.js";

test("cancel boundary explains provider limits after call starts", () => {
  const msg = cancelBoundaryMessage(1, "call_123");
  assert.match(msg, /cannot be guaranteed stopped/i);
});

test("cancel before launch completes immediately", () => {
  const dir = mkdtempSync(join(tmpdir(), "drill-cancel-"));
  const deps = { store: new JsonDrillStore(dir), claims: new LaunchClaimStore(dir) };
  const drill = service.createDrill(deps, {
    primaryLabel: "Primary",
    primaryPhone: "+15550100001",
    primaryConsented: true,
  });
  const cancelled = service.cancelDrill(deps, drill.id);
  assert.equal(cancelled.status, "cancelled");
  rmSync(dir, { recursive: true, force: true });
});
