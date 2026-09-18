import { ENV } from "../_core/env";
import { loadCalleConfig } from "./config";
import { isDemoMode } from "./demo-mode";

export type ConfigIssue = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
};

export type ConfigValidation = {
  ok: boolean;
  mode: string;
  issues: ConfigIssue[];
};

/** Validates server config without exposing secrets. */
export function validateCalleConfig(env: typeof ENV = ENV): ConfigValidation {
  const config = loadCalleConfig(env);
  const issues: ConfigIssue[] = [];

  if (!env.calleEnabled) {
    issues.push({
      code: "call_e_disabled",
      severity: "warning",
      message: "CALL_E_ENABLED=false — phone workflows disabled.",
    });
  }

  if (isDemoMode(env)) {
    issues.push({
      code: "demo_mode",
      severity: "info",
      message: "Demo mode active — live provider unreachable (fail-closed).",
    });
  }

  if (config.killSwitch) {
    issues.push({
      code: "kill_switch",
      severity: "error",
      message: "CALLE_KILL_SWITCH is on — outbound calling disabled.",
    });
  }

  if (config.liveCallsEnabled && !config.configured) {
    issues.push({
      code: "missing_api_key",
      severity: "error",
      message: "CALLE_LIVE_CALLS=true but CALLE_API_KEY is missing.",
    });
  }

  if (config.liveCallsEnabled && isDemoMode(env)) {
    issues.push({
      code: "demo_live_conflict",
      severity: "error",
      message: "Cannot enable live calls while CALLE_DEMO_MODE is on.",
    });
  }

  if (!env.aiEnabled) {
    issues.push({
      code: "ai_disabled",
      severity: "info",
      message: "AI_ENABLED=false — rule-based planners/briefs only.",
    });
  }

  const blocking = issues.some((i) => i.severity === "error");
  return { ok: !blocking, mode: config.mode, issues };
}
