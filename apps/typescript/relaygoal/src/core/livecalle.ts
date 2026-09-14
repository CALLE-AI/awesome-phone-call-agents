// Live CALL-E adapter: wraps the real @call-e/calle server SDK behind CalleLike, so
// the whole verified-phone-outcome core runs unchanged against real calls.
//
// Why this file exists (and why "swap FakeCalle for CalleClient, nothing else changes"
// was NOT true): the real SDK's CreateCallInput nests the recipient ({ recipient: { phone } }),
// takes the idempotency key in an OPTIONS argument (not the body), and returns transcripts
// PER-ATTEMPT PER-RECIPIENT (Call.recipients[].attempts[].transcriptTurns), not the flat
// transcriptTurns the core consumes. taskCompleted and completionConfidence are also nullable
// until CALL-E reaches a terminal outcome. This adapter maps across that gap and fails closed.
//
// @call-e/calle is an OPTIONAL peer dependency: the core, tests, and `next build` must stay
// green WITHOUT it installed. So the SDK is loaded through a variable-specifier dynamic import
// (which TypeScript does not statically resolve) and the surface we depend on is declared
// locally below — the pure mappers are exported and unit-tested with no package and no key.

import type {
  CalleCallResult,
  CalleLike,
  CallStatus,
  CreateCallInput,
  Speaker,
  TranscriptTurn,
} from "./types";

// ---- Minimal structural view of @call-e/calle@0.7.x (only what we use) ----

interface SdkTranscriptTurn {
  offset_seconds: number | null;
  speaker: Speaker; // SDK TranscriptSpeaker = "bot" | "user" | "unknown" — identical to our Speaker
  text: string;
}

interface SdkAttempt {
  status: string; // AttemptStatus: queued|dialing|in_progress|completed|failed|canceled
  transcriptTurns: SdkTranscriptTurn[];
}

interface SdkRecipient {
  attempts: SdkAttempt[];
  structuredResult: Record<string, unknown> | null;
  summary: string | null;
}

interface SdkCall {
  status: CallStatus; // SDK CallStatus = queued|in_progress|completed|failed|canceled — identical
  taskCompleted: boolean | null;
  completionConfidence: { score: number; label: string } | null;
  evidence: string[];
  summary: string | null;
  structuredResult: Record<string, unknown> | null;
  recipients: SdkRecipient[];
}

interface SdkCreateCallInput {
  task: string;
  recipient?: { phone?: string; phones?: string[]; locale?: string; region?: string };
  resultSchema?: Record<string, unknown> | null;
}

interface SdkRequestAndWaitOptions {
  idempotencyKey?: string;
  timeoutMs?: number;
  intervalMs?: number;
}

interface SdkClient {
  calls: {
    createAndWait(input: SdkCreateCallInput, options?: SdkRequestAndWaitOptions): Promise<SdkCall>;
  };
}

interface SdkModule {
  CalleClient: new (opts: { apiKey: string; baseUrl?: string }) => SdkClient;
}

// ---- Pure mappers (exported for credential-free tests) ----

/** Map the core's flat request onto the SDK's nested CreateCallInput. */
export function toCreateInput(req: CreateCallInput): SdkCreateCallInput {
  const input: SdkCreateCallInput = {
    task: req.task,
    recipient: { phone: req.phone },
  };
  if (req.resultSchema !== undefined) input.resultSchema = req.resultSchema;
  return input;
}

/** The idempotency key rides in the OPTIONS argument, never the request body. */
export function toRequestOptions(
  req: CreateCallInput,
  wait?: { timeoutMs?: number; intervalMs?: number },
): SdkRequestAndWaitOptions {
  const options: SdkRequestAndWaitOptions = {};
  if (req.idempotencyKey !== undefined) options.idempotencyKey = req.idempotencyKey;
  if (wait?.timeoutMs !== undefined) options.timeoutMs = wait.timeoutMs;
  if (wait?.intervalMs !== undefined) options.intervalMs = wait.intervalMs;
  return options;
}

/**
 * Choose the transcript to verify against. Prefer the most recent COMPLETED attempt with
 * turns; otherwise the most recent attempt that produced any turns; otherwise none. Returning
 * an empty transcript is the correct fail-closed signal — verifyOutcome then marks the outcome
 * unverified/unreachable rather than vouching for an answer with no evidence.
 */
export function pickTranscript(recipient: SdkRecipient | undefined): TranscriptTurn[] {
  if (!recipient || recipient.attempts.length === 0) return [];
  const withTurns = recipient.attempts.filter((a) => a.transcriptTurns.length > 0);
  if (withTurns.length === 0) return [];
  const completed = [...withTurns].reverse().find((a) => a.status === "completed");
  const chosen = completed ?? withTurns[withTurns.length - 1]!;
  return chosen.transcriptTurns.map((t) => ({
    offsetSeconds: t.offset_seconds ?? 0,
    speaker: t.speaker,
    text: t.text,
  }));
}

