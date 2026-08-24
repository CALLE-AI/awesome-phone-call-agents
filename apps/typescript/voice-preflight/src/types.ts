/**
 * Types for the voice preflight.
 *
 * Two documents drive everything. A provider descriptor says how to call one
 * text-to-speech HTTP API. A script says what CALL-E will speak plus which
 * parts of it must survive being spoken. Neither ever holds a credential: the
 * descriptor names an environment variable and the value is read at call time.
 */

/** Where the audio bytes live in a provider's response. */
export type AudioLocation =
  | { kind: "body" }
  | { kind: "base64Field"; path: readonly string[] }
  | { kind: "urlField"; path: readonly string[] };

/** One text-to-speech HTTP API, described rather than coded against. */
export interface ProviderDescriptor {
  /** Short slug used in output and in cache file names. */
  name: string;
  /** Full endpoint URL. `{voice}` is substituted from the script's voice id. */
  endpoint: string;
  method: "POST" | "GET";
  /** Header carrying the credential, for example `xi-api-key` or `Authorization`. */
  authHeader: string;
  /** One auth scheme name, for example `Bearer `. Kept separate so the env var holds only the key. */
  authPrefix?: string;
  /** Name of the environment variable holding the credential. Never the credential. */
  authEnv: string;
  /** Extra static headers. Names and values are both checked for key material. */
  headers?: Readonly<Record<string, string>>;
  /** JSON body template. `{text}` and `{voice}` are substituted. Omit for GET. */
  bodyTemplate?: string;
  /** How to get audio bytes out of the response. */
  audio: AudioLocation;
  /** Container the provider returns, used only to name the cache file. */
  format: "mp3" | "wav" | "ogg" | "pcm";
  /** Longest text this provider accepts in one request, in characters. */
  maxChars: number;
  /** BCP-47 language tags this voice can speak. Checked against the recipient locale. */
  languages: readonly string[];
}

/** A line that has to reach the callee unchanged, plus why it matters. */
export interface LockedLine {
  /** Exact substring that must appear in the spoken script. */
  text: string;
  /** Why it is locked, quoted back in the failure so the reason travels with it. */
  reason: string;
}

/** What CALL-E would be asked to say, plus the claims we check against it. */
export interface Script {
  /** Free identifier used in output and cache names. */
  id: string;
  /** The exact `task` string a CALL-E call would carry. */
  task: string;
  /** Recipient locale from the call, for example `en-IN`. */
  locale: string;
  /** Provider voice identifier, substituted into the endpoint and body. */
  voiceId: string;
  /** Ceiling on the spoken length, measured from the rendered audio. */
  maxSpokenSeconds: number;
  /** Lines that must survive verbatim. */
  locked: readonly LockedLine[];
}

/** One finding. Every finding is a fact about the text or the rendered audio. */
export interface Finding {
  code:
    | "locked_line_missing"
    | "digit_run_unseparated"
    | "voice_language_mismatch"
    | "spoken_too_long"
    | "text_over_provider_limit";
  /** Short human sentence. No advice, no score, no prediction. */
  message: string;
  /** The exact evidence the finding was derived from. */
  evidence: string;
}

/** Result of rendering one script through one provider. */
export interface Render {
  provider: string;
  voiceId: string;
  bytes: number;
  /** Measured from the audio container, not estimated from the text. */
  seconds: number | null;
  path: string;
  cached: boolean;
}

export interface PreflightResult {
  scriptId: string;
  render: Render | null;
  findings: readonly Finding[];
  ok: boolean;
}

/** Refusals carry their own type so the CLI can map them to exit codes. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}
