/**
 * CALL-E integration (async create + poll).
 *
 * Real phone calls take 30s–2min, which is far longer than a serverless request
 * can block. So we CREATE the call (returns immediately with a callId), then the
 * client POLLS a status route until the call reaches a terminal state.
 *
 * Simulation only happens when NO API key is configured (pure demo mode). When a
 * key IS set, a failed/timed-out call surfaces honestly — we never fabricate a
 * result that looks real.
 *
 * Server-only: never import into client components (it reads the API key).
 *
 * Env:
 *   CALLE_API_KEY     Bearer key from dashboard.heycall-e.com/account/api-keys
 *   CALLE_BASE_URL    API base. Must be an approved HTTPS origin - see
 *                     APPROVED_CALLE_ORIGINS. Defaults to
 *                     https://api.heycall-e.com.
 *   CALLE_DEMO_PHONE  Number to dial when a target has none (E.164, e.g. +923001234567)
 */

import { CalleClient } from "@call-e/calle";

/* Relative, not "@/lib/...", on purpose: this module is loaded by the scripts
   in scripts/ through jiti, which does not resolve the tsconfig path alias.
   An aliased import here breaks every one of them at require time. */
import { describeFailure, regionForNumber, type FailureExplanation } from "./call-failures";
import { deepMaskPhones, maskedJson } from "./mask";

const KEY = process.env.CALLE_API_KEY;
const DEMO_PHONE = process.env.CALLE_DEMO_PHONE || "";

/**
 * Where the API key is allowed to go.
 *
 * CALLE_BASE_URL used to be taken from the environment and handed straight to
 * the SDK, which then sent `Authorization: Bearer <key>` to it. Any value at
 * all was accepted - a typo, a plain-http host, someone else's domain - and
 * the first thing the client did with it was authenticate. An environment
 * variable is not a trust boundary, so the origin is checked before the
 * credential moves.
 *
 * Adding an origin is a source change, deliberately: it is reviewable, and it
 * cannot be done by whoever can set an env var. A local mock server belongs
 * on this list by name rather than through a general "allow http on
 * localhost" escape hatch, which is the hole this closes.
 */
export const APPROVED_CALLE_ORIGINS: readonly string[] = ["https://api.heycall-e.com"];

export const DEFAULT_CALLE_BASE_URL = "https://api.heycall-e.com";

/**
 * Resolve CALLE_BASE_URL to an approved HTTPS origin, or refuse.
 *
 * Returns the ORIGIN, not the input: that drops any path, query and - the
 * reason it matters - any `user:pass@` embedded in the URL, which would
 * otherwise be sent as a second set of credentials.
 *
 * Throws rather than falling back to the default. A misconfigured base URL is
 * someone believing calls go somewhere they do not; quietly dialling through
 * production instead would be the worse of the two failures.
 */
export function resolveCalleBaseUrl(raw?: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return DEFAULT_CALLE_BASE_URL;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`CALLE_BASE_URL is not a valid URL: ${trimmed}`);
  }

  if (url.protocol !== "https:") {
    throw new Error(
      `CALLE_BASE_URL must be https - refusing to send the CALL-E API key over ${url.protocol}//`
    );
  }

  if (!APPROVED_CALLE_ORIGINS.includes(url.origin)) {
    throw new Error(
      `CALLE_BASE_URL origin ${url.origin} is not approved. ` +
      `Approved: ${APPROVED_CALLE_ORIGINS.join(", ")}. ` +
      `Add it to APPROVED_CALLE_ORIGINS in lib/calle.ts if it belongs there.`
    );
  }

  return url.origin;
}

/**
 * Locale is a hint about the CONVERSATION - what language and accent to speak
 * and to listen for - not a property of the number. Deriving it from the
 * country code would give en-PK for a +92 number, which is the setting that
 * produced several unrecoverable mis-transcriptions of ordinary Urdu-accented
 * English, which is what this default exists to avoid.
 * en-US is the best-resourced English model on both the speaking and the
 * listening side, and it is what an international audience will follow.
 *
 * A default, not a hardcode: any caller can pass its own locale through
 * CampaignContext, which is how a future Urdu or Arabic campaign would work.
 *
 * `region` has no default on purpose. It is a routing and compliance hint
 * about the NUMBER, and CALL-E infers it from the E.164 prefix when omitted -
 * so omitting it is global by construction and needs no country table.
 */
export const DEFAULT_LOCALE = "en-US";

