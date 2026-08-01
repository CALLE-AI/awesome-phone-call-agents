import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(root, "public/app.js"), "utf8");
const indexHtml = readFileSync(join(root, "public/index.html"), "utf8");

test("client loads auth visibility from /api/health", () => {
  assert.match(appJs, /fetch\("\/api\/health"\)/);
  assert.match(appJs, /renderOperatorAuthUI/);
  assert.match(appJs, /authHealthKnown/);
});

test("client hides live side-effect acknowledgment unless drill mode is live", () => {
  assert.match(appJs, /function syncLiveAckUI\(mode\)/);
  assert.match(appJs, /mode === "live"/);
  assert.match(appJs, /if \(state\.drill\?\.mode === "live"\)/);
  assert.match(indexHtml, /id="live-ack-wrap" hidden/);
});

test("client preview payload omits live acknowledgment outside live mode", () => {
  const previewHandler = appJs.slice(appJs.indexOf('getElementById("preview-form")'));
  const liveAckBlock = previewHandler.match(
    /if \(state\.drill\?\.mode === "live"\) \{[\s\S]*?payload\.liveSideEffectAcknowledged[\s\S]*?\}/,
  );
  assert.ok(liveAckBlock, "live acknowledgment is only sent inside live-mode guard");
});
