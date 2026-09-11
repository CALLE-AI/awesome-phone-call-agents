import type { McpClientConfig } from "@call-e/core/mcp-client";
import { planCall as defaultPlanCall, type PlanCallResult } from "./calle-mcp.js";
import { assertE164 } from "./phone-safety.js";
import { clearPendingPlan, savePendingPlan } from "./pending-plan.js";

export interface PlanRequest {
  to: string;
  region: string;
  goal: string;
}

export type PlanCallFn = typeof defaultPlanCall;

/**
 * Validates and plans a call, saving it as the pending plan only if it came
 * back ready to run.
 *
 * Clears any previously pending plan first, unconditionally — before
 * validation, before the network call, regardless of how this attempt turns
 * out. Without that, a re-plan that fails E.164 validation, fails on the
 * network, or comes back `ready_to_run: false` would leave whatever was
 * planned *before* it still fully authorized, and "call --live" would
 * silently execute that stale, already-superseded call instead of the one
 * just reviewed.
 */
export async function planAndSave(
  config: McpClientConfig,
  request: PlanRequest,
  planCallFn: PlanCallFn = defaultPlanCall,
): Promise<PlanCallResult> {
  clearPendingPlan();
  assertE164(request.to, "--to");

  const plan = await planCallFn(config, {
    toPhones: [request.to],
    region: request.region,
    goal: request.goal,
  });

  if (plan.ready_to_run && plan.confirm_token) {
    savePendingPlan({
      planId: plan.plan_id,
      confirmToken: plan.confirm_token,
      toPhones: [request.to],
      region: request.region,
      goal: request.goal,
      createdAt: new Date().toISOString(),
    });
  }

  return plan;
}
