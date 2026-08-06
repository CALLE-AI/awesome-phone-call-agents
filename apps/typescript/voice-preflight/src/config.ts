/**
 * Load and validate the two input documents.
 *
 * Both are operator input, so both are checked before anything is sent. The one
 * check worth reading twice is `assertNoInlineSecret`: a descriptor names the
 * environment variable holding a credential and must never carry the credential
 * itself, because a descriptor is the file people commit and paste to each other.
 */

import { readFileSync } from "node:fs";
import { ConfigError, type AudioLocation, type ProviderDescriptor, type Script } from "./types.js";

const FORMATS = new Set(["mp3", "wav", "ogg", "pcm"]);
const ENV_NAME = /^[A-Z][A-Z0-9_]{2,63}$/;
const SLUG = /^[a-z][a-z0-9-]{1,31}$/;
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

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

/**
 * Refuse anything that looks like a credential sitting in the descriptor.
 *
 * Deliberately blunt: a long run of key-shaped characters in a static header, or
 * an `authEnv` that is not shaped like an environment variable name. A false
 * positive costs one rename. A false negative commits somebody's key.
 */
export function assertNoInlineSecret(raw: Record<string, unknown>): void {
  const authEnv = raw["authEnv"];
  if (typeof authEnv === "string" && !ENV_NAME.test(authEnv)) {
    throw new ConfigError(
      `authEnv is "${authEnv.slice(0, 12)}...", which is not shaped like an environment variable name. It names the variable holding the credential, it never holds the credential. Nothing was sent.`,
    );
  }
  const headers = raw["headers"];
  if (headers !== undefined) {
    if (headers === null || typeof headers !== "object" || Array.isArray(headers)) {
      throw new ConfigError("headers must be an object of static header values.");
    }
    for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
      if (typeof value !== "string") {
        throw new ConfigError(`headers.${name} must be a string.`);
      }
      if (/[A-Za-z0-9_-]{24,}/.test(value)) {
        throw new ConfigError(
          `headers.${name} carries a long opaque value, which is what a credential looks like. Move it to an environment variable and name that variable in authEnv. Nothing was sent.`,
        );
      }
    }
  }
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
