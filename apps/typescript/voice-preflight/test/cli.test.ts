/**
 * The CLI contract: exit codes and argument handling.
 *
 * A pipeline gates on the exit code, so each one is pinned here rather than
 * left to the reader of the usage text.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { main, parseArgs } from "../src/cli.js";

const dir = mkdtempSync(join(tmpdir(), "voice-preflight-cli-"));

function write(name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value), "utf8");
  return path;
}

const PROVIDER = write("p.json", {
  name: "acme",
  endpoint: "https://api.acme.example/v1/tts/{voice}",
  method: "POST",
  authHeader: "authorization",
  authEnv: "ACME_TTS_KEY",
  bodyTemplate: '{"text":"{text}"}',
  audio: { kind: "body" },
  format: "mp3",
  maxChars: 4000,
  languages: ["en-US"],
});

const CLEAN = write("clean.json", {
  id: "clean",
  task: "Hello, this is a short script.",
  locale: "en-US",
  voiceId: "v",
  maxSpokenSeconds: 30,
  locked: [{ text: "this is a short script", reason: "it is the whole point" }],
});

const BROKEN = write("broken.json", {
  id: "broken",
  task: "Hello, the line went missing.",
  locale: "en-US",
  voiceId: "v",
  maxSpokenSeconds: 30,
  locked: [{ text: "this is a short script", reason: "it is the whole point" }],
});

describe("argument parsing", () => {
  it("reads the flags it documents", () => {
    const args = parseArgs(["render", "--script", "a", "--provider", "b", "--json", "--allow-host", "h"]);
    assert.equal(args.command, "render");
    assert.equal(args.script, "a");
    assert.equal(args.provider, "b");
    assert.equal(args.json, true);
    assert.deepEqual(args.allowHosts, ["h"]);
  });

  it("refuses an unknown option rather than ignoring it", () => {
    assert.throws(() => parseArgs(["preview", "--sript", "a"]), /Unknown option --sript/);
  });

  it("refuses a flag with no value", () => {
    assert.throws(() => parseArgs(["preview", "--script"]), /--script needs a value/);
  });
});

describe("exit codes", () => {
  it("0 when nothing blocks", async () => {
    assert.equal(await main(["preview", "--script", CLEAN, "--provider", PROVIDER, "--json"]), 0);
  });

  it("20 when a locked line is gone", async () => {
    assert.equal(await main(["preview", "--script", BROKEN, "--provider", PROVIDER, "--json"]), 20);
  });

  it("30 on a missing argument", async () => {
    assert.equal(await main(["preview", "--script", CLEAN]), 30);
  });

  it("30 on an unknown command", async () => {
    assert.equal(await main(["renderr", "--script", CLEAN, "--provider", PROVIDER]), 30);
  });

  it("30 on an input file that is not there", async () => {
    assert.equal(await main(["preview", "--script", join(dir, "absent.json"), "--provider", PROVIDER]), 30);
  });

  it("0 for help", async () => {
    assert.equal(await main(["help"]), 0);
  });

  it("30 when render is asked for a host nobody allowed, before any request", async () => {
    // No ACME_TTS_KEY is set either. The host check runs first, so this is a
    // config refusal rather than a provider failure.
    assert.equal(await main(["render", "--script", CLEAN, "--provider", PROVIDER, "--json"]), 30);
  });
});
