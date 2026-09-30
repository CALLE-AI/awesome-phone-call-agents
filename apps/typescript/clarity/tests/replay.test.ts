import { after, test } from "node:test";
import assert from "node:assert/strict";
import { isReplayMode } from "../lib/replay";

const originalMode = process.env.DEMO_MODE;
after(() => {
  if (originalMode === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = originalMode;
});

test("provider access requires an explicit live mode", () => {
  delete process.env.DEMO_MODE;
  assert.equal(isReplayMode(), true);
  for (const value of ["", "replay", "preview", "lve"]) {
    process.env.DEMO_MODE = value;
    assert.equal(isReplayMode(), true, value);
  }
  for (const value of ["live", "LIVE", " live "]) {
    process.env.DEMO_MODE = value;
    assert.equal(isReplayMode(), false, value);
  }
});
