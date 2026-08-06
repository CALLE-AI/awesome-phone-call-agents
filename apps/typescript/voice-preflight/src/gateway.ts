/**
 * One HTTP client that drives any text-to-speech API from a descriptor.
 *
 * Nothing here knows a vendor name. A descriptor supplies the endpoint, the
 * auth header, the body template and where the audio sits in the response, so
 * adding a provider is a JSON file rather than a code change.
 *
 * Two things a descriptor cannot be trusted about, because a provider answers
 * at runtime: where a redirect points and where an audio URL points. Both go
 * through the same policy as the endpoint before any request is built. See
 * `sendChecked` for the redirect rule and `audioBytes` for the URL one.
 *
 * Renders are cached under a digest of provider, voice and text. An unchanged
 * script is never paid for twice. An edited one is always re-read, which is
 * the same rule the video kit has used across nine builds.
 */

import { createHash } from "node:crypto";
import { mkdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertTrustedEndpoint, assertTrustedUrl } from "./hosts.js";
import { ProviderError, type ProviderDescriptor, type Render } from "./types.js";

/** Redirects this app follows itself. A provider normalises a host, not four. */
const MAX_HOPS = 3;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/** Placeholders a descriptor may use in its endpoint and body template. */
function fill(template: string, text: string, voice: string, jsonEscape: boolean): string {
  const t = jsonEscape ? JSON.stringify(text).slice(1, -1) : encodeURIComponent(text);
  const v = jsonEscape ? JSON.stringify(voice).slice(1, -1) : encodeURIComponent(voice);
  return template.replaceAll("{text}", t).replaceAll("{voice}", v);
}

function dig(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function renderDigest(descriptor: ProviderDescriptor, voiceId: string, text: string): string {
  return createHash("sha256")
    .update(`${descriptor.name}|${voiceId}|${text}`)
    .digest("hex")
    .slice(0, 12);
}

export interface RenderOptions {
  descriptor: ProviderDescriptor;
  voiceId: string;
  text: string;
  cacheDir: string;
  allowedHosts: Iterable<string>;
  /** Injected in tests so no network is needed. */
  fetchImpl?: typeof fetch;
  /** Injected so a test never needs a real environment variable. */
  env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Everything one render is allowed to reach. Built once from the endpoint, so
 * the endpoint rule and the audio URL rule cannot drift apart.
 */
interface Trust {
  providerName: string;
  /** Materialised once, because it is now read for every hop. */
  allowedHosts: readonly string[];
  authEnv: string;
}

/** One request, with headers rebuilt per hop rather than carried across one. */
interface Send {
  url: URL;
  method: "GET" | "POST";
  headers: () => Record<string, string>;
  body?: string;
  /** Names this request inside a refusal, for example "The endpoint". */
  what: string;
  carriesCredential: boolean;
  /** Sentence saying what did not travel. It has to be true for this request. */
  note: string;
}

/** Let go of a redirect response so its connection is not held open. */
async function release(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already released. Nothing to do.
  }
}

/**
 * Send a request and follow redirects by hand, checking every hop.
 *
 * Two approaches were open here. Refusing redirects outright with
 * `redirect: "manual"` and no follow is safe, but it breaks a provider that
 * normalises a host or moves a path, which an operator cannot fix from a
 * descriptor. So this takes the second one the review named: manual redirects
 * plus an explicit hop policy. Each `Location` goes through the same
 * `assertTrustedUrl` as the endpoint. The headers are rebuilt for the hop only
 * after it passes, so the credential reaches allowed hosts only. A hop that
 * stays on the origin this request started from is the same destination, so it
 * passes. A hop anywhere else has to be https on an allowed host, which means a
 * loopback fake cannot redirect the key to a second local port either.
 *
 * What it must not do is leave `redirect: "follow"` in place. Node strips
 * `Authorization` on a cross-origin hop but keeps every other header. This app
 * lets a descriptor name the header its credential travels in (`xi-api-key`
 * for one shipped example), so the default hands that key to whatever host a
 * `Location` names.
 */
async function sendChecked(send: Send, trust: Trust, doFetch: typeof fetch): Promise<Response> {
  const origin = send.url;
  let url = send.url;
  let method = send.method;
  let body = send.body;

  for (let hop = 0; ; hop += 1) {
    const headers = send.headers();
    if (body === undefined) delete headers["content-type"];
    const response = await doFetch(url, { method, headers, body, redirect: "manual" });
    if (!REDIRECT_STATUS.has(response.status)) return response;

    const location = response.headers.get("location");
    await release(response);
    if (location === null || location.trim().length === 0) {
      throw new ProviderError(
        `${trust.providerName} answered ${response.status} with no Location header, so there is nowhere to follow.`,
      );
    }
    if (hop >= MAX_HOPS) {
      throw new ProviderError(
        `${trust.providerName} redirected more than ${MAX_HOPS} times. Nothing further was requested.`,
      );
    }
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      throw new ProviderError(
        `${trust.providerName} answered ${response.status} with a Location this app cannot parse.`,
      );
    }
    url = assertTrustedUrl(next.href, {
      allowedHosts: trust.allowedHosts,
      allowLoopback: false,
      sameOriginAs: origin,
      authEnv: trust.authEnv,
      what: `${send.what} redirected to hop ${hop + 1}`,
      carriesCredential: send.carriesCredential,
      note: send.note,
    });
    // What fetch itself does with a body on these three, kept so a provider sees
    // the request it expects.
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
    }
  }
}

