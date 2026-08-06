/**
 * Load and validate the two input documents.
 *
 * Both are operator input, so both are checked before anything is sent. The one
 * check worth reading twice is `assertNoInlineSecret`: a descriptor names the
 * environment variable holding a credential and must never carry the credential
 * itself, in any field, because a descriptor is the file people commit and paste
 * to each other. It runs before every other check in `loadDescriptor` and again
 * in `render`, so the field a key was pasted into decides nothing.
 */

import { readFileSync } from "node:fs";
import { ConfigError, type AudioLocation, type ProviderDescriptor, type Script } from "./types.js";

const FORMATS = new Set(["mp3", "wav", "ogg", "pcm"]);
const ENV_NAME = /^[A-Z][A-Z0-9_]{2,63}$/;
const SLUG = /^[a-z][a-z0-9-]{1,31}$/;
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
/** RFC 7230 field-name token, capped, so a header name is a header name. */
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
/**
 * An auth scheme name is one token. `AWS4-HMAC-SHA256` is the longest in real
 * use at 16 characters, so 16 plus an optional trailing space is the whole field.
 */
const AUTH_PREFIX = /^[A-Za-z][A-Za-z0-9!#$%&'*+.^_`|~-]{0,15} ?$/;

/** Every field this app reads. An unknown one is refused, not ignored. */
const KNOWN_FIELDS = [
  "name",
  "endpoint",
  "method",
  "authHeader",
  "authPrefix",
  "authEnv",
  "headers",
  "bodyTemplate",
  "audio",
  "format",
  "maxChars",
  "languages",
] as const;

/**
 * The two shapes a credential is written in. Blunt on purpose.
 *
 * A dense run of 20 characters with no separator covers the usual key. A run of
 * 24 counting `_` and `-` covers one written in groups, including a UUID. The
 * second threshold is 24 rather than 20 because the shipped ElevenLabs body
 * template carries `eleven_multilingual_v2`, which is 22 characters of exactly
 * that alphabet and is a model name rather than a key. Nothing this app needs in
 * a URL or a header is longer than that.
 */
const UNBROKEN_TOKEN = /[A-Za-z0-9]{20,}/;
const SEPARATED_TOKEN = /[A-Za-z0-9_-]{24,}/;

/** Keep an operator-supplied value short in a refusal, so a key is not echoed. */
function short(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}...` : value;
}

function keyShaped(value: string): string | null {
  const found = UNBROKEN_TOKEN.exec(value) ?? SEPARATED_TOKEN.exec(value);
  return found === null ? null : found[0];
}

function refuseKeyShaped(where: string, token: string): never {
  throw new ConfigError(
    `${where} carries a ${token.length} character opaque token, which is what a credential looks like. A credential lives in the environment variable named by authEnv and travels in the header named by authHeader. It has no other home in this file. Nothing was sent.`,
  );
}

/** Refuse key material in one string field. Non-strings are the loader's problem. */
function assertNoKeyShapedValue(value: unknown, where: string): void {
  if (typeof value !== "string") return;
  const token = keyShaped(value);
  if (token !== null) refuseKeyShaped(where, token);
}

/**
 * The endpoint, decomposed, because a URL has more than one place to hide a key.
 *
 * Userinfo is refused outright: `https://user:key@host/` is an inline credential
 * whatever it is called. The path, the query and the fragment are scanned
 * separately so the refusal names the part. The host is not scanned, because a
 * long hostname made of ordinary words is legitimate and it is the one part the
 * allowlist already governs.
 */
function assertEndpointCarriesNoKey(value: unknown): void {
  if (typeof value !== "string") return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Not parseable, so there are no parts to name. Scan it whole and let
    // `assertTrustedEndpoint` be the one that refuses the shape.
    assertNoKeyShapedValue(value, "descriptor.endpoint");
    return;
  }
  if (url.username !== "" || url.password !== "") {
    throw new ConfigError(
      "descriptor.endpoint carries credentials in the URL itself, before the host. A credential lives in the environment variable named by authEnv and travels in the header named by authHeader. Nothing was sent.",
    );
  }
  assertNoKeyShapedValue(url.pathname, "The path in descriptor.endpoint");
  assertNoKeyShapedValue(url.search, "The query string in descriptor.endpoint");
  assertNoKeyShapedValue(url.hash, "The fragment in descriptor.endpoint");
}

