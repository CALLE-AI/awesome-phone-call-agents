// Offline CLI regression: fixture text stays private and helpers remain read-only.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const skill = resolve(here, "..");
const fixture = join(mkdtempSync(join(tmpdir(), "cleared-to-call-test-")), "transcript.json");
const text = JSON.stringify([
  { speaker: "agent", text: "Say stop calling me to opt out." },
  { speaker: "recipient", text: "Stop calling me at +12025550123. Private fixture detail." },
]);
writeFileSync(fixture, text);
const env = { PATH: process.env.PATH || "/usr/bin:/bin" };
const result = spawnSync(process.execPath, [join(here, "check-revocation.mjs"), "--transcript", fixture], { env, encoding: "utf8" });
assert.equal(result.status, 3);
const shown = JSON.parse(result.stdout);
assert.equal(shown.turn_index, 1);
assert.equal(shown.revoked, true);
assert.equal(shown.text_omitted, true);
assert.equal(shown.action, "end_call_and_suppress");
assert(!result.stdout.includes("+12025550123"));
assert(!result.stdout.includes("Private fixture detail"));
assert.equal(readFileSync(fixture, "utf8"), text);
const suppression = join(skill, "assets/example-suppression.jsonl");
const before = readFileSync(suppression, "utf8");
for (const [id, status] of [["A-1001", 0], ["A-1002", 2], ["A-1003", 2], ["A-1004", 2]]) {
  const checked = spawnSync(process.execPath, [join(here, "evaluate-account.mjs"), "--file", join(skill, "assets/example-accounts.json"), "--account-id", id, "--suppression", suppression, "--now", "2026-08-28T13:30:00Z"], { env, encoding: "utf8" });
  assert.equal(checked.status, status);
}
assert.equal(readFileSync(suppression, "utf8"), before);
console.log("13 offline assertions passed; no credentials, provider calls, or suppression writes.");
