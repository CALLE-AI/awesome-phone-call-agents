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
// This is a generic reference — wire your own alert source, contact chain, and
// owner-notification. Numbers in examples are fictional.

import { spawn } from "node:child_process";

export type Alert = { title: string; detail: string; recommendation: string };
export type Contact = { role: string; phone_e164: string; order: number };

export type AckResult = {
  reached: boolean;
  acknowledged: boolean;
  responder_role: string;
  action_taken: string;
  notes: string;
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

/**
 * Map CALL-E's outcome envelope to a boolean ack. Acknowledged only on a confident
 * completion; a terminal negative status, low confidence, or an explicit
 * acknowledged=false all count as NOT acknowledged (fail toward escalation).
 */
export function interpretAck(status: string, result: any, role: string): AckResult {
  const s = String(status ?? "").toLowerCase();
  const notes = String(result?.summary ?? result?.notes ?? "");
  const negative = /no[_-]?answer|voicemail|busy|expired|cancel|fail|error|unavailable|declin/.test(s);
  if (negative) return { reached: /declin|reject/.test(s), acknowledged: false, responder_role: role, action_taken: "", notes: notes || s };

  const explicit = result?.acknowledged;
  const confidenceHigh = (result?.outcome?.completion_confidence?.label ?? "").toLowerCase() === "high"
    || Number(result?.outcome?.completion_confidence?.score ?? 0) >= 0.7;
  const taskCompleted = result?.outcome?.task_completed === true;
  const acknowledged = typeof explicit === "boolean" ? explicit : taskCompleted && confidenceHigh;
  return {
    reached: acknowledged || true,
    acknowledged,
    responder_role: role,
    action_taken: String(result?.action_taken ?? ""),
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

async function callOne(alert: Alert, c: Contact, disclosure: string, timezone: string): Promise<AckResult> {
  const plan = await calle(["call", "plan", "--to-phone", c.phone_e164, "--goal", goalFor(alert, c.role, disclosure), "--timezone", timezone]);
  const planId = plan.plan_id ?? plan.planId;
  const token = plan.confirm_token ?? plan.confirmToken;
  if (!planId || !token) return { reached: false, acknowledged: false, responder_role: c.role, action_taken: "", notes: "plan_call did not return plan id + confirm token" };

  const run = await calle(["call", "run", "--plan-id", planId, "--confirm-token", token, "--timezone", timezone]);
  const runId = run.run_id ?? run.runId ?? run.id;
  let status = run.status ?? "RUNNING";
  let payload: any = run;

  const deadline = Date.now() + 8 * 60_000;
  while (runId && !TERMINAL.test(String(status)) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10_000));
    payload = await calle(["call", "status", "--run-id", runId, "--timezone", timezone], 60_000);
    status = payload.status ?? status;
  }
  return interpretAck(status, payload.result ?? payload, c.role);
}

/** Guarded entry point: call the chain in order until acknowledged. */
export async function runEscalation(opts: {
  alert: Alert;
  contactChain: Contact[];
  disclosure: string;
  timezone?: string;
  isAllowlisted: (phone: string) => boolean;
  notifyOwner: (alert: Alert, attempts: AckResult[]) => Promise<void> | void;
}): Promise<{ outcome: "acknowledged" | "unacknowledged"; attempts: AckResult[] }> {
  const tz = opts.timezone ?? "UTC";
  const chain = [...opts.contactChain].sort((a, b) => a.order - b.order);
  const attempts: AckResult[] = [];

  for (const c of chain) {
    if (!opts.isAllowlisted(c.phone_e164)) {
      attempts.push({ reached: false, acknowledged: false, responder_role: c.role, action_taken: "", notes: `blocked: ${c.phone_e164} not on allowlist` });
      continue;
    }
    const ack = await callOne(opts.alert, c, opts.disclosure, tz);
    attempts.push(ack);
    if (ack.acknowledged) return { outcome: "acknowledged", attempts };
  }

  await opts.notifyOwner(opts.alert, attempts); // chain exhausted — escalate out of band
  return { outcome: "unacknowledged", attempts };
}