/**
 * Refuse a descriptor that carries a credential anywhere, not just in a header.
 *
 * This runs at load time, before anything is built or sent. It runs again in
 * `render` because a descriptor built in code never passes the loader. Review
 * found the earlier version too narrow: it checked `authEnv` and static header
 * values, so long key material in `authPrefix` and in an endpoint query
 * parameter was accepted and sent. The rule now covers every field. The field
 * set itself is closed, so "every field" is a list rather than a hope.
 *
 * | Field | Where its string goes | Guard |
 * | --- | --- | --- |
 * | `name` | a cache file name | slug grammar, 2 to 32 lowercase characters. Not scanned: a hyphenated product name runs past the threshold legitimately. This string reaches no URL and no header |
 * | `endpoint` | the whole request URL | parsed: no userinfo, then path, query and fragment scanned |
 * | `method` | nothing | `POST` or `GET` |
 * | `authHeader` | a header name | header-name token, at most 64, then scanned |
 * | `authPrefix` | in front of the credential in that header | auth scheme grammar, at most 16 plus one space, then scanned |
 * | `authEnv` | an environment lookup, never the wire | variable-name grammar. Not scanned: `ELEVENLABS_MULTILINGUAL_KEY` is a fine variable name and the value never leaves the process |
 * | `headers` | header names and values | both sides: token grammar on the name, scan on both |
 * | `bodyTemplate` | the request body | scanned |
 * | `audio.path` | JSON keys in the response | scanned, though it reaches no URL and no header |
 * | `format`, `maxChars` | a file extension, a number | fixed set, positive number |
 * | `languages` | compared against the recipient locale | language-tag grammar, then scanned |
 *
 * A false positive costs one rename. A false negative commits somebody's key.
 */
export function assertNoInlineSecret(raw: Record<string, unknown>): void {
  const known = new Set<string>(KNOWN_FIELDS);
  for (const field of Object.keys(raw)) {
    if (!known.has(field)) {
      throw new ConfigError(
        `descriptor.${field} is not a field this app reads. An unknown field is refused rather than ignored, because a credential pasted into one would still be committed with the file and a misspelt real field would be dropped in silence. The fields are ${KNOWN_FIELDS.join(", ")}.`,
      );
    }
  }

  const authEnv = raw["authEnv"];
  if (typeof authEnv === "string" && !ENV_NAME.test(authEnv)) {
    throw new ConfigError(
      `authEnv is "${short(authEnv)}", which is not shaped like an environment variable name. It names the variable holding the credential, it never holds the credential. Nothing was sent.`,
    );
  }

  assertEndpointCarriesNoKey(raw["endpoint"]);

  const authHeader = raw["authHeader"];
  if (typeof authHeader === "string") {
    assertNoKeyShapedValue(authHeader, "descriptor.authHeader");
    if (!HEADER_NAME.test(authHeader)) {
      throw new ConfigError(
        `descriptor.authHeader "${short(authHeader)}" is not an HTTP header name. It names the header the credential travels in, for example xi-api-key. Nothing was sent.`,
      );
    }
  }

  const authPrefix = raw["authPrefix"];
  if (authPrefix !== undefined) {
    if (typeof authPrefix !== "string") {
      throw new ConfigError("descriptor.authPrefix must be a string, for example \"Bearer \".");
    }
    assertNoKeyShapedValue(authPrefix, "descriptor.authPrefix");
    if (!AUTH_PREFIX.test(authPrefix)) {
      throw new ConfigError(
        `descriptor.authPrefix "${short(authPrefix)}" is not an auth scheme name. It is the word in front of the credential, such as "Bearer ", so it is one token of at most 16 characters plus an optional trailing space. The credential itself comes from authEnv. Nothing was sent.`,
      );
    }
  }

  const headers = raw["headers"];
  if (headers !== undefined) {
    if (headers === null || typeof headers !== "object" || Array.isArray(headers)) {
      throw new ConfigError("headers must be an object of static header values.");
    }
    for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
      assertNoKeyShapedValue(name, "A field name in descriptor.headers");
      if (!HEADER_NAME.test(name)) {
        throw new ConfigError(
          `headers has a field name "${short(name)}" that is not an HTTP header name. Nothing was sent.`,
        );
      }
      if (typeof value !== "string") {
        throw new ConfigError(`headers.${name} must be a string.`);
      }
      assertNoKeyShapedValue(value, `headers.${name}`);
    }
  }

  assertNoKeyShapedValue(raw["bodyTemplate"], "descriptor.bodyTemplate");

  const audio = raw["audio"];
  if (audio !== null && typeof audio === "object" && !Array.isArray(audio)) {
    const path = (audio as Record<string, unknown>)["path"];
    if (Array.isArray(path)) {
      path.forEach((entry, index) => assertNoKeyShapedValue(entry, `descriptor.audio.path[${index}]`));
    }
  }

  const languages = raw["languages"];
  if (Array.isArray(languages)) {
    languages.forEach((tag, index) => assertNoKeyShapedValue(tag, `descriptor.languages[${index}]`));
  }
}

