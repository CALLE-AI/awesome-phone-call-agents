/**
 * End to end against the local fake provider.
 *
 * Nothing here is mocked at the HTTP boundary. A real server binds a loopback
 * port, the real client sends a real request and a real WAV comes back, so the
 * duration this asserts is measured from a container rather than stubbed.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { startFakeProvider, CHARS_PER_SECOND, type FakeProvider } from "../fake/tts-server.js";
import { render } from "../src/gateway.js";
import { preflight } from "../src/preflight.js";
import { ProviderError, type ProviderDescriptor, type Script } from "../src/types.js";

const KEY = "fake-key-value";
const ENV = { LOCAL_FAKE_KEY: KEY } as const;

function descriptorFor(url: string, path = "/speak"): ProviderDescriptor {
  return {
    name: "local-fake",
    endpoint: `${url}${path}`,
    method: "POST",
    authHeader: "x-api-key",
    authEnv: "LOCAL_FAKE_KEY",
    bodyTemplate: '{"text":"{text}","voice":"{voice}"}',
    audio: { kind: "body" },
    format: "wav",
    maxChars: 4000,
    languages: ["en-US", "en-IN"],
  };
}

function scriptOf(task: string, over: Partial<Script> = {}): Script {
  return {
    id: "t",
    task,
    locale: "en-IN",
    voiceId: "voice-1",
    maxSpokenSeconds: 600,
    locked: [],
    ...over,
  };
}

describe("gateway against a real fake provider", () => {
  let fake: FakeProvider;
  let cache: string;

  before(async () => {
    fake = await startFakeProvider({ expectKey: KEY });
    cache = mkdtempSync(join(tmpdir(), "voice-preflight-"));
  });
  after(async () => {
    await fake.close();
  });

  it("sends the credential in the declared header and writes real audio", async () => {
    const out = await render({
      descriptor: descriptorFor(fake.url),
      voiceId: "voice-1",
      text: "Hello, this is a preflight.",
      cacheDir: cache,
      allowedHosts: [],
      env: ENV,
    });
    assert.equal(out.cached, false);
    assert.ok(out.bytes > 44, "a WAV header alone would be 44 bytes");
    const seen = fake.seen.at(-1);
    assert.equal(seen?.auth, KEY, "the credential arrived in x-api-key");
    assert.ok(seen?.body.includes("Hello, this is a preflight."), "the text was sent");
    assert.equal(readFileSync(out.path).toString("ascii", 0, 4), "RIFF");
    assert.equal(statSync(out.path).mode & 0o777, 0o600, "audio is written 0600");
  });

  it("serves the second identical render from cache without a request", async () => {
    const args = {
      descriptor: descriptorFor(fake.url),
      voiceId: "voice-2",
      text: "Cache me once.",
      cacheDir: cache,
      allowedHosts: [],
      env: ENV,
    };
    await render(args);
    const before = fake.seen.length;
    const second = await render(args);
    assert.equal(second.cached, true);
    assert.equal(fake.seen.length, before, "no request was made for the cached render");
  });

  it("reads audio out of a JSON field when the descriptor says so", async () => {
    const descriptor = descriptorFor(fake.url, "/speak-json");
    descriptor.audio = { kind: "base64Field", path: ["result", "audio"] };
    const out = await render({
      descriptor,
      voiceId: "voice-3",
      text: "Base64 please.",
      cacheDir: cache,
      allowedHosts: [],
      env: ENV,
    });
    assert.equal(readFileSync(out.path).toString("ascii", 0, 4), "RIFF");
  });

  it("refuses a wrong credential rather than writing a file", async () => {
    await assert.rejects(
      render({
        descriptor: descriptorFor(fake.url),
        voiceId: "voice-4",
        text: "Wrong key.",
        cacheDir: cache,
        allowedHosts: [],
        env: { LOCAL_FAKE_KEY: "not-the-key" },
      }),
      (error: unknown) => error instanceof ProviderError && /answered 401/.test((error as Error).message),
    );
  });

  it("refuses before reading the credential when the text is over the limit", async () => {
    const descriptor = descriptorFor(fake.url);
    descriptor.maxChars = 10;
    const before = fake.seen.length;
    await assert.rejects(
      render({
        descriptor,
        voiceId: "voice-5",
        text: "This is far longer than ten characters.",
        cacheDir: cache,
        allowedHosts: [],
        env: {},
      }),
      (error: unknown) =>
        error instanceof ProviderError && /no credential was read/.test((error as Error).message),
    );
    assert.equal(fake.seen.length, before, "nothing was sent");
  });

  it("measures the spoken length and refuses a script over its budget", async () => {
    // The fake speaks at a known pace, so the budget can be crossed on purpose.
    const task = "x".repeat(CHARS_PER_SECOND * 8);
    const result = await preflight({
      script: scriptOf(task, { maxSpokenSeconds: 3, voiceId: "voice-6" }),
      descriptor: descriptorFor(fake.url),
      cacheDir: cache,
      allowedHosts: [],
      doRender: true,
      env: ENV,
    });
    assert.ok(result.render !== null && result.render.seconds !== null, "duration was measured");
    assert.ok(result.render.seconds > 3);
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.code === "spoken_too_long"));
  });

  it("passes a script that fits then reports a digit run without refusing", async () => {
    const result = await preflight({
      script: scriptOf("Read back the code 999833 to approve.", { voiceId: "voice-7" }),
      descriptor: descriptorFor(fake.url),
      cacheDir: cache,
      allowedHosts: [],
      doRender: true,
      env: ENV,
    });
    assert.equal(result.ok, true, "a digit run must not block a call");
    const digit = result.findings.find((f) => f.code === "digit_run_unseparated");
    assert.equal(digit?.evidence, "999833");
    assert.ok(/does not predict/.test(digit?.message ?? ""), "the message must not claim a reading");
  });
});
