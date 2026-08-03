/**
 * End-to-end: the CLI as a child process, the real SDK inside it, the fake
 * CALL-E server in this process. Verifies the full loop an operator runs:
 * init → verify → live run → regression on the next run → exit codes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { startFakeCalle } from "../fake/calle-server.js";

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "..");

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function cli(args: string[], env: Record<string, string>): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", join(ROOT, "src/cli.ts"), ...args],
      { cwd: ROOT, env: { ...process.env, ...env } },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? -1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

test("init → verify → live run → regression → exit codes", { timeout: 120_000 }, async () => {
  const fake = await startFakeCalle([
    { phone: "+15550100", structuredResult: { greeting_transcript: "This line is monitored. Canary I D: L C 7 3 9 1." } },
  ]);
  const workspace = mkdtempSync(join(tmpdir(), "linecanary-e2e-"));
  const configPath = join(workspace, "linecanary.config.json");
  const baselineDir = join(workspace, "baselines");
  const env = { CALLE_API_KEY: "calle_test_key", CALLE_BASE_URL: fake.baseUrl };

  try {
    // init writes a starter config
    const init = await cli(["init", "--config", configPath], env);
    assert.equal(init.code, 0, init.stderr);
    assert.ok(existsSync(configPath));

    // Replace the starter config with one matching the fake scenarios.
    writeFileSync(
      configPath,
      JSON.stringify({
        lines: [{ id: "main-office", phone: "+15550100", ownership: { method: "greeting_code", code: "LC-7391" } }],
        checks: [
          {
            id: "hours",
            line: "main-office",
            task: "Ask for Saturday hours.",
            resultSchema: {
              type: "object",
              properties: { answered: { type: "boolean" } },
              required: ["answered"],
              additionalProperties: false,
            },
            assert: [{ path: "answered", equals: true }],
          },
        ],
        baselineDir,
      }),
    );

    // dry-run by default: no calls placed
    const dry = await cli(["run", "--config", configPath], env);
    assert.equal(dry.code, 0, dry.stderr);
    assert.match(dry.stdout, /dry-run/);
    assert.equal(fake.created.length, 0);

    // live run refuses the unverified line and places no call
    const unverified = await cli(["run", "--config", configPath, "--live"], env);
    assert.equal(unverified.code, 0, unverified.stderr);
    assert.match(unverified.stdout, /unverified-line/);
    assert.equal(fake.created.length, 0);

    // verify the line via greeting code
    const verify = await cli(["verify", "main-office", "--config", configPath], env);
    assert.equal(verify.code, 0, verify.stderr);
    assert.match(verify.stdout, /verified/);
    assert.equal(fake.created.length, 1);

    // switch the scenario to answer the monitoring question
    fake.setScenario({
      phone: "+15550100",
      structuredResult: { answered: true },
      turns: [{ speaker: "user", text: "Front desk.", offsetSeconds: 4 }],
    });

    // first live run: passes, baseline written
    const first = await cli(["run", "--config", configPath, "--live", "--json", join(workspace, "report.json")], env);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /OK/);
    const history = JSON.parse(readFileSync(join(baselineDir, "hours.history.json"), "utf8")) as unknown[];
    assert.equal(history.length, 1);
    const written = JSON.parse(readFileSync(join(workspace, "report.json"), "utf8")) as { ok: boolean };
    assert.equal(written.ok, true);

    // inject the regression
    fake.setScenario({ phone: "+15550100", structuredResult: { answered: false }, turns: [] });
    const second = await cli(["run", "--config", configPath, "--live"], env);
    assert.equal(second.code, 1, `expected exit 1, got ${second.code}: ${second.stdout} ${second.stderr}`);
    assert.match(second.stdout, /new_failure/);
    assert.match(second.stdout, /answered/);

    // report prints the stored history
    const report = await cli(["report", "--config", configPath], env);
    assert.equal(report.code, 0);
    assert.match(report.stdout, /hours/);
    assert.match(report.stdout, /fail/);
  } finally {
    await fake.close();
  }
});

test("run without an API key in live mode exits 2 with guidance", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "linecanary-e2e-"));
  const configPath = join(workspace, "linecanary.config.json");
  await cli(["init", "--config", configPath], {});
  // The starter config wires Slack through env: indirection; satisfy it so
  // the failure under test is the missing API key, not the missing webhook.
  const env = { CALLE_API_KEY: "", LINECANARY_SLACK_WEBHOOK: "https://hooks.slack.example/T0/B0" };
  const result = await cli(["run", "--config", configPath, "--live"], env);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /CALLE_API_KEY/);
});

test("unknown command exits 2 with usage", async () => {
  const result = await cli(["frobnicate"], {});
  assert.equal(result.code, 2);
  assert.match(result.stderr, /usage/i);
});
