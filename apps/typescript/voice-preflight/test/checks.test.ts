/**
 * The checks in isolation, plus the duration measurement they depend on.
 *
 * The load-bearing assertion in this file is the last one: a check that cannot
 * measure a duration must produce no finding at all rather than a guess.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { wavOfSeconds, BYTE_RATE } from "../fake/tts-server.js";
import {
  BLOCKING,
  blocks,
  checkAll,
  checkDigitRuns,
  checkLockedLines,
  checkSpokenLength,
  checkVoiceLanguage,
  primaryLanguage,
} from "../src/checks.js";
import { probeSeconds, wavSeconds } from "../src/probe.js";
import type { ProviderDescriptor, Render, Script } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "voice-preflight-checks-"));

const DESCRIPTOR: ProviderDescriptor = {
  name: "acme",
  endpoint: "https://api.acme.example/v1/tts/{voice}",
  method: "POST",
  authHeader: "authorization",
  authEnv: "ACME_TTS_KEY",
  bodyTemplate: '{"text":"{text}"}',
  audio: { kind: "body" },
  format: "mp3",
  maxChars: 4000,
  languages: ["en-US", "en-GB"],
};

function script(over: Partial<Script> = {}): Script {
  return {
    id: "s",
    task: "Hello there.",
    locale: "en-IN",
    voiceId: "v",
    maxSpokenSeconds: 30,
    locked: [],
    ...over,
  };
}

function rendered(seconds: number | null, path = "/tmp/x.wav"): Render {
  return { provider: "acme", voiceId: "v", bytes: 1000, seconds, path, cached: false };
}

describe("locked lines", () => {
  it("passes when the line is present exactly", () => {
    const s = script({
      task: "Please read back the six digit code.",
      locked: [{ text: "read back the six digit code", reason: "the gate needs it" }],
    });
    assert.deepEqual(checkLockedLines(s), []);
  });

  it("refuses a near match, because near is how a line quietly changes", () => {
    const s = script({
      task: "Please read back the 6 digit code.",
      locked: [{ text: "read back the six digit code", reason: "the gate needs it" }],
    });
    const findings = checkLockedLines(s);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.code, "locked_line_missing");
    assert.ok(/the gate needs it/.test(findings[0]?.message ?? ""), "the reason travels with it");
    assert.equal(findings[0]?.evidence, "read back the six digit code");
  });

  it("blocks, because a call that cannot say the line cannot do its job", () => {
    assert.ok(BLOCKING.has("locked_line_missing"));
  });
});

describe("digit runs", () => {
  it("reports a run of four or more and nothing shorter", () => {
    assert.equal(checkDigitRuns(script({ task: "code 999" })).length, 0);
    assert.equal(checkDigitRuns(script({ task: "code 9998" })).length, 1);
  });

  it("reports each distinct run once", () => {
    const findings = checkDigitRuns(script({ task: "999833 then 999833 then 123456" }));
    assert.deepEqual(
      findings.map((f) => f.evidence),
      ["999833", "123456"],
    );
  });

  it("never blocks and never claims a reading", () => {
    const findings = checkDigitRuns(script({ task: "code 999833" }));
    assert.equal(blocks(findings), false);
    assert.ok(/does not predict/.test(findings[0]?.message ?? ""));
  });
});

describe("voice language", () => {
  it("matches on the language subtag, so en-IN is fine for an en-US voice", () => {
    assert.equal(primaryLanguage("en-IN"), "en");
    assert.deepEqual(checkVoiceLanguage(script({ locale: "en-IN" }), DESCRIPTOR), []);
  });

  it("refuses a locale the voice cannot speak", () => {
    const findings = checkVoiceLanguage(script({ locale: "hi-IN" }), DESCRIPTOR);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.code, "voice_language_mismatch");
    assert.ok(blocks(findings));
  });
});

describe("spoken length", () => {
  it("refuses a measured overrun", () => {
    const findings = checkSpokenLength(script({ maxSpokenSeconds: 5 }), rendered(9.5));
    assert.equal(findings[0]?.code, "spoken_too_long");
    assert.ok(/9.5s against a budget of 5s/.test(findings[0]?.message ?? ""));
  });

  it("passes inside the budget", () => {
    assert.deepEqual(checkSpokenLength(script({ maxSpokenSeconds: 30 }), rendered(9.5)), []);
  });

  it("produces nothing when the duration could not be measured", () => {
    assert.deepEqual(checkSpokenLength(script({ maxSpokenSeconds: 1 }), rendered(null)), []);
    assert.deepEqual(checkSpokenLength(script({ maxSpokenSeconds: 1 }), null), []);
  });
});

describe("the provider character limit", () => {
  it("is reported first, because it is the reason nothing can be sent", () => {
    const long = { ...DESCRIPTOR, maxChars: 5 };
    const findings = checkAll(script({ task: "much longer than five" }), long, null);
    assert.equal(findings[0]?.code, "text_over_provider_limit");
    assert.ok(blocks(findings));
  });
});

describe("duration measurement", () => {
  it("parses a WAV header exactly", () => {
    const path = join(dir, "two.wav");
    writeFileSync(path, wavOfSeconds(2));
    const seconds = wavSeconds(path);
    assert.ok(seconds !== null);
    assert.ok(Math.abs(seconds - 2) < 0.01, `expected about 2s, measured ${seconds}`);
  });

  it("walks past an extra chunk instead of assuming fmt sits first", () => {
    const base = wavOfSeconds(1);
    const extra = Buffer.alloc(8 + 4);
    extra.write("LIST", 0, "ascii");
    extra.writeUInt32LE(4, 4);
    const spliced = Buffer.concat([base.subarray(0, 12), extra, base.subarray(12)]);
    spliced.writeUInt32LE(spliced.length - 8, 4);
    const path = join(dir, "list.wav");
    writeFileSync(path, spliced);
    const seconds = wavSeconds(path);
    assert.ok(seconds !== null && Math.abs(seconds - 1) < 0.01);
  });

  it("returns null for something that is not audio rather than a number", () => {
    const path = join(dir, "notaudio.bin");
    writeFileSync(path, Buffer.from("this is not a container"));
    assert.equal(wavSeconds(path), null);
    assert.equal(probeSeconds(path), null);
  });

  it("returns null for a missing file", () => {
    assert.equal(wavSeconds(join(dir, "absent.wav")), null);
  });

  it("has a byte rate the fake and the parser agree on", () => {
    assert.equal(BYTE_RATE, 16000);
  });
});
