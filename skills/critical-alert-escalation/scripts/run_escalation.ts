// Reference implementation of the critical-alert-escalation pattern.
//
// Given an alert, an ordered on-call contact chain, and an acknowledgment schema,
// this places calls through CALL-E (plan_call -> run_call -> get_call_run) in chain
// order until a human acknowledges, escalating on anything short of a confident
// ack ("fail toward escalation"), and notifying the owner if the chain is exhausted.
//
// Single guarded entry point: `runEscalation`. The raw plan_call/run_call/
// get_call_run MCP tools are reached only through the `calle` CLI here, never
// exposed to the calling model. Auth is the CLI browser-login state (no API key).
//
// ENFORCED SAFETY GATES (not documentation — code):
//   1. E.164 validation      — reject non ^\+[1-9]\d{1,14}$ numbers before dialing.
//   2. Live-enable + confirm — default DRY-RUN. A live call needs BOTH the env
//                              opt-in (CALLE_LIVE=1) AND an explicit confirmLiveCall.
//                              Placing a live call is impossible without both.
//   3. Stable idempotency    — deterministic key per (alertId, contact, attempt),
//                              passed to plan_call/run_call so a retry can't double-dial.
//   4. Ambiguous reconcile   — an ambiguous/non-terminal leg is re-polled to a terminal
//                              state; if still unresolved, STOP + flag (never advance).
//   5. Between-legs check     — before each leg, verify the alert isn't already
//                              acknowledged/resolved out-of-band; if it is, halt.
//   6. Authoritative ack only — acknowledged requires task_completed===true AND
//                              confidence>=threshold AND evidence. A bare
//                              acknowledged:true is NOT sufficient. Else -> escalate.
//
// This is a generic reference — wire your own alert source, contact chain, and
// owner-notification. Numbers in examples are fictional.

import { spawn } from "node:child_process";

export type Alert = { id: string; title: string; detail: string; recommendation: string };
export type Contact = { role: string; phone_e164: string; order: number };

export type AckResult = {
  reached: boolean;
  acknowledged: boolean;
  responder_role: string;
  action_taken: string;
  notes: string;
  // gate metadata (present when a gate short-circuited or a leg was inconclusive)
  blocked?: boolean;      // failed E.164 / allowlist / alert-status gate — not dialed
  dry_run?: boolean;      // live calling disabled — previewed, not dialed (gate 2)
  ambiguous?: boolean;    // no terminal outcome (gate 4)
  resolved?: boolean;     // for an ambiguous leg: did reconciliation reach terminal?
  idempotency_key?: string;
};

const ACK_SCHEMA = {
  type: "object",
  properties: {
    reached: { type: "boolean" },
    acknowledged: { type: "boolean" },
    responder_role: { type: "string" },
    action_taken: { type: "string" },
    notes: { type: "string" },
  },
  required: ["reached", "acknowledged"],
} as const;

// CALL-E's guide asks callers to identify their source/integration on every call.
const CALLE_ENV = { CALLE_SOURCE: "skills_sh", CALLE_INTEGRATION: "skills_sh_skill", CALLE_INTEGRATION_VERSION: "0.1.0" };

// ---------------------------------------------------------------------------
// Gate 1 — E.164 validation.
// ---------------------------------------------------------------------------
export const E164_RE = /^\+[1-9]\d{1,14}$/;
export function isValidE164(phone: unknown): boolean {
  return typeof phone === "string" && E164_RE.test(phone.trim());
}

// ---------------------------------------------------------------------------
// Gate 2 — live-enable + confirmation. BOTH are required to place a live call:
// the environment opt-in (CALLE_LIVE=1) and an explicit per-run confirmation.
// Default is dry-run: without both, no call is ever spawned.
// ---------------------------------------------------------------------------
export const LIVE_ENV_FLAG = "CALLE_LIVE";
export function liveCallAllowed(env: NodeJS.ProcessEnv, confirmLiveCall: boolean): boolean {
  return env?.[LIVE_ENV_FLAG] === "1" && confirmLiveCall === true;
}

// ---------------------------------------------------------------------------
// Gate 3 — stable idempotency key per (alertId, contact, attempt). Deterministic:
// the same inputs always produce the same key, so a retry of the same leg reuses it
// and CALL-E can dedup instead of double-dialing.
// ---------------------------------------------------------------------------
export function idempotencyKey(alertId: string, phoneE164: string, attempt: number): string {
  const safe = (s: string) => String(s).replace(/[^A-Za-z0-9+._-]/g, "_");
  return `cae:${safe(alertId)}:${safe(phoneE164)}:${attempt}`;
}

// ---------------------------------------------------------------------------
// Gate 6 — authoritative acknowledgment.
// ---------------------------------------------------------------------------
export const ACK_CONFIDENCE_THRESHOLD = 0.7;

