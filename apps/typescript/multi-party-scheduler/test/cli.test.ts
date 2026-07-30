/**
 * What the CLI refuses before a live run starts.
 *
 * These run the CLI itself, because the preconditions for `--live` are the
 * point: each one has to fire before the key is read and before a client that
 * could dial anybody exists. No credentials, no fake server, no network.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(appRoot, "src", "cli.ts");
const requestFile = join(appRoot, "examples", "request.example.json");

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], env: Record<string, string> = {}): CliResult {
  const result = spawnSync(process.execPath, ["--import", "tsx", cli, ...args], {
    cwd: appRoot,
    encoding: "utf8",
    // An empty key by default, so a test that expects an earlier refusal cannot
    // pass because the machine happens to have one exported.
    env: { ...process.env, CALLE_API_KEY: "", CALLE_ALLOWED_HOSTS: "", ...env },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function tempLedger(): string {
  return join(mkdtempSync(join(tmpdir(), "mps-cli-")), "ledger.jsonl");
}

test("a live run without --ledger is refused before anything is dialled", () => {
  const result = runCli(["run", "--request", requestFile, "--live"]);
  assert.equal(result.status, 30);
  assert.match(result.stderr, /--ledger/);
  assert.match(result.stderr, /resume/);
  assert.equal(result.stdout, "", "nothing ran");
});

test("a live run with --ledger passes that check and stops on the missing key", () => {
  const result = runCli(["run", "--request", requestFile, "--live", "--ledger", tempLedger()]);
  assert.equal(result.status, 30);
  assert.match(result.stderr, /CALLE_API_KEY/);
  assert.equal(/--ledger/.test(result.stderr), false, "the durable state check passed");
});

test("plan needs no ledger, because it places no call", () => {
  const result = runCli(["plan", "--request", requestFile]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /option 1/);
});

test("the help text says --ledger is required for a live run", () => {
  const result = runCli(["help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /run --request <file> --live --ledger <file>/);
});
