/**
 * The command line, run as a command line. These spawn the CLI so the consent gate
 * is tested where it has to hold. None of them can place a call: no API key, no
 * trusted base URL, no receipt.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadRequest } from "../src/config.js";
import { previewReceipt } from "../src/script.js";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const errandFile = join(appRoot, "examples", "errand.example.json");
const receipt = previewReceipt(loadRequest(errandFile));

function cli(args: string[], env: Record<string, string> = {}): { code: number; out: string; err: string } {
  const result = spawnSync(process.execPath, ["--import", "tsx", join(appRoot, "src", "cli.ts"), ...args], {
    cwd: appRoot,
    encoding: "utf8",
    env: { ...process.env, CALLE_API_KEY: "", CALLE_BASE_URL: "", ...env },
  });
  return { code: result.status ?? -1, out: result.stdout, err: result.stderr };
}

test("preview prints the receipt for the errand file it read", () => {
  const result = cli(["preview", "--errand", errandFile]);
  assert.equal(result.code, 0);
  assert.match(result.out, new RegExp(`--live --receipt ${receipt}`));
  assert.match(result.out, /Preview only\. No call is placed/);
});

test("a live call without a receipt is a usage error, not a call", () => {
  const result = cli(["call", "--errand", errandFile, "--live"]);
  assert.equal(result.code, 30);
  assert.match(result.err, /needs --receipt <hash>/);
  assert.match(result.err, /Run preview/);
});

test("a receipt from another preview does not place the call", () => {
  const result = cli(["call", "--errand", errandFile, "--live", "--receipt", "0123456789abcdef"]);
  assert.equal(result.code, 30);
  assert.match(result.err, /is not the receipt for this errand file, so no call was placed/);
});

test("the right receipt gets past consent and stops at the missing credential", () => {
  const result = cli(["call", "--errand", errandFile, "--live", "--receipt", receipt]);
  assert.equal(result.code, 30);
  assert.match(result.err, /CALLE_API_KEY is not set/);
});

test("an untrusted base URL never receives the key", () => {
  const result = cli(
    ["call", "--errand", errandFile, "--live", "--receipt", receipt, "--base-url", "http://api.example.com"],
    { CALLE_API_KEY: "calle_test_key" },
  );
  assert.equal(result.code, 30);
  assert.match(result.err, /is not trusted, so the API key was not sent/);
});

test("call without --live still refuses and points at the preview", () => {
  const result = cli(["call", "--errand", errandFile]);
  assert.equal(result.code, 30);
  assert.match(result.err, /Read the preview first/);
});