function calle(args: string[], timeoutMs = 180_000): Promise<any> {
  const [cmd, argv]: [string, string[]] =
    process.platform === "win32" ? ["cmd", ["/c", "calle", ...args, "--json"]] : ["calle", [...args, "--json"]];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { env: { ...process.env, ...CALLE_ENV } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => { child.kill(); reject(new Error(`calle ${args.join(" ")} timed out`)); }, timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(`calle ${args.join(" ")} failed: ${err || out}`));
      try {
        const j = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
        // Unwrap the MCP content-text envelope if present.
        const text = j?.result?.content?.find?.((c: any) => typeof c?.text === "string")?.text;
        resolve(text ? JSON.parse(text) : j);
      } catch (e) {
        reject(new Error(`calle ${args.join(" ")} unparseable: ${out.slice(0, 200)}`));
      }
    });
  });
}

const TERMINAL = /(complete|completed|done|finished|ended|success|failed|error|no[_-]?answer|busy|cancel|reject|voicemail|declin|unavailable)/i;
const NEGATIVE = /no[_-]?answer|voicemail|busy|expired|cancel|fail|error|unavailable|declin/i;

function hasEvidence(outcome: any, result: any): boolean {
  const ev = outcome?.evidence ?? result?.evidence;
  if (Array.isArray(ev)) return ev.some((e) => String(e ?? "").trim().length > 0);
  return typeof ev === "string" && ev.trim().length > 0;
}

/**
 * Map CALL-E's outcome envelope to a boolean ack — AUTHORITATIVE ACK ONLY (gate 6).
 * `acknowledged` is true ONLY when task_completed === true AND confidence meets the
 * threshold AND there is evidence. A bare `acknowledged:true` in the payload is NOT
 * sufficient and is ignored. A terminal negative status, low confidence, missing
 * evidence, or task_completed !== true all count as NOT acknowledged (fail toward
 * escalation).
 */
export function interpretAck(status: string, result: any, role: string, threshold = ACK_CONFIDENCE_THRESHOLD): AckResult {
  const s = String(status ?? "").toLowerCase();
  const notes = String(result?.summary ?? result?.notes ?? "");
  const negative = NEGATIVE.test(s);
  if (negative) {
    return { reached: /declin|reject/.test(s), acknowledged: false, responder_role: role, action_taken: "", notes: notes || s };
  }

  const outcome = result?.outcome ?? {};
  const taskCompleted = outcome?.task_completed === true;
  const conf = outcome?.completion_confidence ?? outcome?.confidence ?? {};
  const score = Number(conf?.score ?? (typeof conf === "number" ? conf : NaN));
  const label = String(conf?.label ?? "").toLowerCase();
  const confidenceOk = (Number.isFinite(score) && score >= threshold) || label === "high";
  const evidence = hasEvidence(outcome, result);

  // Bare `acknowledged:true` is deliberately NOT part of this decision.
  const acknowledged = taskCompleted && confidenceOk && evidence;

  const reached = typeof result?.reached === "boolean" ? result.reached : taskCompleted || acknowledged;
  return {
    reached,
    acknowledged,
    responder_role: role,
    action_taken: String(result?.action_taken ?? outcome?.action_taken ?? ""),
    notes,
  };
}

function goalFor(alert: Alert, role: string, disclosure: string): string {
  return (
    `${disclosure} ${alert.title}. ${alert.detail}. Recommendation: ${alert.recommendation}. ` +
    `This is a classification and recommendation, not a diagnosis or instruction. ` +
    `Please confirm you have received this alert as the ${role}, and say what action you will take. ` +
    `If you cannot take it, say so and it will be escalated to the next responder. ` +
    `When the call concludes, return ONLY a JSON object matching: ${JSON.stringify(ACK_SCHEMA)}`
  );
}

type LegConfig = { disclosure: string; timezone: string; live: boolean; attempt: number };

/**
 * Place and resolve ONE guarded call. Enforces gate 2 (never spawns unless `live`),
 * gate 3 (idempotency key on plan + run), and gate 4 (poll + reconcile to terminal).
 * Returns an AckResult; `ambiguous:true, resolved:false` means the outcome could not
 * be resolved and the caller MUST stop rather than advance.
 */
