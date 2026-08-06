/**
 * The two boundaries a provider controls at runtime: where a redirect points
 * and where an audio URL points.
 *
 * Both were reproduced against the code as it stood before this file existed.
 * The credentialed request followed a cross-origin redirect and the descriptor's
 * own auth header arrived at hop two, because Node strips `Authorization` there
 * and strips nothing else. The `urlField` path fetched whatever URL a provider
 * named, including a service listening on this machine. Ten of the twelve cases
 * here fail without the policy in `src/hosts.ts` and the manual hop handling in
 * `src/gateway.ts`. The other two are the working paths the fix had to leave
 * alone: a provider that moves a path on its own origin, plus an audio link on a
 * host the operator allowed. Both are marked.
 *
 * Every case asserts what the far side saw before it asserts the refusal. Run
 * against the unfixed code the failure then prints the request that should never
 * have been made, rather than a bare missing-rejection message.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { startFakeProvider, wavOfSeconds } from "../fake/tts-server.js";
import { render } from "../src/gateway.js";
import { ConfigError, ProviderError, type ProviderDescriptor, type Render } from "../src/types.js";

const KEY = "fake-key-value";
const ENV = { LOCAL_FAKE_KEY: KEY } as const;
/** A descriptor-selected header, which is the one Node does not strip. */
const AUTH_HEADER = "xi-api-key";
const TEXT = "Hear this before the callee does.";
/** An https provider, plus the hosts an operator named for it. */
const REMOTE = "https://api.acme.example/v1/tts";
const CDN = "cdn.acme.example";
const ALLOWED = ["api.acme.example", CDN, "alt.acme.example"];

function cacheDir(): string {
  return mkdtempSync(join(tmpdir(), "voice-preflight-boundary-"));
}

function descriptorFor(endpoint: string): ProviderDescriptor {
  return {
    name: "local-fake",
    endpoint,
    method: "POST",
    authHeader: AUTH_HEADER,
    authEnv: "LOCAL_FAKE_KEY",
    bodyTemplate: '{"text":"{text}","voice":"{voice}"}',
    audio: { kind: "body" },
    format: "wav",
    maxChars: 4000,
    languages: ["en-US"],
  };
}

/** The same provider, declaring that its audio sits behind a URL. */
function urlFieldDescriptor(endpoint: string): ProviderDescriptor {
  const descriptor = descriptorFor(endpoint);
  descriptor.audio = { kind: "urlField", path: ["data", "url"] };
  return descriptor;
}