function readJson(path: string, label: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new ConfigError(`Cannot read the ${label} at ${path}: ${(error as Error).message}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(`The ${label} at ${path} is not valid JSON: ${(error as Error).message}`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(`The ${label} at ${path} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function str(raw: Record<string, unknown>, key: string, label: string): string {
  const value = raw[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigError(`${label}.${key} must be a non-empty string.`);
  }
  return value;
}

function posInt(raw: Record<string, unknown>, key: string, label: string): number {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${label}.${key} must be a positive number.`);
  }
  return value;
}

function audioLocation(raw: Record<string, unknown>): AudioLocation {
  const audio = raw["audio"];
  if (audio === null || typeof audio !== "object" || Array.isArray(audio)) {
    throw new ConfigError("audio must be an object saying where the audio bytes are.");
  }
  const a = audio as Record<string, unknown>;
  const kind = a["kind"];
  if (kind === "body") return { kind: "body" };
  if (kind !== "base64Field" && kind !== "urlField") {
    throw new ConfigError('audio.kind must be "body", "base64Field" or "urlField".');
  }
  const path = a["path"];
  if (!Array.isArray(path) || path.length === 0 || path.some((p) => typeof p !== "string")) {
    throw new ConfigError(`audio.path must be a non-empty array of strings for kind ${kind}.`);
  }
  return { kind, path: path as string[] };
}

export function loadDescriptor(path: string): ProviderDescriptor {
  const raw = readJson(path, "provider descriptor");
  assertNoInlineSecret(raw);

  const name = str(raw, "name", "descriptor");
  if (!SLUG.test(name)) {
    throw new ConfigError(
      `descriptor.name "${name}" must be a lowercase slug, because it is used in cache file names.`,
    );
  }
  const method = raw["method"];
  if (method !== "POST" && method !== "GET") {
    throw new ConfigError('descriptor.method must be "POST" or "GET".');
  }
  const format = str(raw, "format", "descriptor");
  if (!FORMATS.has(format)) {
    throw new ConfigError(`descriptor.format must be one of ${[...FORMATS].join(", ")}.`);
  }
  const languages = raw["languages"];
  if (!Array.isArray(languages) || languages.length === 0) {
    throw new ConfigError("descriptor.languages must list at least one BCP-47 tag this voice speaks.");
  }
  for (const tag of languages) {
    if (typeof tag !== "string" || !LOCALE.test(tag)) {
      throw new ConfigError(`descriptor.languages carries ${JSON.stringify(tag)}, which is not a language tag.`);
    }
  }
  const descriptor: ProviderDescriptor = {
    name,
    endpoint: str(raw, "endpoint", "descriptor"),
    method,
    authHeader: str(raw, "authHeader", "descriptor"),
    authEnv: str(raw, "authEnv", "descriptor"),
    audio: audioLocation(raw),
    format: format as ProviderDescriptor["format"],
    maxChars: posInt(raw, "maxChars", "descriptor"),
    languages: languages as string[],
  };
  if (typeof raw["authPrefix"] === "string") descriptor.authPrefix = raw["authPrefix"];
  if (raw["headers"] !== undefined) {
    descriptor.headers = raw["headers"] as Record<string, string>;
  }
  if (typeof raw["bodyTemplate"] === "string") descriptor.bodyTemplate = raw["bodyTemplate"];
  if (descriptor.method === "POST" && descriptor.bodyTemplate === undefined) {
    throw new ConfigError("descriptor.bodyTemplate is required when method is POST.");
  }
  return descriptor;
}

export function loadScript(path: string): Script {
  const raw = readJson(path, "script");
  const locale = str(raw, "locale", "script");
  if (!LOCALE.test(locale)) {
    throw new ConfigError(`script.locale "${locale}" is not a BCP-47 language tag.`);
  }
  const locked = raw["locked"] ?? [];
  if (!Array.isArray(locked)) {
    throw new ConfigError("script.locked must be an array of lines that must survive verbatim.");
  }
  const lines = locked.map((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ConfigError(`script.locked[${index}] must be an object with text and reason.`);
    }
    const e = entry as Record<string, unknown>;
    return {
      text: str(e, "text", `script.locked[${index}]`),
      reason: str(e, "reason", `script.locked[${index}]`),
    };
  });
  return {
    id: str(raw, "id", "script"),
    task: str(raw, "task", "script"),
    locale,
    voiceId: str(raw, "voiceId", "script"),
    maxSpokenSeconds: posInt(raw, "maxSpokenSeconds", "script"),
    locked: lines,
  };
}
