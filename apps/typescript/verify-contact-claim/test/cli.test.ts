/**
 * The command line, run as a command line.
 *
 * These spawn the CLI so the consent gate is tested where it has to hold. None of
 * them can place a call: no API key, no trusted base URL, no matching receipt.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateCall } from "../src/decide.js";
import { loadClaim } from "../src/config.js";
import { buildRecord, GENESIS_HASH, hashRecord } from "../src/record.js";
import { previewReceipt, questionText } from "../src/script.js";
import type { ClaimRecord } from "../src/types.js";
import { answered, claim, claimInput, snapshot, withContact } from "./fixtures.js";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const claimFile = join(appRoot, "examples", "claim.example.json");
const CLAIM = claim();
// The receipt for the file the command line will read, not for the fixture.
const receipt = previewReceipt(loadClaim(claimFile));

function cli(args: string[], env: Record<string, string> = {}): { code: number; out: string; err: string } {
  const result = spawnSync(process.execPath, ["--import", "tsx", join(appRoot, "src", "cli.ts"), ...args], {
    cwd: appRoot,
    encoding: "utf8",
    env: { ...process.env, CALLE_API_KEY: "", CALLE_BASE_URL: "", CALLE_ALLOWED_HOSTS: "", ...env },
  });
  return { code: result.status ?? -1, out: result.stdout, err: result.stderr };
}

function writeClaim(input: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "vcc-cli-")), "claim.json");
  writeFileSync(path, JSON.stringify(input), "utf8");
  return path;
}

function writeRecord(changes: Partial<ClaimRecord> = {}): string {
  const line = "No, there is nothing from us on her file.";
  const evaluation = evaluateCall({
    claim: CLAIM,
    question: questionText(CLAIM),
    call: snapshot({ turns: answered(line), structured: { contact_confirmed: "no", callee_quote: line, notes: "" } }),
  });
  const record = buildRecord({
    claim: CLAIM,
    question: questionText(CLAIM),
    dialled: CLAIM.trustedNumber.phone,
    evaluation,
    previousHash: GENESIS_HASH,
    sequence: 1,
    recordedAt: "2026-07-31T16:20:00.000Z",
  });
  const { hash: _replaced, ...unhashed } = { ...record, ...changes };
  const written: ClaimRecord = { ...unhashed, hash: hashRecord(unhashed) };
  const path = join(mkdtempSync(join(tmpdir(), "vcc-cli-")), "record.jsonl");
  writeFileSync(path, `${JSON.stringify(written)}\n`, { encoding: "utf8", mode: 0o600 });
  return path;
}

test("preview runs from a clean clone with no credentials and prints the receipt", () => {
  const result = cli(["preview", "--claim", claimFile]);
  assert.equal(result.code, 0);
  assert.match(result.out, /Preview only\. No call is placed/);
  assert.match(result.out, new RegExp(`--live --receipt ${receipt}`));
});

test("check without --live refuses and points at the preview", () => {
  const result = cli(["check", "--claim", claimFile]);
  assert.equal(result.code, 50);
  assert.match(result.err, /Read the preview first/);
});

test("check --live with no receipt refuses without printing the right one", () => {
  const result = cli(["check", "--claim", claimFile, "--live"]);
  assert.equal(result.code, 50);
  assert.match(result.err, /needs --receipt/);
  // Printing it here would turn the consent step into a formality.
  assert.equal(result.err.includes(receipt), false);
});

test("a receipt from another preview does not place the call", () => {
  const result = cli(["check", "--claim", claimFile, "--live", "--receipt", "0123456789abcdef"]);
  assert.equal(result.code, 50);
  assert.match(result.err, /is not the receipt for this claim file, so no call was placed/);
  assert.equal(result.err.includes(receipt), false);
});

test("a live run without a record file refuses, because a run with no record is not evidence", () => {
  const result = cli(["check", "--claim", claimFile, "--live", "--receipt", receipt]);
  assert.equal(result.code, 50);
  assert.match(result.err, /--record is required/);
});

test("the host is checked before the API key is even read", () => {
  // No key in the environment at all. If the order were the other way round this
  // would complain about the key instead of the host.
  const result = cli([
    "check", "--claim", claimFile, "--live", "--receipt", receipt,
    "--record", "/tmp/vcc-never-written.jsonl", "--base-url", "https://api.example.com",
  ]);
  assert.equal(result.code, 50);
  assert.match(result.err, /is not a trusted CALL-E host/);
  assert.match(result.err, /CALLE_API_KEY was not sent/);
  assert.equal(result.err.includes("CALLE_API_KEY is not set"), false);
});

test("with a trusted host and no key it stops at the missing credential", () => {
  const result = cli([
    "check", "--claim", claimFile, "--live", "--receipt", receipt,
    "--record", "/tmp/vcc-never-written.jsonl",
  ]);
  assert.equal(result.code, 50);
  assert.match(result.err, /CALLE_API_KEY is not set/);
  assert.match(result.err, /never reads a key from the claim file/);
});

test("--allow-host is repeatable and does not swallow the option after it", () => {
  const result = cli([
    "check", "--claim", claimFile, "--live",
    "--allow-host", "a.example", "--allow-host", "b.example",
    "--receipt", "0123456789abcdef",
  ]);
  assert.equal(result.code, 50);
  assert.match(result.err, /is not the receipt for this claim file/);
});

test("a claim file carrying a card number refuses at the command line too", () => {
  const path = writeClaim(withContact({ asked_for: "read back 4111 1111 1111 1111 to unblock it" }));
  const result = cli(["preview", "--claim", path]);
  assert.equal(result.code, 50);
  assert.match(result.err, /contact\.asked_for/);
  assert.match(result.err, /card number/);
  assert.equal(result.err.includes("4111"), false);
});

test("a claim file that asks the caller to be the customer refuses at the command line too", () => {
  const path = writeClaim({ ...claimInput(), persona: "Dana Whitfield" });
  const result = cli(["preview", "--claim", path]);
  assert.equal(result.code, 50);
  assert.match(result.err, /never claims to be the customer/);
});

test("verify replays a good record and says the chain holds", () => {
  const result = cli(["verify", "--record", writeRecord()]);
  assert.equal(result.code, 0);
  assert.match(result.out, /1 record\(s\) verified/);
  assert.match(result.out, /Chain, words and outcomes hold/);
});

test("verify fails a record whose outcome was rewritten", () => {
  const result = cli(["verify", "--record", writeRecord({ outcome: "confirmed_genuine" })]);
  assert.equal(result.code, 60);
  assert.match(result.out, /does not follow from the recorded evidence/);
});

test("verify reports a record that shows the wrong number was dialled", () => {
  const path = writeRecord({ dialled_digest: "sha256:not-the-trusted-number" });
  const result = cli(["verify", "--record", path]);
  assert.equal(result.code, 60);
  assert.match(result.out, /was not the trusted number/);
});

test("verify prints JSON when it is asked to", () => {
  const result = cli(["verify", "--record", writeRecord(), "--json"]);
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.out) as { ok: boolean; records: number };
  assert.equal(parsed.ok, true);
  assert.equal(parsed.records, 1);
});

test("help lists the three commands and the exit codes", () => {
  const result = cli(["help"]);
  assert.equal(result.code, 0);
  assert.match(result.out, /preview --claim/);
  assert.match(result.out, /check --claim/);
  assert.match(result.out, /verify --record/);
  assert.match(result.out, /Exit codes: 0 the contact was confirmed/);
  // No arguments at all is a usage error rather than a silent success.
  assert.equal(cli([]).code, 50);
});

test("an unknown command and a missing option are usage errors", () => {
  assert.equal(cli(["ring", "--claim", claimFile]).code, 50);
  assert.match(cli(["ring"]).err, /Unknown command/);
  assert.match(cli(["preview"]).err, /Option --claim is required/);
  assert.match(cli(["preview", "--claim"]).err, /needs a value/);
});