export interface CalleCreateInput {
  task: string;
  phone: string;
  resultSchema: Record<string, unknown>;
  region?: string;
  locale?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface CalleCallState {
  status: string;
  done: boolean;
  failed: boolean;
  structuredResult: Record<string, unknown> | null;
  summary: string | null;
  /** The number CALL-E actually dialled, straight from the recipient record.
   *  Reported rather than re-derived: re-running resolvePhone() would only
   *  tell us what we would dial now, not what was dialled then. */
  phone: string | null;
  /** CALL-E's own completion timestamp, not ours. */
  completedAt: string | null;
  /** How many turns were transcribed. CALL-E reports some calls as
   *  "completed" with zero connected seconds and no transcript at all; those
   *  never reached anyone, whatever the status string says. */
  transcriptTurns: number;
  /** The turns themselves. Stored with the call so the transcript survives
   *  CALL-E: the plan's "heard here" link must open even when their API is
   *  refusing requests, which it has been for hours at a time. */
  turns: { at: number | null; speaker: string; text: string }[];

  /* CALL-E's own read on how the call went. We were discarding all three.
   *
   * On one creator call it returned a high-confidence score and this
   * as its third piece of evidence:
   *
   *   "The bot did not repeat back or clarify the rate before moving to
   *    later questions."
   *
   * which is exactly the defect that produced a confidently wrong rate. The
   * score was no help - 0.78 "high" on a call that got the number wrong - so
   * it is surfaced but never used as a gate. The evidence strings are the
   * part worth reading, and they were sitting in the payload unread. */
  taskCompleted: boolean | null;
  confidence: { score: number; label: string } | null;
  evidence: string[];

  /* WHY it failed, in CALL-E's words rather than ours. Every failed Arc call
     carried failureCode "486" on the attempt and nothing read it, so the card
     said "the call did not connect" for a busy line, a wrong number and a
     refused route alike. */
  failure: FailureExplanation | null;
}

/* How long we will wait for CALL-E to answer ONE request. Not how long we
   wait for a call - that is the poll loop's business - just this round trip.
 *
 * Two numbers, because the two operations are not alike. A GET is a status
 * read and should be quick; if it is not, the poll loop simply asks again in
 * four seconds and nothing is lost. A POST /v1/calls is the provider ACCEPTING
 * a call, on an API whose queue we have measured between 20 seconds and 105
 * minutes - and a create that times out is not retried by anything, so a
 * deadline too short there does not slow a call down, it prevents it.
 *
 * 45s rather than the 90 that would be generous, because the route around it
 * is bounded too: maxDuration is 60 on both call routes, and a fetch deadline
 * longer than the function's own budget cannot fire - the platform kills the
 * invocation first and returns its own error page instead of ours. The
 * deadline has to sit inside the budget to be worth having. */
const READ_TIMEOUT_MS = Number(process.env.CALLE_REQUEST_TIMEOUT_MS ?? 15_000);
const CREATE_TIMEOUT_MS = Number(process.env.CALLE_CREATE_TIMEOUT_MS ?? 45_000);

/**
 * The SDK's fetch, with a deadline.
 *
 * Nothing in the chain had one. `openapi-fetch` uses the platform fetch, which
 * waits indefinitely once connected, and CALL-E is a provider we have watched
 * hold a request for eleven minutes. A poll to /api/calle/status therefore sat
 * open for over five minutes in development - `maxDuration` is a Vercel
 * setting and `next dev` does not enforce it - and because a browser allows
 * only about six connections per origin, the page's own polls queued behind
 * the stuck one. One unanswered request stalled the whole card.
 *
 * A timeout turns that into an error the route can report and the poll loop
 * can retry, which is the difference between a slow call and a dead page.
 */
const timedFetch = (input: Request): Promise<Response> => {
  /* Placing a call is the only POST we make; everything else reads. */
  const isCreate = input.method === "POST";
  const ms = isCreate ? CREATE_TIMEOUT_MS : READ_TIMEOUT_MS;
  return fetch(input, { signal: AbortSignal.timeout(ms) }).catch((e) => {
    /* AbortError is what a timeout looks like from the outside, and on its own
       it says nothing about who timed out. Name the provider and the
       operation, or this surfaces to a user as "The operation was aborted". */
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new Error(
        `CALL-E did not respond within ${Math.round(ms / 1000)}s ` +
        `(${isCreate ? "placing the call" : "checking its status"}).`
      );
    }
    throw e;
  });
};

let _client: CalleClient | null = null;
function client(): CalleClient | null {
  if (!KEY) return null;
  /* Checked here rather than at module load. A bad CALLE_BASE_URL should fail
     the call that would have sent the key, not the build - the whole point of
     item 5 in the same review was a module-scope throw taking the build down
     with it. */
  if (!_client) {
    const baseUrl = resolveCalleBaseUrl(process.env.CALLE_BASE_URL);
    _client = new CalleClient({ apiKey: KEY, baseUrl, fetch: timedFetch });
  }
  return _client;
}

