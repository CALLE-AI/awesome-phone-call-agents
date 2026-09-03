import { spawnSync } from "node:child_process";

export function runCalle(mode, plan, {runner=spawnSync, env=process.env, approvalId}={}) {
  if (!new Set(["plan","start"]).has(mode)) throw new Error("mode must be plan or start");
  if (Date.parse(plan.expires_at) <= Date.now()) throw new Error("plan expired");
  if (mode === "start") {
    if (env.PAYOUTPROOF_ENABLE_LIVE !== "1") throw new Error("live calls disabled; set PAYOUTPROOF_ENABLE_LIVE=1 only after exact authorization");
    if (approvalId !== plan.approval_id) throw new Error("approval_id mismatch");
  }
  const args=["call",mode,"--to-phone",plan.calle_args.to_phone,"--goal",plan.calle_args.goal];
  if (plan.calle_args.language) args.push("--language",plan.calle_args.language);
  if (plan.calle_args.region) args.push("--region",plan.calle_args.region);
  const out=runner("calle",args,{encoding:"utf8",env});
  if (out.error) throw new Error(`unable to run official calle CLI: ${out.error.message}`);
  if (out.status !== 0) throw new Error(`calle ${mode} failed (${out.status}): ${(out.stderr||"").trim()}`);
  let parsed; try { parsed=JSON.parse(out.stdout); } catch { throw new Error("calle output was not JSON"); }
  return parsed;
}
