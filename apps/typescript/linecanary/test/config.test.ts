/**
 * Config is operator input that later causes real phone calls, so validation
 * refuses loudly and names the offending entry. These tests pin the refusals
 * as much as the happy path.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig } from "../src/config.js";

function writeConfig(value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "linecanary-config-"));
  const path = join(dir, "linecanary.config.json");
  writeFileSync(path, JSON.stringify(value, null, 2));
  return path;
}

function validConfig(): Record<string, unknown> {
  return {
    lines: [
      {
        id: "main-office",
        phone: "+15550100",
        region: "US",
        locale: "en-US",
        ownership: { method: "greeting_code", code: "LC-7391" },
      },
    ],
    checks: [
      {
        id: "hours-question",
        line: "main-office",
        task: "Ask what the Saturday opening hours are and record the answer.",
        resultSchema: {
          type: "object",
          properties: { answered: { type: "boolean" }, hours_answer: { type: "string" } },
          required: ["answered"],
          additionalProperties: false,
        },
        assert: [
          { path: "answered", equals: true },
          { path: "hours_answer", matches: "saturday|weekend" },
        ],
        timing: { maxSecondsToAnswer: 20 },
        minConfidence: 0.6,
      },
    ],
  };
}

test("loads a valid config and applies defaults", () => {
  const config = loadConfig(writeConfig(validConfig()));
  assert.equal(config.lines[0].id, "main-office");
  assert.equal(config.checks[0].line, "main-office");
  assert.equal(config.baselineDir, "baselines");
  assert.equal(config.alerts?.slackWebhookUrl, undefined);
});

test("rejects duplicate check ids", () => {
  const raw = validConfig();
  (raw.checks as unknown[]).push((raw.checks as unknown[])[0]);
  assert.throws(() => loadConfig(writeConfig(raw)), (error: unknown) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /hours-question/);
    return true;
  });
});

test("rejects a check that references an unknown line", () => {
  const raw = validConfig();
  (raw.checks as { line: string }[])[0].line = "ghost-line";
  assert.throws(() => loadConfig(writeConfig(raw)), (error: unknown) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /ghost-line/);
    return true;
  });
});

test("rejects phones that are not E.164", () => {
  const raw = validConfig();
  (raw.lines as { phone: string }[])[0].phone = "555-0100";
  assert.throws(() => loadConfig(writeConfig(raw)), (error: unknown) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /555-0100/);
    return true;
  });
});

test("rejects an invalid assertion regex", () => {
  const raw = validConfig();
  (raw.checks as { assert: unknown[] }[])[0].assert = [{ path: "hours_answer", matches: "(unclosed" }];
  assert.throws(() => loadConfig(writeConfig(raw)), ConfigError);
});

test("rejects a result schema without additionalProperties false", () => {
  const raw = validConfig();
  (raw.checks as { resultSchema: Record<string, unknown> }[])[0].resultSchema = {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
  };
  assert.throws(() => loadConfig(writeConfig(raw)), (error: unknown) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /additionalProperties/);
    return true;
  });
});

test("rejects a check with no assertions and no timing bounds", () => {
  const raw = validConfig();
  const check = (raw.checks as Record<string, unknown>[])[0];
  check.assert = [];
  delete check.timing;
  delete check.minConfidence;
  assert.throws(() => loadConfig(writeConfig(raw)), ConfigError);
});

test("rejects a line without ownership", () => {
  const raw = validConfig();
  delete (raw.lines as Record<string, unknown>[])[0].ownership;
  assert.throws(() => loadConfig(writeConfig(raw)), ConfigError);
});

test("resolves env: indirection for the Slack webhook and refuses a missing variable", () => {
  const raw = validConfig();
  raw.alerts = { slackWebhookUrl: "env:LINECANARY_TEST_WEBHOOK" };
  process.env.LINECANARY_TEST_WEBHOOK = "https://hooks.slack.example/T000/B000";
  try {
    const config = loadConfig(writeConfig(raw));
    assert.equal(config.alerts?.slackWebhookUrl, "https://hooks.slack.example/T000/B000");
  } finally {
    delete process.env.LINECANARY_TEST_WEBHOOK;
  }
  assert.throws(() => loadConfig(writeConfig(raw)), (error: unknown) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /LINECANARY_TEST_WEBHOOK/);
    return true;
  });
});