export function calleConfigured(): boolean {
  return Boolean(KEY);
}

/** Non-sensitive diagnostics so we can confirm which build is live. */
export function calleDiagnostics() {
  /* /api/calle/health is public and must answer even when the base URL is
     misconfigured - that is exactly when someone is reading it. So the
     refusal is reported rather than thrown. */
  let baseUrl: string | null = null;
  let baseUrlApproved = false;
  try {
    baseUrl = resolveCalleBaseUrl(process.env.CALLE_BASE_URL);
    baseUrlApproved = true;
  } catch {
    baseUrl = null;
  }
  return {
    impl: "async-poll-v2",
    configured: Boolean(KEY),
    demoPhoneSet: Boolean(DEMO_PHONE),
    baseUrl,
    baseUrlApproved,
  };
}

/**
 * Resolve the number to dial.
 *
 * A typed or target-supplied number always wins. The env fallback applies
 * ONLY outside production, and that is a safety property rather than a
 * convenience: CALLE_DEMO_PHONE is a single server-side number, so on a
 * deployed site it would make every user's call ring one person's handset.
 * A judge signing up would phone the maintainer.
 *
 * In production there is no fallback at all, so the only number Arc can dial
 * is one the user typed themselves.
 */
export function resolvePhone(targetPhone?: string): string {
  const explicit = (targetPhone ?? "").trim();
  if (explicit) return explicit;
  return process.env.NODE_ENV === "production" ? "" : DEMO_PHONE || "";
}

/** Whether the env fallback is in play at all - the UI explains itself
 *  differently when a number is mandatory. */
export function demoFallbackActive(): boolean {
  return process.env.NODE_ENV !== "production" && Boolean(DEMO_PHONE);
}

/** E.164: leading +, country code 1-9, total 8–15 digits. */
export function isE164(p?: string): boolean {
  return typeof p === "string" && /^\+[1-9]\d{7,14}$/.test(p);
}

const TERMINAL = new Set(["completed", "failed", "no_answer", "canceled", "cancelled", "expired"]);

/** Create a call and return its id immediately. Does NOT wait for completion. */
export async function calleCreateCall(input: CalleCreateInput): Promise<{ callId: string }> {
  const c = client();
  if (!c) throw new Error("CALL-E is not configured (no CALLE_API_KEY).");
  // region stays omitted unless a caller asks for one: CALL-E infers it from
  // the E.164 number, which is correct for every market without a lookup
  // table. locale falls back to DEFAULT_LOCALE - see the note above.
  const recipient: { phone: string; region?: string; locale?: string } = { phone: input.phone };
  /* Region was being omitted on the belief that CALL-E infers it from the
     E.164 prefix. It does not: every recipient record comes back with
     `region: null`, and the API describes region as "used for routing and
     compliance checks". So we send it.

     It is NOT the explanation for the 486 failures, and an earlier version of
     this comment said it was. One call connected to the
     same +92 number and ran 275 seconds over 69 turns with region null, three
     minutes after another got an instant 486 with the
     same payload. A field that is identical on the success and the failure
     cannot be what separates them. Sending it is correct on the API's own
     description; treating it as the fix would be a guess wearing a fact's
     clothes. */
  const region = input.region || regionForNumber(input.phone);
  if (region) recipient.region = region;
  recipient.locale = input.locale || DEFAULT_LOCALE;

  const body = {
    task: input.task,
    recipient,
    recipientResultSchema: input.resultSchema,
    metadata: (input.metadata ?? {}) as Record<string, unknown>,
  };

  /* The whole payload, every time. Diagnosing the 486 meant reading the SDK's
     type definitions to work out what we were sending, because nothing was
     recorded - and "what did we actually send" should never be a question that
     needs archaeology. The task text is long and is the one part we already
     know, so it is logged by length rather than in full.

     The destination is masked. This line used to put the station's number in
     clear into the platform log on every call - a number belonging to someone
     who never agreed to be in this system and cannot ask for it back. Masked
     rather than dropped: the log still has to be able to tell two calls
     apart, and a log that cannot is one nobody keeps. */
  console.log(
    "CALL-E create request:",
    maskedJson({
      ...body,
      task: `<${input.task.length} chars>`,
      idempotencyKey: input.idempotencyKey ?? null,
    })
  );

  try {
    const call = await c.calls.create(body, { idempotencyKey: input.idempotencyKey });
    /* Deeply masked, not field-by-field. This shape is CALL-E's, not ours -
       a recipients array today, something else tomorrow - and masking only
       the fields we happen to know about leaves the next one in clear, with
       no sign that anything went wrong. */
    console.log(
      "CALL-E create response:",
      maskedJson({
        id: call.id,
        status: call.status,
        recipients: call.recipients?.map((r) => ({
          phones: r.phones, region: r.region, locale: r.locale, status: r.status,
        })),
      })
    );
    return { callId: call.id };
  } catch (e) {
    /* Provider errors quote the request back often enough that this cannot be
       assumed clean either. */
    console.error(
      "CALL-E create failed:",
      deepMaskPhones(e instanceof Error ? e.message : String(e))
    );
    throw e;
  }
}

