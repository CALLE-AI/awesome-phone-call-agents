import { ENV } from "../_core/env";

/** Explicit demo mode — fail closed: never reach live provider when enabled. */
export function isDemoMode(env: typeof ENV = ENV): boolean {
  return env.calleDemoMode;
}

export function getDemoPublicFlags(env: typeof ENV = ENV) {
  const demoMode = isDemoMode(env);
  const liveEligible = env.calleLiveCalls && env.calleApiKey.trim().length > 0 && !env.calleKillSwitch;
  return {
    demoMode,
    liveCallsBlockedByDemo: demoMode,
    indicator: demoMode ? "DEMO" : liveEligible ? "LIVE_ELIGIBLE" : "DRY_RUN",
  };
}
