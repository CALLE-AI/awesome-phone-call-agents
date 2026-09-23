import { ENV } from "../_core/env";
import { loadCalleConfig } from "./config";

/** V4 master feature flags — safe defaults for fresh checkout. */
export type V4FeatureFlags = {
  callEEnabled: boolean;
  aiEnabled: boolean;
  demoMode: boolean;
  liveCallsEnabled: boolean;
  killSwitch: boolean;
  mode: "demo" | "dry_run" | "live" | "disabled";
  safeDefault: boolean;
};

export function loadV4FeatureFlags(env: typeof ENV = ENV): V4FeatureFlags {
  const config = loadCalleConfig(env);
  const callEEnabled = env.calleEnabled;
  const aiEnabled = env.aiEnabled;
  const safeDefault = config.demoMode && !config.liveCallsEnabled && !config.configured;

  return {
    callEEnabled,
    aiEnabled,
    demoMode: config.demoMode,
    liveCallsEnabled: config.liveCallsEnabled,
    killSwitch: config.killSwitch,
    mode: config.mode,
    safeDefault,
  };
}

export function getPublicV4Flags(env: typeof ENV = ENV) {
  const flags = loadV4FeatureFlags(env);
  return {
    callEEnabled: flags.callEEnabled,
    aiEnabled: flags.aiEnabled,
    demoMode: flags.demoMode,
    mode: flags.mode,
    safeDefault: flags.safeDefault,
    indicator: flags.demoMode ? "DEMO" : flags.mode === "live" ? "LIVE_ELIGIBLE" : "DRY_RUN",
  };
}

export function assertCallEEnabled(env: typeof ENV = ENV): void {
  if (!env.calleEnabled) {
    throw new Error("CALL_E_ENABLED is false; phone workflows are disabled.");
  }
}
