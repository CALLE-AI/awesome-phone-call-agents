import type {
  HealthAccessContext,
  HealthAccessDecision,
  HealthAccessPolicy,
} from "@muster/application";

import type { HealthExposure } from "../config/configuration.js";

export function createHealthAccessPolicy(exposure: HealthExposure): HealthAccessPolicy {
  return Object.freeze({
    async evaluate(context: HealthAccessContext): Promise<HealthAccessDecision> {
      switch (exposure) {
        case "loopback":
          return context.listenerScope === "loopback" && context.peerScope === "loopback"
            ? "allowed"
            : "denied";
        case "test-harness":
          return context.harnessAuthorized ? "allowed" : "denied";
        case "internal-policy":
          return context.internalPolicyAuthorized ? "allowed" : "denied";
        case "disabled":
          return "denied";
      }
    },
  });
}
