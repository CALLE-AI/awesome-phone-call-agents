//  Tadah Calls: one human-confirmed CALL-E call about a scanned letter, with the
//  answer brought back as structured data.
//
//  Ported from Tadah's Cloudflare Worker. Its database tables become in-memory
//  maps, and the app's sign-in and subscription checks become one
//  `checkEntitled` hook. Every path that can dial fails closed.

import { createHash, randomUUID } from "node:crypto";

export const CALLE_BASE_URL = "https://api.heycall-e.com";
/** Display-only phone masking; private request payloads stay unchanged. */
export function maskText(text: string): string {
  return text.replace(/\+[1-9][0-9]{7,14}/g, (phone) => maskPhone(phone));
}
const CALL_MONTH_LIMIT = 10; // per person, per calendar month
const CALL_GLOBAL_MONTH_LIMIT = 300; // circuit breaker across everyone
const POLL_REFRESH_MS = 3000; // a status read asks CALL-E at most this often
const MAX_GOAL_CHARS = 600;

// ── Request checks ──────────────────────────────────────────────────────────
// "Businesses only" is enforced by provenance: the number comes from the user's
// document, or a correction they typed while looking at it. Mobile and VoIP
// numbers are allowed, because small businesses answer on them. What is refused
// is the set of numbers that are never the business the user meant.

/** Document or user input to E.164, US only; null if it can't be dialled. */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Drop an extension together with the digit after its marker, so
  // "555-0100 x229" doesn't fold the extension into the number.
  const cut = raw.split(/(?:\bext(?:ension)?\b|\bx)\.?\s*\d/i)[0] ?? "";
  let digits = cut.replace(/\D/g, "");
  if (digits.length === 10) digits = "1" + digits;
  return digits.length === 11 && digits.startsWith("1") ? "+" + digits : null;
}

export type PhoneCheck =
  | { ok: true }
  | { ok: false; reason: "invalid_phone" | "emergency_or_service" | "premium_rate" };

export function phoneIsCallable(e164: string): PhoneCheck {
  // NANP: the area code and the exchange both start 2-9.
  if (!/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(e164)) return { ok: false, reason: "invalid_phone" };
  const areaCode = e164.slice(2, 5);
  const exchange = e164.slice(5, 8);
  if (areaCode.endsWith("11")) return { ok: false, reason: "emergency_or_service" }; // 211 to 911
  if (areaCode === "900" || exchange === "976") return { ok: false, reason: "premium_rate" };
  return { ok: true }; // toll-free is allowed: it is what most billers publish
}

/** Luhn check: the strong signal that a digit run is a payment card. */
export function looksLikeCardNumber(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let n = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
    sum += n;
  }
  return sum % 10 === 0;
}

const UNSAFE_PHRASES: Array<[RegExp, string]> = [
  [/\bssn\b|\bsocial security\b|\b\d{3}-\d{2}-\d{4}\b/i, "ssn"],
  [/\bcredit card\b|\bdebit card\b|\bcard number\b|\bcvv\b|\bcvc\b|\bsecurity code\b/i, "card"],
  [/\brouting number\b|\baccount and routing\b/i, "bank"],
  [/\bmy (?:password|passcode|pin)\b|\bpin number\b/i, "credential"],
  [/\bdate of birth\b|\bdob\b/i, "dob"],
];

/**
 * null when the request is fine, else why not. Checked before anything dials,
 * because the likely incident is a user pasting their own card number into the
 * request. A long account number alone is allowed; only a Luhn-valid 13-19
 * digit run counts as a card.
 */
export function goalIsUnsafe(text: string): string | null {
  for (const [pattern, reason] of UNSAFE_PHRASES) if (pattern.test(text)) return reason;
  for (const run of text.match(/\d[\d\s-]{11,}\d/g) ?? []) {
    if (looksLikeCardNumber(run.replace(/[\s-]/g, ""))) return "card";
  }
  return null;
}

export const maskPhone = (e164: string): string => `+1 *** ***-${e164.slice(-4)}`;

// ── What CALL-E is told ─────────────────────────────────────────────────────

