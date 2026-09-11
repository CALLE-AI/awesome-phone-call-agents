/**
 * Refusals. Every case here is something the app must say no to.
 *
 * The two that matter most are a descriptor carrying a credential and an
 * endpoint the operator never named, because both of those are how a key
 * leaves the machine it belongs on.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { assertNoInlineSecret, loadDescriptor, loadScript } from "../src/config.js";
import { assertTrustedEndpoint, parseAllowedHosts } from "../src/hosts.js";
import { ConfigError } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "voice-preflight-refuse-"));

function writeJson(name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value), "utf8");
  return path;
}

const GOOD_DESCRIPTOR = {
  name: "acme",
  endpoint: "https://api.acme.example/v1/tts/{voice}",
  method: "POST",
  authHeader: "authorization",
  authPrefix: "Bearer ",
  authEnv: "ACME_TTS_KEY",
  bodyTemplate: '{"text":"{text}"}',
  audio: { kind: "body" },
  format: "mp3",
  maxChars: 4000,
  languages: ["en-US"],
};

describe("descriptor refuses to carry a credential", () => {
  it("refuses an authEnv that is not shaped like a variable name", () => {
    assert.throws(
      () => assertNoInlineSecret({ authEnv: "sk_live_51H8xkTGswQz9YkLm" }),
      (error: unknown) =>
        error instanceof ConfigError && /never holds the credential/.test((error as Error).message),
    );
  });

  it("accepts an ordinary variable name", () => {
    assert.doesNotThrow(() => assertNoInlineSecret({ authEnv: "FISH_AUDIO_TOKEN" }));
  });

  it("refuses a long opaque value hiding in a static header", () => {
    assert.throws(
      () =>
        assertNoInlineSecret({
          authEnv: "ACME_TTS_KEY",
          headers: { "x-token": "AbCdEf0123456789AbCdEf0123456789" },
        }),
      (error: unknown) =>
        error instanceof ConfigError && /what a credential looks like/.test((error as Error).message),
    );
  });

  it("allows a short static header such as a model name", () => {
    assert.doesNotThrow(() =>
      assertNoInlineSecret({ authEnv: "FISH_AUDIO_TOKEN", headers: { model: "s1" } }),
    );
  });
});

describe("descriptor shape", () => {
  it("loads a well formed descriptor", () => {
    const d = loadDescriptor(writeJson("good.json", GOOD_DESCRIPTOR));
    assert.equal(d.name, "acme");
    assert.equal(d.authPrefix, "Bearer ");
    assert.deepEqual(d.audio, { kind: "body" });
  });

  it("refuses POST with no body template, because there is nothing to send", () => {
    const raw = { ...GOOD_DESCRIPTOR };
    delete (raw as Record<string, unknown>)["bodyTemplate"];
    assert.throws(() => loadDescriptor(writeJson("nobody.json", raw)), /bodyTemplate is required/);
  });

  it("refuses a name that would not be safe in a file name", () => {
    assert.throws(
      () => loadDescriptor(writeJson("badname.json", { ...GOOD_DESCRIPTOR, name: "Acme TTS!" })),
      /lowercase slug/,
    );
  });

  it("refuses a language list that is not language tags", () => {
    assert.throws(
      () => loadDescriptor(writeJson("badlang.json", { ...GOOD_DESCRIPTOR, languages: ["english"] })),
      /not a language tag/,
    );
  });

  it("refuses an audio location with no path when one is required", () => {
    assert.throws(
      () =>
        loadDescriptor(
          writeJson("badaudio.json", { ...GOOD_DESCRIPTOR, audio: { kind: "base64Field" } }),
        ),
      /audio.path must be a non-empty array/,
    );
  });
});

describe("script shape", () => {
  const GOOD_SCRIPT = {
    id: "s",
    task: "Hello.",
    locale: "en-IN",
    voiceId: "v",
    maxSpokenSeconds: 30,
    locked: [{ text: "Hello.", reason: "it is the whole script" }],
  };

  it("loads a well formed script", () => {
    const s = loadScript(writeJson("script.json", GOOD_SCRIPT));
    assert.equal(s.locked.length, 1);
  });

  it("refuses a locked entry with no reason, so a refusal can always be explained", () => {
    assert.throws(
      () =>
        loadScript(
          writeJson("noreason.json", { ...GOOD_SCRIPT, locked: [{ text: "Hello." }] }),
        ),
      /locked\[0\]\.reason must be a non-empty string/,
    );
  });

  it("refuses a locale that is not a language tag", () => {
    assert.throws(
      () => loadScript(writeJson("badlocale.json", { ...GOOD_SCRIPT, locale: "Indian English" })),
      /not a BCP-47 language tag/,
    );
  });
});

describe("the credential only travels where the operator said", () => {
  it("refuses a host that was never named", () => {
    assert.throws(
      () => assertTrustedEndpoint("https://api.acme.example/v1/tts", [], "ACME_TTS_KEY"),
      (error: unknown) =>
        error instanceof ConfigError &&
        /is not an allowed host/.test((error as Error).message) &&
        /ACME_TTS_KEY was not sent anywhere/.test((error as Error).message),
    );
  });

  it("accepts the host once it is named", () => {
    const url = assertTrustedEndpoint("https://api.acme.example/v1/tts", ["api.acme.example"]);
    assert.equal(url.hostname, "api.acme.example");
  });

  it("refuses plain http off loopback, encrypted or not is not the same as known", () => {
    assert.throws(
      () => assertTrustedEndpoint("http://api.acme.example/v1", ["api.acme.example"]),
      /unencrypted/,
    );
  });

  it("allows http on loopback with no allowlist, which is what the fake uses", () => {
    const url = assertTrustedEndpoint("http://127.0.0.1:8080/speak", []);
    assert.equal(url.port, "8080");
  });

  it("refuses a wildcard or a port in the allowlist rather than guessing", () => {
    assert.throws(() => parseAllowedHosts(["*.acme.example"]), /not a plain hostname/);
    assert.throws(() => parseAllowedHosts(["api.acme.example:443"]), /not a plain hostname/);
  });

  it("refuses a non-http scheme", () => {
    assert.throws(() => assertTrustedEndpoint("file:///etc/passwd", []), /does not use http or https/);
  });
});