/** Fetch current call state (one poll). */
export async function calleGetCall(callId: string): Promise<CalleCallState> {
  const c = client();
  if (!c) throw new Error("CALL-E is not configured (no CALLE_API_KEY).");
  const call = await c.calls.get(callId);
  const rec = call.recipients?.[0];
  /* The last attempt, not the first: a retried number's earlier attempt can
     have failed for a different reason than the one that settled it. */
  const attempt = rec?.attempts?.[rec.attempts.length - 1];
  const status = String(call.status ?? "unknown");
  const done = TERMINAL.has(status);
  return {
    status,
    done,
    failed: done && status !== "completed",
    structuredResult:
      (rec?.structuredResult as Record<string, unknown> | null) ??
      (call.structuredResult as Record<string, unknown> | null) ??
      null,
    summary: rec?.summary ?? call.summary ?? null,
    phone: rec?.phones?.[0] ?? rec?.attempts?.[0]?.phone ?? null,
    transcriptTurns: rec?.attempts?.reduce(
      (n, a) => n + ((a as { transcriptTurns?: unknown[]; transcript_turns?: unknown[] }).transcriptTurns
        ?? (a as { transcript_turns?: unknown[] }).transcript_turns ?? []).length,
      0,
    ) ?? 0,
    turns: ((attempt as { transcriptTurns?: unknown[] })?.transcriptTurns ?? []).map((t) => {
      const x = (t ?? {}) as { offset_seconds?: number; speaker?: string; text?: string };
      return { at: x.offset_seconds ?? null, speaker: x.speaker ?? "bot", text: (x.text ?? "").trim() };
    }),
    completedAt: call.completedAt ?? rec?.attempts?.[0]?.completedAt ?? null,
    taskCompleted: typeof call.taskCompleted === "boolean" ? call.taskCompleted : null,
    confidence:
      call.completionConfidence &&
      typeof call.completionConfidence.score === "number"
        ? {
            score: call.completionConfidence.score,
            label: String(call.completionConfidence.label ?? ""),
          }
        : null,
    evidence: Array.isArray(call.evidence) ? call.evidence.map(String) : [],
    /* The attempt knows more than the call does: the call-level code is a
       summary, the attempt's is the carrier's own answer for this dial. */
    failure: describeFailure(
      attempt?.failureCode ?? call.failureCode,
      attempt?.failureMessage ?? call.failureMessage
    ),
  };
}

// ------------------------------------------------------- simulation (no key)
function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Deterministic simulated structured result — used ONLY in demo mode (no key). */
export function mockResult(
  resultSchema: Record<string, unknown>,
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const name = String(metadata.name ?? "the contact");
  const targetType = String(metadata.targetType ?? "station");
  const seed = seedFrom(name + targetType);
  const positive = seed % 10 < 7;
  const reach = Number(metadata.audienceSize ?? 25000 + (seed % 400000));
  const props = ((resultSchema as { properties?: Record<string, unknown> }).properties ??
    {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of Object.keys(props)) {
    switch (field) {
      case "available":
      case "interested":
        out[field] = positive ? "yes" : seed % 3 ? "no" : "unknown";
        break;
      case "rate_per_spot":
        out[field] = 4000 + (seed % 26000);
        break;
      case "rate":
        out[field] = 6000 + (seed % 44000);
        break;
      case "spots_available":
        out[field] = positive ? 4 + (seed % 20) : 0;
        break;
      case "avail_dates":
      case "available_dates":
        out[field] = String(metadata.flight ?? "within the requested flight");
        break;
      case "deliverables":
        out[field] = ["1 Reel + 2 stories", "1 TikTok + 1 story", "1 YouTube integration"][seed % 3];
        break;
      case "audience_estimate":
      case "audience_size":
        out[field] = `~${reach.toLocaleString()} ${targetType === "station" ? "listeners" : "followers"}`;
        break;
      case "notes":
        out[field] =
          targetType === "station"
            ? "Wants a signed IO before holding inventory."
            : "Open to a package deal if booked for the full flight.";
        break;
      default:
        out[field] = "unknown";
    }
  }
  out._reach = reach;
  return out;
}
