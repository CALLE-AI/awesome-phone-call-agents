import { hasLiveSecurityConfiguration } from "../live-security.ts";

export type CalleCapabilityBindings = {
  CALLE_MODE?: string;
  CALLE_API_KEY?: string;
  SPARESCOUT_APPROVAL_SECRET?: string;
  SPARESCOUT_OPERATOR_TOKEN?: string;
  SPARESCOUT_LIVE_RECIPIENT_ALLOWLIST?: string;
};

export function calculateCalleCapabilities(runtime: CalleCapabilityBindings) {
  return {
    fixtureAvailable: true,
    liveAvailable:
      runtime.CALLE_MODE === "live" &&
      Boolean(runtime.CALLE_API_KEY && runtime.SPARESCOUT_APPROVAL_SECRET) &&
      hasLiveSecurityConfiguration(runtime),
  };
}
