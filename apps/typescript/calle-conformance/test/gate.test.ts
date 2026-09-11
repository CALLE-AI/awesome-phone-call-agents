/**
 * The gate is the part of this tool that can fail somebody's build, so it is
 * the part that has to be adversarial about itself.
 *
 * Two properties are tested here. First, the gate distinguishes three outcomes
 * and never collapses "your fixtures do not cover this" into "I could not read
 * anything". Second, hostile input does not make the checker report success:
 * truncated JSON, wrong types where objects are expected, and payloads that
 * parse but mean nothing must leave a requirement uncovered, not covered.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QUIRKS, quirksIn } from "../src/quirks.ts";

const PASS = 0;
const MISSING = 20;
const NOTHING_TO_JUDGE = 45;
const REPLAY = join(import.meta.dirname, "..", "src", "replay.ts");

function replay(args: string[]) {
  const r = spawnSync(process.execPath, [REPLAY, ...args], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function scratch(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "calle-gate-"));
  mkdirSync(join(dir, "apps", "python", "subject"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, "apps", "python", "subject", name), body, "utf8");
  }
  return dir;
}

const CONNECTED = JSON.stringify({
  id: "c1", status: "completed", createdAt: "2026-03-04T14:00:00.000Z",
  recipients: [{ status: "completed", attempts: [{
    status: "completed", failureCode: null,
    startedAt: "2026-03-04T14:00:05.000Z", completedAt: "2026-03-04T14:00:25.000Z",
    transcriptTurns: [{ speaker: "bot", text: "hello", offset_seconds: 0 }],
  }] }],
});

describe("the gate reports three outcomes, not two", () => {
  test("a covered requirement exits 0", () => {
    const dir = scratch({ "call.json": CONNECTED });
    try {
      const r = replay([dir, "--require", "connected-call-timestamps-are-well-formed"]);
      assert.equal(r.code, PASS, r.out);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("an uncovered requirement exits 20 and names what is missing", () => {
    const dir = scratch({ "call.json": CONNECTED });
    try {
      const r = replay([dir, "--require", "raw-sip-code-as-failure-code"]);
      assert.equal(r.code, MISSING, r.out);
      assert.match(r.out, /not covered .*raw-sip-code-as-failure-code/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("nothing readable exits 45, which is not the same as uncovered", () => {
    const dir = scratch({ "notes.json": '{"hello":"world"}' });
    try {
      const r = replay([dir, "--require", "all"]);
      assert.equal(r.code, NOTHING_TO_JUDGE, r.out);
      assert.notEqual(NOTHING_TO_JUDGE, MISSING);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("no requirement means no gate, and the report still exits 0", () => {
    const dir = scratch({ "call.json": CONNECTED });
    try {
      assert.equal(replay([dir]).code, PASS);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("a requirement that does not exist is refused, not silently ignored", () => {
    const dir = scratch({ "call.json": CONNECTED });
    try {
      const r = replay([dir, "--require", "no-such-behaviour"]);
      assert.notEqual(r.code, PASS);
      assert.match(r.out, /do not exist/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("hostile input never reports success", () => {
  const HOSTILE: Record<string, string> = {
    "truncated.json": '{"recipients":[{"attempts":[{"startedAt":',
    "null-recipients.json": '{"id":"x","recipients":null}',
    "string-attempts.json": '{"id":"x","recipients":[{"attempts":"nope"}]}',
    "turns-not-array.json": '{"id":"x","recipients":[{"attempts":[{"transcriptTurns":7}]}]}',
    "deeply-nested.json": JSON.stringify({ a: { b: { c: { d: { recipients: 1 } } } } }),
    "empty.json": "",
    "array-root.json": "[1,2,3]",
  };

  test("the predicates decide false rather than throwing", () => {
    for (const body of Object.values(HOSTILE)) {
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { continue; }
      assert.doesNotThrow(() => quirksIn(parsed as never), `threw on ${body.slice(0, 40)}`);
    }
  });

  test("a directory of malformed payloads cannot satisfy a requirement", () => {
    const dir = scratch(HOSTILE);
    try {
      const r = replay([dir, "--require", "all"]);
      assert.notEqual(r.code, PASS, `hostile input passed the gate:\n${r.out}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("every quirk id is unique, so a requirement cannot name two things", () => {
    const ids = QUIRKS.map((q) => q.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
