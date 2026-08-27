/**
 * The descriptor credential contract, field by field.
 *
 * A descriptor is the file people commit and paste to each other, so it names
 * the environment variable holding a credential and never carries one. Review
 * found the earlier guard too narrow: it read `authEnv` and static header values
 * only, so long key material in `authPrefix` and in an endpoint query parameter
 * was accepted and sent. Both are the first two cases here.
 *
 * Every field that can put a string into a URL or a header has a case. The field
 * set is closed too, so an unknown field is refused rather than ignored. The
 * last four cases are the other half of the contract: the shipped descriptors
 * still load, a long model name is not a credential and a legitimate descriptor
 * still renders. A guard that refuses everything would pass the refusals above
 * and fail those.
 *
 * The key material here is a fake value. Nothing in this file reaches a network.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { loadDescriptor } from "../src/config.js";
import { render } from "../src/gateway.js";
import { wavOfSeconds } from "../fake/tts-server.js";
import { ConfigError, type ProviderDescriptor } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "voice-preflight-contract-"));
/** Fake key material, long enough to be shaped like the real thing. */
const INLINE = "FAKEKEY0123456789abcdefghijklmnop";
const ENDPOINT = "https://api.acme.example/v1/tts";
const TEXT = "Hear this before the callee does.";

const BASE = {
  name: "acme",
  endpoint: ENDPOINT,
  method: "POST",
  authHeader: "authorization",
  authPrefix: "Bearer ",
  authEnv: "ACME_TTS_KEY",
  headers: { model: "s1" },
  bodyTemplate: '{"text":"{text}","voice":"{voice}"}',
  audio: { kind: "body" },
  format: "wav",
  maxChars: 4000,
  languages: ["en-US"],
} as const;

/** One descriptor on disk, since the loader is the contract being tested. */
function written(label: string, overrides: Record<string, unknown>): string {
  const path = join(dir, `${label.replace(/[^a-z0-9]+/gi, "-")}.json`);
  const raw: Record<string, unknown> = { ...BASE, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete raw[key];
  }
  writeFileSync(path, JSON.stringify(raw), "utf8");
  return path;
}

function refusal(label: string, overrides: Record<string, unknown>): string {
  const path = written(label, overrides);
  try {
    loadDescriptor(path);
  } catch (error) {
    assert.ok(error instanceof ConfigError, `expected a ConfigError, got ${String(error)}`);
    return error.message;
  }
  assert.fail(`${label} was accepted, so a credential there would be committed and sent`);
}

/** The inline value must never be quoted back in a refusal. */
function assertKeyRefusal(message: string, where: RegExp): void {
  assert.match(message, where);
  assert.match(message, /which is what a credential looks like/);
  assert.ok(!message.includes(INLINE), "the refusal must not echo the value back");
}

interface StubCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function stubFetch(): { impl: typeof fetch; calls: StubCall[] } {
  const calls: StubCall[] = [];
  const impl: typeof fetch = async (input, init) => {
    calls.push({
      url: input instanceof URL ? input.href : String(input),
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      body: typeof init?.body === "string" ? init.body : "",
    });
    return new Response(new Uint8Array(wavOfSeconds(1)));
  };
  return { impl, calls };
}

function renderWith(descriptor: ProviderDescriptor, impl: typeof fetch): Promise<unknown> {
  return render({
    descriptor,
    voiceId: "v",
    text: TEXT,
    cacheDir: mkdtempSync(join(tmpdir(), "voice-preflight-contract-cache-")),
    allowedHosts: ["api.acme.example"],
    fetchImpl: impl,
    env: { ACME_TTS_KEY: "fake-key-value" },
  });
}

describe("the two fields the review probed", () => {
  it("refuses key material in authPrefix, which is not a static header", () => {
    const message = refusal("authPrefix", { authPrefix: `Bearer ${INLINE} ` });
    assertKeyRefusal(message, /descriptor\.authPrefix/);
  });

  it("refuses key material in an endpoint query parameter", () => {
    const message = refusal("endpoint-query", { endpoint: `${ENDPOINT}?api_key=${INLINE}` });
    assertKeyRefusal(message, /The query string in descriptor\.endpoint/);
  });
});