/** A service reachable only from this machine. It records and it answers. */
async function startRecorder(): Promise<{
  url: string;
  paths: string[];
  close: () => Promise<void>;
}> {
  const paths: string[] = [];
  const server: Server = createServer((req, res) => {
    paths.push((req.url ?? "/").split("?")[0] ?? "/");
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(Buffer.from("internal-service-body"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("recorder did not bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    paths,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
interface StubCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/**
 * An https provider with no network at all, which is how the remote cases stay
 * runnable offline. The loopback cases use real servers instead.
 */
function stubFetch(answer: (url: string) => Response): { impl: typeof fetch; calls: StubCall[] } {
  const calls: StubCall[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input.href : String(input);
    calls.push({
      method: init?.method ?? "GET",
      url,
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
    });
    return answer(url);
  };
  return { impl, calls };
}

function movedTo(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/** What a `urlField` provider answers with: a link rather than the bytes. */
function audioAt(url: string): Response {
  return new Response(JSON.stringify({ data: { url } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Audio bytes as a response. A `Buffer` is not a `BodyInit` under this tsconfig. */
function bytesResponse(bytes: Buffer): Response {
  return new Response(new Uint8Array(bytes));
}

/** URLs a stub was asked for, which is what proves a request never happened. */
function urlsOf(calls: readonly StubCall[]): string[] {
  return calls.map((call) => call.url);
}
/** One render against the https provider, answered entirely by a stub. */
function renderRemote(descriptor: ProviderDescriptor, impl: typeof fetch): Promise<Render> {
  return render({
    descriptor,
    voiceId: "v",
    text: TEXT,
    cacheDir: cacheDir(),
    allowedHosts: ALLOWED,
    fetchImpl: impl,
    env: ENV,
  });
}

/** Hand back whatever a render threw, so the evidence can be asserted first. */
async function outcomeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

function assertRefused(outcome: unknown, expected: RegExp): void {
  assert.ok(
    outcome instanceof ConfigError,
    `expected a ConfigError from the trust policy, got ${String(outcome)}`,
  );
  assert.match(outcome.message, expected);
}
describe("a redirect on the request that carries the credential", () => {
  it("refuses a cross-origin hop and the target sees no request at all", async () => {
    const hopTwo = await startFakeProvider({ expectKey: KEY, authHeader: AUTH_HEADER });
    const hopOne = await startFakeProvider({
      expectKey: KEY,
      authHeader: AUTH_HEADER,
      redirectTo: `${hopTwo.url}/speak`,
    });
    const cache = cacheDir();
    try {
      const outcome = await outcomeOf(
        render({
          descriptor: descriptorFor(`${hopOne.url}/redirect`),
          voiceId: "v",
          text: TEXT,
          cacheDir: cache,
          allowedHosts: [],
          env: ENV,
        }),
      );
      assert.deepEqual(hopTwo.seen, [], "the redirect target was never contacted");
      assert.equal(readdirSync(cache).length, 0, "no audio was written");
      assert.equal(hopOne.seen.length, 1, "hop one is the host the operator named");
      assert.equal(hopOne.seen.at(0)?.auth, KEY);
      assertRefused(outcome, /redirected to hop 1/);
      assertRefused(outcome, /LOCAL_FAKE_KEY was not sent to that host/);
    } finally {
      await hopOne.close();
      await hopTwo.close();
    }
  });
  // Passes with or without the hop policy, on purpose. The fix could have
  // refused every redirect instead. A provider that moves a path on its own
  // origin has to keep working.
  it("follows a same-origin 307 and re-attaches the credential with the body", async () => {
    const fake = await startFakeProvider({
      expectKey: KEY,
      authHeader: AUTH_HEADER,
      redirectTo: "/speak",
      redirectStatus: 307,
    });
    try {
      const out = await render({
        descriptor: descriptorFor(`${fake.url}/redirect`),
        voiceId: "v",
        text: TEXT,
        cacheDir: cacheDir(),
        allowedHosts: [],
        env: ENV,
      });
      assert.ok(out.bytes > 44, "a WAV header alone would be 44 bytes");
      assert.deepEqual(
        fake.seen.map((seen) => `${seen.method} ${seen.path}`),
        ["POST /redirect", "POST /speak"],
      );
      assert.deepEqual(
        fake.seen.map((seen) => seen.auth),
        [KEY, KEY],
      );
      assert.ok(fake.seen.at(-1)?.body.includes("Hear this"), "307 keeps the body");
    } finally {
      await fake.close();
    }
  });

  it("refuses a hop to a remote host the operator never named", async () => {
    const stub = stubFetch((url) =>
      url === REMOTE ? movedTo("https://relay.evil.example/speak") : bytesResponse(wavOfSeconds(1)),
    );
    const outcome = await outcomeOf(renderRemote(descriptorFor(REMOTE), stub.impl));
    assert.deepEqual(urlsOf(stub.calls), [REMOTE], "only the endpoint was requested");
    assertRefused(outcome, /relay\.evil\.example is not an allowed host/);
  });
  it("follows a hop to an allowed host and rebuilds the credential there", async () => {
    const moved = "https://alt.acme.example/v1/tts";
    const stub = stubFetch((url) =>
      url === REMOTE ? movedTo(moved, 307) : bytesResponse(wavOfSeconds(1)),
    );
    const out = await renderRemote(descriptorFor(REMOTE), stub.impl);
    assert.deepEqual(urlsOf(stub.calls), [REMOTE, moved]);
    assert.equal(stub.calls.at(-1)?.method, "POST", "a 307 keeps the method");
    assert.equal(stub.calls.at(-1)?.headers[AUTH_HEADER], KEY, "rebuilt for the approved host");
    assert.ok(out.bytes > 44);
  });

  it("stops at the hop cap rather than following a loop", async () => {
    const fake = await startFakeProvider({
      expectKey: KEY,
      authHeader: AUTH_HEADER,
      redirectTo: "/redirect",
    });
    try {
      const outcome = await outcomeOf(
        render({
          descriptor: descriptorFor(`${fake.url}/redirect`),
          voiceId: "v",
          text: TEXT,
          cacheDir: cacheDir(),
          allowedHosts: [],
          env: ENV,
        }),
      );
      assert.equal(fake.seen.length, 4, "one request plus three hops");
      assert.ok(
        outcome instanceof ProviderError,
        `expected a ProviderError, got ${String(outcome)}`,
      );
      assert.match(outcome.message, /redirected more than 3 times/);
    } finally {
      await fake.close();
    }
  });
});
describe("the audio URL a provider returns", () => {
  it("refuses a URL on this machine and the internal service sees nothing", async () => {
    const recorder = await startRecorder();
    const fake = await startFakeProvider({
      expectKey: KEY,
      authHeader: AUTH_HEADER,
      audioUrl: `${recorder.url}/latest/meta-data/iam`,
    });
    const cache = cacheDir();
    try {
      const outcome = await outcomeOf(
        render({
          descriptor: urlFieldDescriptor(`${fake.url}/speak-url`),
          voiceId: "v",
          text: TEXT,
          cacheDir: cache,
          allowedHosts: [],
          env: ENV,
        }),
      );
      assert.deepEqual(recorder.paths, [], "the loopback service was never fetched");
      assert.equal(readdirSync(cache).length, 0, "no file was written");
      assertRefused(outcome, /is on this machine/);
    } finally {
      await fake.close();
      await recorder.close();
    }
  });

  it("refuses a URL that is not https", async () => {
    const stub = stubFetch((url) =>
      url === REMOTE ? audioAt(`http://${CDN}/render.wav`) : bytesResponse(wavOfSeconds(1)),
    );
    const outcome = await outcomeOf(renderRemote(urlFieldDescriptor(REMOTE), stub.impl));
    assert.deepEqual(urlsOf(stub.calls), [REMOTE], "the http link was never fetched");
    assertRefused(outcome, /would fetch from cdn\.acme\.example unencrypted/);
  });
  it("refuses a literal address in loopback, link-local or private space", async () => {
    const cases: ReadonlyArray<readonly [string, RegExp]> = [
      ["https://169.254.169.254/latest/meta-data/iam", /169\.254\.0\.0\/16/],
      ["https://10.0.0.7/render.wav", /10\.0\.0\.0\/8/],
      ["https://172.16.4.9/render.wav", /172\.16\.0\.0\/12/],
      ["https://192.168.1.10/render.wav", /192\.168\.0\.0\/16/],
      ["https://0.0.0.0/render.wav", /0\.0\.0\.0\/8/],
      ["https://127.0.0.1/render.wav", /is on this machine/],
      ["https://[::1]/render.wav", /is on this machine/],
    ];
    for (const [link, expected] of cases) {
      const stub = stubFetch((url) =>
        url === REMOTE ? audioAt(link) : bytesResponse(wavOfSeconds(1)),
      );
      const outcome = await outcomeOf(renderRemote(urlFieldDescriptor(REMOTE), stub.impl));
      assert.deepEqual(urlsOf(stub.calls), [REMOTE], `${link} was fetched`);
      assertRefused(outcome, expected);
    }
  });

  it("refuses a URL carrying credentials in the URL itself", async () => {
    const link = `https://someone:secret-value@${CDN}/render.wav`;
    const stub = stubFetch((url) => (url === REMOTE ? audioAt(link) : bytesResponse(wavOfSeconds(1))));
    const outcome = await outcomeOf(renderRemote(urlFieldDescriptor(REMOTE), stub.impl));
    assert.deepEqual(urlsOf(stub.calls), [REMOTE], "the link was never fetched");
    assertRefused(outcome, /carries credentials in the URL itself/);
  });

  it("refuses a URL on a host the operator never named", async () => {
    const stub = stubFetch((url) =>
      url === REMOTE ? audioAt("https://cdn.evil.example/render.wav") : bytesResponse(wavOfSeconds(1)),
    );
    const outcome = await outcomeOf(renderRemote(urlFieldDescriptor(REMOTE), stub.impl));
    assert.deepEqual(urlsOf(stub.calls), [REMOTE], "the link was never fetched");
    assertRefused(outcome, /cdn\.evil\.example is not an allowed host/);
  });
  // The other working path. It passes before the fix too. A link on a host the
  // operator allowed is still fetched, without the credential, because the
  // descriptor's key belongs to the endpoint.
  it("fetches a URL on an allowed https host, without the credential", async () => {
    const link = `https://${CDN}/render.wav`;
    const wav = wavOfSeconds(2);
    const stub = stubFetch((url) => (url === REMOTE ? audioAt(link) : bytesResponse(wav)));
    const out = await renderRemote(urlFieldDescriptor(REMOTE), stub.impl);
    assert.deepEqual(urlsOf(stub.calls), [REMOTE, link]);
    assert.equal(stub.calls.at(-1)?.headers[AUTH_HEADER], undefined, "no credential on the link");
    assert.equal(out.bytes, wav.length);
    assert.equal(readFileSync(out.path).toString("ascii", 0, 4), "RIFF");
  });

  it("checks a redirect on the audio link with the same policy", async () => {
    const link = `https://${CDN}/render.wav`;
    const stub = stubFetch((url) => {
      if (url === REMOTE) return audioAt(link);
      if (url === link) return movedTo("http://127.0.0.1:9/render.wav");
      return bytesResponse(wavOfSeconds(1));
    });
    const outcome = await outcomeOf(renderRemote(urlFieldDescriptor(REMOTE), stub.impl));
    assert.deepEqual(urlsOf(stub.calls), [REMOTE, link], "the hop was never requested");
    assertRefused(outcome, /is on this machine/);
  });
});
