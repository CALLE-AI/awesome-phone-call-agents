import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfigError } from "../src/config.js";
import { JsonDrillStore, LaunchClaimStore } from "../src/store.js";
import * as service from "../src/service.js";

test("create drill requires primary consent", () => {
  const dir = mkdtempSync(join(tmpdir(), "drill-consent-"));
  const deps = { store: new JsonDrillStore(dir), claims: new LaunchClaimStore(dir) };
  assert.throws(
    () =>
      service.createDrill(deps, {
        primaryLabel: "Primary",
        primaryPhone: "+15550100001",
        primaryConsented: false,
      }),
    (error: unknown) => error instanceof ConfigError,
  );
  rmSync(dir, { recursive: true, force: true });
});

test("launch requires explicit confirmation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drill-launch-"));
  const deps = { store: new JsonDrillStore(dir), claims: new LaunchClaimStore(dir) };
  const drill = service.createDrill(deps, {
    primaryLabel: "Primary",
    primaryPhone: "+15550100001",
    primaryConsented: true,
  });
  service.acknowledgePreview(deps, drill.id, {
    operatorConfirmedDrillPurpose: true,
    maxCallsDisclosed: true,
  });
  await assert.rejects(
    () => service.launchDrill(deps, drill.id, { launchConfirmed: false }),
    (error: unknown) => error instanceof ConfigError,
  );
  rmSync(dir, { recursive: true, force: true });
});