/**
 * Render text to an audio file and return what was measured about it.
 *
 * Order matters. The character limit and the endpoint check both run before the
 * credential is read, so a script that cannot be sent never reads a secret and
 * a bad endpoint never receives one.
 */
export async function render(options: RenderOptions): Promise<Render> {
  const { descriptor, voiceId, text, cacheDir } = options;
  const env = options.env ?? process.env;
  const doFetch = options.fetchImpl ?? fetch;

  if (text.length > descriptor.maxChars) {
    throw new ProviderError(
      `The script is ${text.length} characters and ${descriptor.name} accepts ${descriptor.maxChars} in one request. Nothing was sent and no credential was read.`,
    );
  }

  const endpoint = fill(descriptor.endpoint, text, voiceId, false);
  const allowedHosts = [...options.allowedHosts];
  const url = assertTrustedEndpoint(endpoint, allowedHosts, descriptor.authEnv);

  const digest = renderDigest(descriptor, voiceId, text);
  const target = join(cacheDir, `${descriptor.name}-${digest}.${descriptor.format}`);
  if (existsSync(target)) {
    return {
      provider: descriptor.name,
      voiceId,
      bytes: statSync(target).size,
      seconds: null,
      path: target,
      cached: true,
    };
  }

  const secret = env[descriptor.authEnv];
  if (secret === undefined || secret.length === 0) {
    throw new ProviderError(
      `${descriptor.authEnv} is not set, so ${descriptor.name} cannot be called. The descriptor names the variable and never holds the value.`,
    );
  }

  const trust: Trust = {
    providerName: descriptor.name,
    allowedHosts,
    authEnv: descriptor.authEnv,
  };
  // Rebuilt for every hop, so a header is only ever attached to a URL that has
  // just passed the policy.
  const headers = (): Record<string, string> => {
    const built: Record<string, string> = { ...(descriptor.headers ?? {}) };
    built[descriptor.authHeader] = `${descriptor.authPrefix ?? ""}${secret}`;
    if (descriptor.method === "POST") {
      built["content-type"] = built["content-type"] ?? "application/json";
    }
    return built;
  };

  let body: string | undefined;
  if (descriptor.method === "POST") {
    if (descriptor.bodyTemplate === undefined) {
      throw new ProviderError(
        `${descriptor.name} is declared POST with no bodyTemplate, so there is nothing to send.`,
      );
    }
    body = fill(descriptor.bodyTemplate, text, voiceId, true);
  }

  const response = await sendChecked(
    {
      url,
      method: descriptor.method,
      headers,
      body,
      what: "The endpoint",
      carriesCredential: true,
      note: `${descriptor.authEnv} was not sent to that host.`,
    },
    trust,
    doFetch,
  );
  if (!response.ok) {
    throw new ProviderError(
      `${descriptor.name} answered ${response.status} for voice ${voiceId}. No audio was written.`,
    );
  }

  const bytes = await audioBytes(descriptor, response, trust, doFetch);
  if (bytes.length === 0) {
    throw new ProviderError(
      `${descriptor.name} answered ${response.status} with no audio bytes at the declared location.`,
    );
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes, { mode: 0o600 });
  return {
    provider: descriptor.name,
    voiceId,
    bytes: bytes.length,
    seconds: null,
    path: target,
    cached: false,
  };
}

/**
 * Get the audio bytes out of a response, wherever the descriptor says they are.
 *
 * `urlField` is the one that leaves this app's own trust boundary, because the
 * URL comes out of a provider response rather than from the operator. It gets
 * the strictest form of the same policy: https, a host on the allowlist, no
 * literal address in private or link-local space and no loopback at all. That
 * last one is stricter than the endpoint rule on purpose. The operator may point
 * the endpoint at a local fake, a provider may not point this app at anything on
 * the machine it runs on. The fetch carries no credential either.
 */
async function audioBytes(
  descriptor: ProviderDescriptor,
  response: Response,
  trust: Trust,
  doFetch: typeof fetch,
): Promise<Buffer> {
  const where = descriptor.audio;
  if (where.kind === "body") {
    return Buffer.from(await response.arrayBuffer());
  }
  const payload: unknown = await response.json();
  const found = dig(payload, where.path);
  if (typeof found !== "string" || found.length === 0) {
    throw new ProviderError(
      `${descriptor.name} answered without a string at ${where.path.join(".")}, which is where its descriptor says the audio is.`,
    );
  }
  if (where.kind === "base64Field") {
    return Buffer.from(found, "base64");
  }

  const what = `The audio URL ${descriptor.name} returned`;
  const note = `${trust.authEnv} was not sent to that host and no audio was written.`;
  const url = assertTrustedUrl(found, {
    allowedHosts: trust.allowedHosts,
    allowLoopback: false,
    authEnv: trust.authEnv,
    what,
    carriesCredential: false,
    note,
  });
  const followed = await sendChecked(
    { url, method: "GET", headers: () => ({}), what, carriesCredential: false, note },
    trust,
    doFetch,
  );
  if (!followed.ok) {
    throw new ProviderError(
      `${descriptor.name} returned an audio URL that answered ${followed.status}.`,
    );
  }
  return Buffer.from(await followed.arrayBuffer());
}


