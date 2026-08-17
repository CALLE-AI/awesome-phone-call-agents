import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CompiledCallback } from "./core.js";

const execFileAsync = promisify(execFile);
export type Runner = (args: string[]) => Promise<unknown>;

export async function defaultRunner(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync(process.env.CALLE_CLI_BIN || "calle", args, {
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer: 3_000_000,
    windowsHide: true,
    env: { ...process.env, CALLE_TELEMETRY: "0" }
  });
  return JSON.parse(stdout);
}

function unwrap(value: any): any {
  return value?.result?.structuredContent || value?.result || value?.structuredContent || value;
}

export async function createPlan(compiled: CompiledCallback, runner: Runner = defaultRunner) {
  const envelope = await runner([
    "mcp", "call", "plan_call", "--args-json", JSON.stringify(compiled.mcp_plan_args),
    "--timeout-seconds", "35", "--no-telemetry", "--json"
  ]);
  const plan = unwrap(envelope);
  if (!plan?.plan_id || !plan?.confirm_token) throw new Error("CALL-E returned an incomplete plan.");
  return {
    plan_id: String(plan.plan_id),
    confirm_token: String(plan.confirm_token),
    ready_to_run: plan.ready_to_run === true,
    summary: String(plan.summary || plan.plan_summary || "CALL-E plan created."),
    workflow_hash: compiled.workflow_hash,
    masked_phone: compiled.masked_phone,
    approval_phrase: compiled.approval_phrase,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    consumed: false
  };
}

export async function runPlan(
  plan: any,
  approval: string,
  runner: Runner = defaultRunner,
  liveEnabled = process.env.ALLOW_LIVE_CALLS === "1"
) {
  if (liveEnabled !== true) throw new Error("Live calls are disabled. Set ALLOW_LIVE_CALLS=1 only for an approved test window.");
  if (plan?.consumed === true) throw new Error("This plan has already been consumed.");
  const expiresAt = new Date(plan?.expires_at).valueOf();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("This plan has expired. Create and review a new one.");
  if (approval !== plan?.approval_phrase) {
    throw new Error(`Exact action-time approval is required: ${plan?.approval_phrase || "missing"}`);
  }
  // Consume before the network boundary. An ambiguous transport failure must
  // require a status check, never an automatic retry that could double-dial.
  plan.consumed = true;
  plan.dispatch_attempted_at = new Date().toISOString();
  const envelope = await runner([
    "mcp", "call", "run_call", "--args-json",
    JSON.stringify({ plan_id: plan.plan_id, confirm_token: plan.confirm_token, ttl_seconds: 600 }),
    "--timeout-seconds", "35", "--no-telemetry", "--json"
  ]);
  const result = unwrap(envelope);
  if (!result?.run_id) throw new Error("CALL-E did not return a run id.");
  return { run_id: String(result.run_id), consumed: true };
}