async function placeCall(alert: Alert, c: Contact, cfg: LegConfig): Promise<AckResult> {
  const key = idempotencyKey(alert.id, c.phone_e164, cfg.attempt);

  // Gate 2: dry-run unless a live call is explicitly enabled. No spawn here.
  if (!cfg.live) {
    return {
      reached: false, acknowledged: false, responder_role: c.role, action_taken: "",
      dry_run: true, idempotency_key: key,
      notes: `dry-run: live calling disabled (set ${LIVE_ENV_FLAG}=1 and pass confirmLiveCall). Would call ${c.role} ${c.phone_e164}.`,
    };
  }

  const plan = await calle(["call", "plan", "--to-phone", c.phone_e164, "--goal", goalFor(alert, c.role, cfg.disclosure), "--timezone", cfg.timezone, "--idempotency-key", key]);
  const planId = plan.plan_id ?? plan.planId;
  const token = plan.confirm_token ?? plan.confirmToken;
  if (!planId || !token) return { reached: false, acknowledged: false, responder_role: c.role, action_taken: "", idempotency_key: key, notes: "plan_call did not return plan id + confirm token" };

  const run = await calle(["call", "run", "--plan-id", planId, "--confirm-token", token, "--timezone", cfg.timezone, "--idempotency-key", key]);
  const runId = run.run_id ?? run.runId ?? run.id;
  let status = String(run.status ?? "RUNNING");
  let payload: any = run;

  if (!runId) return { reached: false, acknowledged: false, responder_role: c.role, action_taken: "", idempotency_key: key, notes: "run_call did not return a run id" };

  // Gate 4, part 1: poll get_call_run until terminal or the primary deadline.
  const deadline = Date.now() + 8 * 60_000;
  while (!TERMINAL.test(status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10_000));
    payload = await calle(["call", "status", "--run-id", runId, "--timezone", cfg.timezone], 60_000);
    status = String(payload.status ?? status);
  }

  // Gate 4, part 2: if still not terminal, RECONCILE — a bounded set of extra polls
  // to let an in-flight leg settle before we decide anything.
  if (!TERMINAL.test(status)) {
    for (let i = 0; i < 6 && !TERMINAL.test(status); i++) {
      await new Promise((r) => setTimeout(r, 15_000));
      payload = await calle(["call", "status", "--run-id", runId, "--timezone", cfg.timezone], 60_000);
      status = String(payload.status ?? status);
    }
  }

  // Still ambiguous after reconciliation → do NOT guess. Flag it and stop.
  if (!TERMINAL.test(status)) {
    return {
      reached: false, acknowledged: false, responder_role: c.role, action_taken: "",
      ambiguous: true, resolved: false, idempotency_key: key,
      notes: `ambiguous: run ${runId} never reached a terminal state (last status: ${status}). Stopped for manual review.`,
    };
  }

  const ack = interpretAck(status, payload.result ?? payload, c.role);
  ack.idempotency_key = key;
  return ack;
}

/** Guarded entry point: call the chain in order until acknowledged. */
export async function runEscalation(opts: {
  alert: Alert;
  contactChain: Contact[];
  disclosure: string;
  timezone?: string;
  isAllowlisted: (phone: string) => boolean;
  isAlertResolved: (alertId: string) => Promise<boolean> | boolean; // gate 5
  notifyOwner: (alert: Alert, attempts: AckResult[]) => Promise<void> | void;
  confirmLiveCall?: boolean;             // gate 2 — explicit per-run confirmation
  env?: NodeJS.ProcessEnv;               // gate 2 — env source (defaults to process.env)
  _placeCall?: typeof placeCall;         // test seam; defaults to the guarded placeCall
}): Promise<{ outcome: "acknowledged" | "unacknowledged" | "already_resolved" | "unresolved" | "dry_run"; attempts: AckResult[] }> {
  const tz = opts.timezone ?? "UTC";
  const env = opts.env ?? process.env;
  const live = liveCallAllowed(env, opts.confirmLiveCall === true); // gate 2
  const doCall = opts._placeCall ?? placeCall;
  const chain = [...opts.contactChain].sort((a, b) => a.order - b.order);
  const attempts: AckResult[] = [];

  let leg = 0;
  for (const c of chain) {
    // Gate 5: before EACH leg, stop if the alert was acknowledged/resolved out-of-band.
    if (await opts.isAlertResolved(opts.alert.id)) {
      attempts.push({ reached: false, acknowledged: false, responder_role: c.role, action_taken: "", blocked: true, notes: "alert already acknowledged/resolved out-of-band — halting before dialing" });
      return { outcome: "already_resolved", attempts };
    }
    // Gate 1: reject non-E.164 numbers before dialing.
    if (!isValidE164(c.phone_e164)) {
      attempts.push({ reached: false, acknowledged: false, responder_role: c.role, action_taken: "", blocked: true, notes: `blocked: "${c.phone_e164}" is not a valid E.164 number (^\\+[1-9]\\d{1,14}$)` });
      continue;
    }
    // Allowlist invariant.
    if (!opts.isAllowlisted(c.phone_e164)) {
      attempts.push({ reached: false, acknowledged: false, responder_role: c.role, action_taken: "", blocked: true, notes: `blocked: ${c.phone_e164} not on allowlist` });
      continue;
    }

    leg += 1;
    const ack = await doCall(opts.alert, c, { disclosure: opts.disclosure, timezone: tz, live, attempt: leg });
    attempts.push(ack);

    if (ack.acknowledged) return { outcome: "acknowledged", attempts };

    // Gate 4: an unresolved-ambiguous leg halts the whole escalation and flags for
    // review — we never advance the chain on an outcome we couldn't resolve.
    if (ack.ambiguous && ack.resolved === false) {
      await opts.notifyOwner(opts.alert, attempts);
      return { outcome: "unresolved", attempts };
    }
  }

  // Gate 2: a dry-run never dials, never escalates — it's a safe preview of the chain.
  if (!live) return { outcome: "dry_run", attempts };

  await opts.notifyOwner(opts.alert, attempts); // chain exhausted — escalate out of band
  return { outcome: "unacknowledged", attempts };
}
