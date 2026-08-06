/**
 * One HTTP client that drives any text-to-speech API from a descriptor.
 *
 * Nothing here knows a vendor name. A descriptor supplies the endpoint, the
 * auth header, the body template and where the audio sits in the response, so
 * adding a provider is a JSON file rather than a code change.
 *
 * Renders are cached under a digest of provider, voice and text. An unchanged
 * script is never paid for twice. An edited one is always re-read, which is
 * the same rule the video kit has used across nine builds.
 */

import { createHash } from "node:crypto";
import { mkdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertTrustedEndpoint } from "./hosts.js";
import { ProviderError, type ProviderDescriptor, type Render } from "./types.js";

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
  const url = assertTrustedEndpoint(endpoint, options.allowedHosts, descriptor.authEnv);

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

  const headers: Record<string, string> = { ...(descriptor.headers ?? {}) };
  headers[descriptor.authHeader] = `${descriptor.authPrefix ?? ""}${secret}`;
  let body: string | undefined;
  if (descriptor.method === "POST") {
    if (descriptor.bodyTemplate === undefined) {
      throw new ProviderError(
        `${descriptor.name} is declared POST with no bodyTemplate, so there is nothing to send.`,
      );
    }
    body = fill(descriptor.bodyTemplate, text, voiceId, true);
    headers["content-type"] = headers["content-type"] ?? "application/json";
  }

  const response = await doFetch(url, { method: descriptor.method, headers, body });
  if (!response.ok) {
    throw new ProviderError(
      `${descriptor.name} answered ${response.status} for voice ${voiceId}. No audio was written.`,
    );
  }

  const bytes = await audioBytes(descriptor, response, doFetch);
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

async function audioBytes(
  descriptor: ProviderDescriptor,
  response: Response,
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
  const followed = await doFetch(found);
  if (!followed.ok) {
    throw new ProviderError(
      `${descriptor.name} returned an audio URL that answered ${followed.status}.`,
    );
  }
  return Buffer.from(await followed.arrayBuffer());
}