/** Flatten a real SDK Call into the core's CalleCallResult, filling nullable fields conservatively. */
export function mapCallToResult(call: SdkCall): CalleCallResult {
  const recipient = call.recipients.length > 0 ? call.recipients[0] : undefined;
  const result: CalleCallResult = {
    status: call.status,
    taskCompleted: call.taskCompleted ?? false,
    completionConfidence: call.completionConfidence ?? { score: 0, label: "unknown" },
    evidence: call.evidence ?? [],
    transcriptTurns: pickTranscript(recipient),
  };
  const summary = call.summary ?? recipient?.summary ?? undefined;
  if (summary != null) result.summary = summary;
  const structured = call.structuredResult ?? recipient?.structuredResult ?? undefined;
  if (structured != null) result.structuredResult = structured;
  return result;
}

// ---- Adapter + loader ----

export interface LiveCalleWaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

/** Wrap an already-constructed SDK client as a CalleLike. Pure and injectable — this is what tests exercise. */
export function createLiveCalle(sdk: SdkClient, wait?: LiveCalleWaitOptions): CalleLike {
  return {
    calls: {
      createAndWait: async (input: CreateCallInput): Promise<CalleCallResult> => {
        const call = await sdk.calls.createAndWait(toCreateInput(input), toRequestOptions(input, wait));
        return mapCallToResult(call);
      },
    },
  };
}

export interface LoadLiveCalleOptions {
  apiKey: string;
  baseUrl?: string;
  wait?: LiveCalleWaitOptions;
}

/**
 * Credentials only ever travel to an approved CALL-E host over HTTPS. A misconfigured or
 * hostile CALLE_BASE_URL (http://, or some other host) must never receive the API key, so we
 * refuse to construct the client rather than leak the credential. The SDK's own default
 * (api.heycall-e.com) needs no override; the test host is allowed for the opt-in smoke test.
 */
const APPROVED_CALLE_HOSTS = new Set(["api.heycall-e.com", "test-api.heycall-e.com"]);
export function assertApprovedBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("CALLE_BASE_URL is not a valid URL; refusing to send credentials.");
  }
  if (url.protocol !== "https:") {
    throw new Error("CALLE_BASE_URL must use https; refusing to send credentials over a non-HTTPS URL.");
  }
  if (!APPROVED_CALLE_HOSTS.has(url.hostname)) {
    throw new Error(
      `CALLE_BASE_URL host "${url.hostname}" is not an approved CALL-E host; refusing to send credentials.`,
    );
  }
  return baseUrl;
}

/**
 * Load the optional @call-e/calle SDK and return a live CalleLike. Throws a clear, actionable
 * error if the package is not installed (it is an optional peer dependency). The specifier is a
 * variable on purpose so TypeScript/bundlers do not require the package to be present to compile.
 */
export async function loadLiveCalle(opts: LoadLiveCalleOptions): Promise<CalleLike> {
  const specifier = "@call-e/calle";
  let mod: SdkModule;
  try {
    // webpackIgnore keeps this a native runtime import of the OPTIONAL peer dep: the bundler must
    // not try to resolve or inline it at build time (it may be absent), and it resolves from
    // node_modules at runtime once the operator installs it. Also silences the expression-dependency warning.
    mod = (await import(/* webpackIgnore: true */ specifier)) as unknown as SdkModule;
  } catch (cause) {
    throw new Error(
      "Live mode needs the optional CALL-E SDK. Install it with `npm install @call-e/calle` and set CALLE_API_KEY.",
      { cause },
    );
  }
  if (opts.baseUrl !== undefined) assertApprovedBaseUrl(opts.baseUrl);
  const client = new mod.CalleClient(
    opts.baseUrl !== undefined ? { apiKey: opts.apiKey, baseUrl: opts.baseUrl } : { apiKey: opts.apiKey },
  );
  return createLiveCalle(client, opts.wait);
}

/**
 * Pick the client for a request. Live requires an EXPLICIT opt-in (RELAYGOAL_LIVE=1) AND a key —
 * so the safe no-call FakeCalle path stays the default even when a key is present in the
 * environment, which is exactly the "no-call / dry-run default" the submission merge bar requires.
 */
export async function selectCalleClient(
  fallback: CalleLike,
): Promise<{ client: CalleLike; live: boolean }> {
  const apiKey = process.env.CALLE_API_KEY;
  const enabled = process.env.RELAYGOAL_LIVE === "1";
  if (!enabled || !apiKey) return { client: fallback, live: false };

  const baseUrl = process.env.CALLE_BASE_URL;
  const timeoutMs = numFromEnv("RELAYGOAL_CALL_TIMEOUT_MS");
  const intervalMs = numFromEnv("RELAYGOAL_CALL_POLL_MS");
  const wait: LiveCalleWaitOptions = {};
  if (timeoutMs !== undefined) wait.timeoutMs = timeoutMs;
  if (intervalMs !== undefined) wait.intervalMs = intervalMs;

  const client = await loadLiveCalle({
    apiKey,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    wait,
  });
  return { client, live: true };
}

function numFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