export function buildCallTask({ name, goal, mayAgreeTo }: { name: string; goal: string; mayAgreeTo: string }): string {
  // This name is read aloud to a stranger, so an email address is never used as one.
  const who = name && !name.includes("@") ? name : "the account holder";
  return [
    `You are an AI assistant making a phone call on behalf of ${who}.`,
    ``,
    // The goal arrives in the user's own language; without this line the agent
    // mirrors it and rings a US business in that language.
    `Speak ENGLISH for the entire call, whatever language the goal below happens to be written in. Understand the goal in its own language, then carry it out in English.`,
    ``,
    `Open the call by saying: "Hi, I'm an AI assistant calling on behalf of ${who}. Is now a good time to ask a quick question?"`,
    ``,
    `Your goal: ${goal}`,
    ``,
    mayAgreeTo
      ? `You may agree to, on ${who}'s behalf: ${mayAgreeTo}. Nothing else.`
      : `You may not agree to anything at all on ${who}'s behalf. You are only gathering an answer.`,
    ``,
    `Rules:`,
    `- Never say a credit or debit card number, bank or routing number, Social Security number, date of birth, or any password or PIN. If asked for one, say ${who} will follow up directly.`,
    `- Never agree to a charge, a fee, or any payment.`,
    `- Do not commit ${who} to anything beyond what you may agree to above. If pushed, say you will call back.`,
    `- If you are asked whether you are a recording or a robot, say plainly that you are an AI assistant calling for a real person.`,
    `- If you are put on hold for more than one minute, say you will call back, and end the call.`,
    `- End the call after four minutes, or sooner once the goal is met or is clearly not achievable.`,
    `- Speak only English on the call, even if the goal was written in another language.`,
    `- Be brief and polite. Do not negotiate.`,
  ].join("\n");
}

// Enums include `unknown` on purpose: forcing a yes or no out of a call where
// nobody picked up puts a confident wrong answer on someone's to-do.
export const CALL_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "needs_user_action"],
  properties: {
    outcome: {
      type: "string",
      enum: ["done", "partially", "not_done", "unknown"],
      description:
        "done when the goal was fully achieved. partially when some of it was. not_done when it was refused or impossible. unknown when nobody answered or the call gave no evidence either way.",
    },
    detail: { type: "string", description: "One plain sentence the caller can act on, in the words a person would use." },
    agreed: {
      type: "string",
      description: "Exactly what was agreed, if anything: date, time, reference or confirmation number. Empty string when nothing was agreed.",
    },
    needs_user_action: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "yes when the business asked for something only the user themselves can do, such as sending a document or calling back in person.",
    },
    next_step: { type: "string", description: "The single next thing the user should do, or an empty string when there is nothing." },
  },
};

/**
 * One key per intent, so a retry can never become a second call. With a random
 * key per attempt, a lost reply to a create (the call may already be ringing)
 * followed by a retry rings the business twice. Same person, to-do, number,
 * words and hour give the same key, so CALL-E returns the original call or
 * refuses with `idempotency_conflict`.
 */
export function callIdempotencyKey(
  intent: { userId: string; itemId: string | null; phone: string; task: string },
  now: Date,
): string {
  const hour = now.toISOString().slice(0, 13);
  const text = [intent.userId, intent.itemId ?? "", intent.phone, intent.task, hour].join("\n");
  return "tadah-" + createHash("sha256").update(text).digest("hex").slice(0, 48);
}

// ── CALL-E ──────────────────────────────────────────────────────────────────

export interface CalleCall {
  id: string;
  status?: string;
  summary?: string | null;
  structured_result?: Record<string, unknown> | null;
  failure_code?: string | null;
  recipients?: Array<{
    structured_result?: Record<string, unknown> | null;
    attempts?: Array<{ transcript_turns?: Array<{ speaker: string; text: string }> }>;
  }>;
}

export interface CreateCallBody {
  task: string;
  recipients: Array<{ phones: string[]; region: "US"; locale: "en-US" }>;
  result_schema: unknown;
  metadata: { action_id: string };
  webhook_url?: string;
}