describe("every other field that reaches a URL or a header", () => {
  it("refuses credentials in the endpoint before the host, at load rather than at send", () => {
    const message = refusal("endpoint-userinfo", {
      endpoint: `https://acme:${INLINE}@api.acme.example/v1/tts`,
    });
    assert.match(message, /carries credentials in the URL itself/);
    assert.ok(!message.includes(INLINE), "the refusal must not echo the value back");
  });

  it("refuses key material in an endpoint path segment", () => {
    const message = refusal("endpoint-path", { endpoint: `${ENDPOINT}/${INLINE}` });
    assertKeyRefusal(message, /The path in descriptor\.endpoint/);
  });

  it("refuses key material in authHeader, where it would become a header name", () => {
    const message = refusal("authHeader", { authHeader: INLINE });
    assertKeyRefusal(message, /descriptor\.authHeader/);
  });

  it("refuses key material in a static header value", () => {
    const message = refusal("header-value", { headers: { "x-token": INLINE } });
    assertKeyRefusal(message, /headers\.x-token/);
  });

  it("refuses key material in a static header field name", () => {
    const message = refusal("header-name", { headers: { [INLINE]: "s1" } });
    assertKeyRefusal(message, /A field name in descriptor\.headers/);
  });

  it("refuses key material in bodyTemplate", () => {
    const message = refusal("bodyTemplate", {
      bodyTemplate: `{"text":"{text}","key":"${INLINE}"}`,
    });
    assertKeyRefusal(message, /descriptor\.bodyTemplate/);
  });

  it("refuses key material in audio.path, which reaches neither but is still committed", () => {
    const message = refusal("audio-path", { audio: { kind: "base64Field", path: ["data", INLINE] } });
    assertKeyRefusal(message, /descriptor\.audio\.path\[1\]/);
  });

  it("refuses key material in a language tag", () => {
    const message = refusal("languages", { languages: ["en-US", "xx-abcdefgh-abcdefgh-abcdefgh"] });
    assertKeyRefusal(message, /descriptor\.languages\[1\]/);
  });

  it("refuses an unknown field rather than ignoring it", () => {
    const message = refusal("unknown-field", { apiKey: INLINE });
    assert.match(message, /descriptor\.apiKey is not a field this app reads/);
    assert.match(message, /name, endpoint, method, authHeader/);
  });
});

describe("the grammars that leave nowhere for key material to sit", () => {
  it("refuses an authPrefix that is not one auth scheme name", () => {
    const message = refusal("authPrefix-grammar", { authPrefix: "Bearer token " });
    assert.match(message, /is not an auth scheme name/);
    assert.match(message, /at most 16 characters plus an optional trailing space/);
  });

  it("refuses an authHeader that is not an HTTP header name", () => {
    const message = refusal("authHeader-grammar", { authHeader: "x api key" });
    assert.match(message, /is not an HTTP header name/);
  });

  it("refuses a static header field name that is not an HTTP header name", () => {
    const message = refusal("header-name-grammar", { headers: { "x model": "s1" } });
    assert.match(message, /is not an HTTP header name/);
  });
});

describe("the guard is not a blanket refusal", () => {
  it("accepts every descriptor shipped in examples", () => {
    const shipped = ["elevenlabs", "fish-audio", "local-fake"];
    for (const slug of shipped) {
      const path = fileURLToPath(new URL(`../examples/provider.${slug}.json`, import.meta.url));
      const descriptor = loadDescriptor(path);
      assert.equal(descriptor.name, slug);
    }
  });

  it("accepts a long model name, which is not a credential", () => {
    // The tightest legitimate case in the repository: the shipped ElevenLabs body
    // template carries eleven_multilingual_v2, 22 characters of the alphabet a
    // key is written in. It is why the threshold counting separators is 24.
    const path = written("model-name", {
      bodyTemplate: '{"text":"{text}","model_id":"eleven_multilingual_v2"}',
      headers: { model: "s1", "x-cache": "no-store" },
      endpoint: "https://api.elevenlabs.io/v1/text-to-speech/{voice}",
    });
    const descriptor = loadDescriptor(path);
    assert.equal(descriptor.authPrefix, "Bearer ");
    assert.match(descriptor.bodyTemplate ?? "", /eleven_multilingual_v2/);
  });
});

describe("the same contract on a descriptor built in code", () => {
  /** The loader is not the only door. A descriptor can be constructed and rendered. */
  function built(overrides: Partial<ProviderDescriptor>): ProviderDescriptor {
    return {
      name: "acme",
      endpoint: ENDPOINT,
      method: "POST",
      authHeader: "authorization",
      authPrefix: "Bearer ",
      authEnv: "ACME_TTS_KEY",
      bodyTemplate: '{"text":"{text}","voice":"{voice}"}',
      audio: { kind: "body" },
      format: "wav",
      maxChars: 4000,
      languages: ["en-US"],
      ...overrides,
    };
  }

  it("refuses it in render, before any request is built", async () => {
    const stub = stubFetch();
    await assert.rejects(
      renderWith(built({ authPrefix: `Bearer ${INLINE} ` }), stub.impl),
      (error: unknown) => error instanceof ConfigError && /descriptor\.authPrefix/.test(error.message),
    );
    assert.deepEqual(stub.calls, [], "nothing was requested");
  });

  it("renders a legitimate one, so the gate in render is not in the way", async () => {
    const stub = stubFetch();
    await renderWith(built({}), stub.impl);
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls.at(0)?.url, ENDPOINT);
    assert.equal(stub.calls.at(0)?.headers["authorization"], "Bearer fake-key-value");
  });
});
