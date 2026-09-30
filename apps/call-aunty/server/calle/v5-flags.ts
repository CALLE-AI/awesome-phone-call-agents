import { ENV } from "../_core/env";
import { loadCalleConfig } from "./config";
import { isDemoMode } from "./demo-mode";

/** V5 typed feature flags — safe defaults for hackathon/demo checkout. */
export type V5FeatureFlags = {
  callEEnabled: boolean;
  aiEnabled: boolean;
  demoMode: boolean;
  simulatorMode: boolean;
  liveCalling: boolean;
  callReplay: boolean;
  advancedReview: boolean;
  safeDefault: boolean;
  mode: "demo" | "dry_run" | "live" | "disabled";
};

export function loadV5FeatureFlags(env: typeof ENV = ENV): V5FeatureFlags {
  const config = loadCalleConfig(env);
  const demoMode = isDemoMode(env);
  const simulatorMode = demoMode || !config.liveCallsEnabled;
  const liveCalling = config.mode === "live" && !demoMode && !config.killSwitch;

  return {
    callEEnabled: env.calleEnabled,
    aiEnabled: env.aiEnabled,
    demoMode,
    simulatorMode,
    liveCalling,
    callReplay: env.calleReplayEnabled,
    advancedReview: env.calleAdvancedReview,
    safeDefault: demoMode && !liveCalling,
    mode: config.mode,
  };
}

export function getPublicV5Flags(env: typeof ENV = ENV) {
  const f = loadV5FeatureFlags(env);
  return {
    callEEnabled: f.callEEnabled,
    aiEnabled: f.aiEnabled,
    demoMode: f.demoMode,
    simulatorMode: f.simulatorMode,
    liveCalling: f.liveCalling,
    callReplay: f.callReplay,
    advancedReview: f.advancedReview,
    safeDefault: f.safeDefault,
    mode: f.mode,
    indicator: f.demoMode ? "DEMO" : f.liveCalling ? "LIVE" : "DRY_RUN",
  };
}

export function assertLiveCallingAllowed(env: typeof ENV = ENV): void {
  const flags = loadV5FeatureFlags(env);
  if (flags.demoMode) {
    throw new Error("Live calling blocked: demo mode is active.");
  }
  if (!flags.liveCalling) {
    throw new Error("Live calling blocked: environment is not live-eligible.");
  }
}