// keepCharge is true when we can't be sure no call was placed. It is never a reason to retry.
export type CreateOutcome = { ok: true; callId: string } | { ok: false; code: string; keepCharge: boolean };
export type ReadOutcome = { ok: true; call: CalleCall } | { ok: false };

export interface CalleProvider {
  readonly kind: "live" | "dry-run" | "fake";
  createCall(body: CreateCallBody, idempotencyKey: string): Promise<CreateOutcome>;
  getCall(callId: string): Promise<ReadOutcome>;
}

/** The real API. The key is only ever sent to CALL-E over https, or to a loopback test server. */
export function httpProvider(apiKey: string, baseUrl: string = CALLE_BASE_URL): CalleProvider {
  const url = new URL(baseUrl);
  const trusted =
    (url.protocol === "https:" && url.hostname === "api.heycall-e.com") ||
    (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost"));
  if (!trusted) throw new Error(`Refusing to send the CALL-E API key to ${url.origin}.`);
  if (!apiKey) throw new Error("CALLE_API_KEY is not set.");
  const auth = { Authorization: `Bearer ${apiKey}` };

  return {
    kind: "live",
    async createCall(body, idempotencyKey) {
      let response: Response;
      try {
        response = await fetch(`${url.origin}/v1/calls`, {
          method: "POST",
          redirect: "error",
          headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(body),
        });
      } catch {
        // Unknown whether it reached CALL-E: the charge stays, and nothing retries.
        return { ok: false, code: "provider_unreachable", keepCharge: true };
      }
      const payload = (await response.json().catch(() => null)) as { id?: string; error?: { code?: string } } | null;
      if (response.ok && payload?.id) return { ok: true, callId: payload.id };
      // A 4xx is an outright refusal: no call, no cost. A 5xx may have created the call.
      return { ok: false, code: payload?.error?.code ?? "provider_error", keepCharge: response.ok || response.status >= 500 };
    },
    async getCall(callId) {
      try {
        const response = await fetch(`${url.origin}/v1/calls/${encodeURIComponent(callId)}`, { headers: auth, redirect: "error" });
        return response.ok ? { ok: true, call: (await response.json()) as CalleCall } : { ok: false };
      } catch {
        return { ok: false };
      }
    },
  };
}

/** Runs the whole call path without contacting CALL-E. */
export function dryRunProvider(): CalleProvider {
  const detail = "Dry run: no call was placed.";
  return {
    kind: "dry-run",
    async createCall(body) {
      return { ok: true, callId: `dry_${body.metadata.action_id}` };
    },
    async getCall(callId) {
      return {
        ok: true,
        call: {
          id: callId,
          status: "completed",
          summary: detail,
          structured_result: { outcome: "unknown", detail, agreed: "", needs_user_action: "unknown", next_step: "" },
        },
      };
    },
  };
}

export interface FakeOutcome {
  summary: string;
  structured: Record<string, unknown>;
  transcript: Array<{ speaker: "bot" | "user"; text: string }>;
}

/** A fictional water-bill call. The business, the amounts and the reference are invented. */
export const WATER_BILL_OUTCOME: FakeOutcome = {
  summary: "The representative said July's reading was estimated, corrected the bill and removed the late fee.",
  structured: {
    outcome: "done",
    detail: "July's meter reading was estimated too high; they corrected the bill and removed the $25 late fee.",
    agreed: "New balance $96.40, reference BW-20931",
    needs_user_action: "no",
    next_step: "Pay $96.40 by September 30.",
  },
  transcript: [
    { speaker: "bot", text: "Hi, I'm an AI assistant calling on behalf of Mei. Is now a good time to ask a quick question?" },
    { speaker: "user", text: "Sure, what can I help with?" },
    { speaker: "bot", text: "Her water bill is $214.80 and it is usually about $90. Why is that, and can the $25 late fee be removed?" },
    { speaker: "user", text: "July was an estimated reading. I've corrected it and removed the fee. New balance $96.40, reference BW-20931." },
  ],
};

/**
 * In-process stand-in for CALL-E, used by the demo and the tests. It keeps
 * CALL-E's Idempotency-Key contract: the same key and body return the same call,
 * and the same key with a different body is refused as `idempotency_conflict`.
 */
export class FakeCalle implements CalleProvider {
  readonly kind = "fake";
  readonly created: Array<{ id: string; idempotencyKey: string; body: CreateCallBody }> = [];
  reads = 0;
  /** Create the next call but lose the answer, as a dropped connection would. */
  loseNextCreateResponse = false;
  private readonly finished = new Set<string>();
  private readonly byKey = new Map<string, { id: string; json: string }>();
  private readonly outcome: FakeOutcome;

  constructor(outcome: FakeOutcome = WATER_BILL_OUTCOME) {
    this.outcome = outcome;
  }

  async createCall(body: CreateCallBody, idempotencyKey: string): Promise<CreateOutcome> {
    const json = JSON.stringify(body);
    const seen = this.byKey.get(idempotencyKey);
    if (seen) {
      return seen.json === json ? { ok: true, callId: seen.id } : { ok: false, code: "idempotency_conflict", keepCharge: false };
    }
    const id = `call_fake${this.created.length + 1}`;
    this.created.push({ id, idempotencyKey, body });
    this.byKey.set(idempotencyKey, { id, json });
    if (this.loseNextCreateResponse) {
      this.loseNextCreateResponse = false;
      return { ok: false, code: "service_unavailable", keepCharge: true };
    }
    return { ok: true, callId: id };
  }

  async getCall(callId: string): Promise<ReadOutcome> {
    if (!this.created.some((call) => call.id === callId)) return { ok: false };
    this.reads += 1;
    const done = this.finished.has(callId);
    return {
      ok: true,
      call: {
        id: callId,
        status: done ? "completed" : "in_progress",
        summary: done ? this.outcome.summary : null,
        structured_result: done ? this.outcome.structured : null,
        recipients: [{ attempts: [{ transcript_turns: done ? this.outcome.transcript : [] }] }],
      },
    };
  }

  complete(callId: string): void {
    this.finished.add(callId);
  }

  /** The event CALL-E posts to the webhook when a call ends. */
  webhookEvent(callId: string, eventId: string): Record<string, unknown> {
    const call = this.created.find((created) => created.id === callId);
    return { id: eventId, type: "call.completed", data: { id: callId, metadata: call?.body.metadata ?? {} } };
  }
}

// ── The call service ────────────────────────────────────────────────────────

/** What the confirm page sends. Fields are unknown because they arrive as JSON. */
export interface CallRequest {
  phone?: unknown;
  goal?: unknown;
  mayAgreeTo?: unknown;
  name?: unknown;
  itemId?: unknown;
}

export type ActionStatus = "queued" | "in_progress" | "completed" | "failed" | "canceled";

export interface ActionRecord {
  id: string;
  userId: string;
  status: ActionStatus;
  providerCallId: string | null;
  summary: string | null;
  structured: Record<string, unknown> | null;
  transcript: string | null;
  failureCode: string | null;
  polledAt: number;
}

export type Refusal = { ok: false; error: string; message: string; actionId?: string };
export type Prepared =
  | { ok: true; phone: string; goal: string; mayAgreeTo: string; name: string; itemId: string | null; task: string; idempotencyKey: string }
  | Refusal;
export type PlaceResult = { ok: true; actionId: string; dryRun: boolean; callsUsed: number } | Refusal;

const refuse = (error: string, message: string): Refusal => ({ ok: false, error, message });
const isLive = (status: ActionStatus): boolean => status === "queued" || status === "in_progress";
const text = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Validate a request and build the exact task and key, with no side effects. Preview uses this too. */
export function prepareCall(userId: string, request: CallRequest, now: Date = new Date()): Prepared {
  const phone = normalizePhone(request.phone);
  if (!phone) return refuse("invalid_phone", "That doesn't look like a US phone number.");
  const callable = phoneIsCallable(phone);
  if (!callable.ok) return refuse(callable.reason, "Tadah can't call that number.");

  if (typeof request.goal === "string" && request.goal.trim().length > MAX_GOAL_CHARS) {
    return refuse("goal_too_long", `Keep the request under ${MAX_GOAL_CHARS} characters.`);
  }
  const goal = text(request.goal, MAX_GOAL_CHARS);
  if (!goal) return refuse("missing_goal", "Say what the call should ask.");
  const mayAgreeTo = text(request.mayAgreeTo, 200);
  const name = text(request.name, 60);
  const itemId = typeof request.itemId === "string" ? request.itemId : null;

  // A rule the model is asked to follow is not a control; this is.
  const unsafe = goalIsUnsafe(goal) ?? goalIsUnsafe(mayAgreeTo);
  if (unsafe) {
    return refuse("unsafe_goal", `Take personal numbers out of the request (${unsafe}): Tadah never reads them over the phone.`);
  }

  const task = buildCallTask({ name, goal, mayAgreeTo });
  const idempotencyKey = callIdempotencyKey({ userId, itemId, phone, task }, now);
  return { ok: true, phone, goal, mayAgreeTo, name, itemId, task, idempotencyKey };
}

export function createCallBody(
  actionId: string,
  task: string,
  phone: string,
  webhook?: { baseUrl: string; secret: string },
): CreateCallBody {
  return {
    task,
    recipients: [{ phones: [phone], region: "US", locale: "en-US" }],
    result_schema: CALL_RESULT_SCHEMA,
    metadata: { action_id: actionId },
    ...(webhook ? { webhook_url: `${webhook.baseUrl}/actions/webhook/${webhook.secret}` } : {}),
  };
}

/** Compares every character with no early exit, so timing doesn't reveal a partly right guess. */
export function secretsMatch(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface CallServiceOptions {
  provider: CalleProvider;
  /** Where CALL-E delivers its webhook. The secret in the path is the route's only authentication. */
  webhook?: { baseUrl: string; secret: string };
  monthLimit?: number;
  now?: () => Date;
  /** The host's sign-in, verified-email and subscription check. An error blocks the call. */
  checkEntitled?: (userId: string) => Promise<boolean>;
}

export class CallService {
  private readonly actions = new Map<string, ActionRecord>();
  private readonly events = new Set<string>();
  private readonly usage = new Map<string, number>();
  private readonly options: CallServiceOptions;

  constructor(options: CallServiceOptions) {
    this.options = options;
  }

  /** Authorise, charge, dial. */
  async placeCall(userId: string, request: CallRequest): Promise<PlaceResult> {
    const { provider, checkEntitled, webhook } = this.options;
    if (checkEntitled) {
      const allowed = await checkEntitled(userId).catch(() => null);
      if (allowed === null) return refuse("entitlement_unavailable", "Can't confirm the account right now, so no call was placed.");
      if (!allowed) return refuse("not_entitled", "This account can't place calls.");
    }

    const now = this.now();
    const prepared = prepareCall(userId, request, now);
    if (!prepared.ok) return prepared;

    // One live call per person: two at once is how a bug becomes a bill.
    for (const action of this.actions.values()) {
      if (action.userId === userId && isLive(action.status)) {
        return refuse("call_in_progress", "Tadah is already on a call for this person.");
      }
    }

    // Charge before dialling so two requests can't both see room. Refund only
    // when it is certain no call was placed.
    const period = now.toISOString().slice(0, 7);
    const mine = this.bump(`${userId}|${period}`, 1);
    const everyone = this.bump(`*|${period}`, 1);
    const refund = () => {
      this.bump(`${userId}|${period}`, -1);
      this.bump(`*|${period}`, -1);
    };
    const limit = this.options.monthLimit ?? CALL_MONTH_LIMIT;
    if (mine > limit) {
      refund();
      return refuse("quota_exceeded", `All ${limit} calls this month are used.`);
    }
    if (everyone > CALL_GLOBAL_MONTH_LIMIT) {
      refund();
      return refuse("temporarily_unavailable", "Calling is paused right now.");
    }

    const record: ActionRecord = {
      id: randomUUID(),
      userId,
      status: "queued",
      providerCallId: null,
      summary: null,
      structured: null,
      transcript: null,
      failureCode: null,
      polledAt: 0,
    };
    this.actions.set(record.id, record);

    const body = createCallBody(record.id, prepared.task, prepared.phone, webhook);
    const placed = await provider.createCall(body, prepared.idempotencyKey);
    if (!placed.ok) {
      record.status = "failed";
      record.failureCode = placed.code;
      if (!placed.keepCharge) refund();
      const message =
        placed.code === "idempotency_conflict"
          ? "The same call was already placed this hour, so it was not placed again."
          : "Tadah couldn't place the call.";
      return { ok: false, error: placed.code, message, actionId: record.id };
    }
    record.status = "in_progress";
    record.providerCallId = placed.callId;
    return { ok: true, actionId: record.id, dryRun: provider.kind === "dry-run", callsUsed: mine };
  }

  /**
   * Read an action, asking CALL-E for a fresh answer while it is live. The
   * webhook is the fast path, not the only one: a lost delivery must not leave
   * a call "in progress" forever.
   */
  async refreshStatus(userId: string, actionId: string): Promise<ActionRecord | null> {
    const record = this.actions.get(actionId);
    if (!record || record.userId !== userId) return null; // an action id is not a capability
    const now = this.now().getTime();
    if (isLive(record.status) && record.providerCallId && now - record.polledAt > POLL_REFRESH_MS) {
      record.polledAt = now;
      const read = await this.options.provider.getCall(record.providerCallId);
      if (read.ok) this.persist(record, read.call);
    }
    return { ...record };
  }

  /**
   * CALL-E says a call ended. The body is a doorbell, not data: the secret path
   * is the only authentication, so the body only says WHICH call to look at, and
   * the result always comes from an authenticated read with our own key.
   */
  async handleWebhook(input: { pathSecret: string; eventId?: string | null; body: unknown }): Promise<{ status: number; body: Record<string, unknown> }> {
    if (!this.options.webhook || !secretsMatch(input.pathSecret, this.options.webhook.secret)) {
      return { status: 401, body: { error: "unauthorized" } };
    }
    const event = (input.body ?? {}) as { id?: unknown; data?: { id?: unknown; metadata?: { action_id?: unknown } } };
    const eventId = input.eventId || (typeof event.id === "string" ? event.id : "");
    if (eventId) {
      if (this.events.has(eventId)) return { status: 200, body: { ok: true, duplicate: true } };
      this.events.add(eventId); // recorded before acting, so a repeat delivery is a no-op
    }

    const actionId = event.data?.metadata?.action_id;
    const callId = event.data?.id;
    const record =
      typeof actionId === "string"
        ? this.actions.get(actionId)
        : [...this.actions.values()].find((action) => action.providerCallId === callId);
    // 200 for anything we can't act on, so CALL-E has no reason to redeliver.
    if (!record?.providerCallId) return { status: 200, body: { ok: true, unknown: true } };
    if (!isLive(record.status)) return { status: 200, body: { ok: true, alreadyFinal: true } };

    const read = await this.options.provider.getCall(record.providerCallId);
    if (!read.ok) return { status: 200, body: { ok: true, deferred: true } };
    this.persist(record, read.call);
    return { status: 200, body: { ok: true } };
  }

  callsUsed(userId: string): number {
    return this.usage.get(`${userId}|${this.now().toISOString().slice(0, 7)}`) ?? 0;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private bump(key: string, delta: number): number {
    const next = Math.max(0, (this.usage.get(key) ?? 0) + delta);
    this.usage.set(key, next);
    return next;
  }

  private persist(record: ActionRecord, call: CalleCall): void {
    const turns = call.recipients?.[0]?.attempts?.flatMap((attempt) => attempt.transcript_turns ?? []) ?? [];
    const finished = call.status === "completed" || call.status === "failed" || call.status === "canceled";
    record.status = finished ? (call.status as ActionStatus) : "in_progress";
    record.summary = call.summary ? maskText(call.summary) : null;
    const structured = call.structured_result ?? call.recipients?.[0]?.structured_result ?? null;
    record.structured = structured ? JSON.parse(maskText(JSON.stringify(structured))) : null;
    record.transcript = turns.length
      ? turns.map((turn) => `${turn.speaker === "bot" ? "Tadah" : "Them"}: ${maskText(turn.text)}`).join("\n")
      : null;
    record.failureCode = call.failure_code ? maskText(call.failure_code) : null;
  }
}
