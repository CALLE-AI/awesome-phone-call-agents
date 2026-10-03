import { CALLE_CAPABILITY } from "./capabilities";
import type { CalleConfig } from "./config";

/** Adapter-derived capability matrix — never claim unsupported SDK features. */
export type CallProviderCapabilities = {
  provider: string;
  providerVersion: string;
  runtime: "demo" | "dry_run" | "live" | "disabled";
  outboundDialing: boolean;
  statusPolling: boolean;
  webhooks: boolean;
  structuredResults: boolean;
  transfer: boolean;
  recordingMetadata: boolean;
  cancellation: boolean;
  supportedLocales: string[];
  supportedRegions: string[];
  unsupportedActions: { action: string; reason: string }[];
};

export function getDemoProviderCapabilities(): CallProviderCapabilities {
  return {
    provider: "fake-calle-runtime",
    providerVersion: "v4-demo",
    runtime: "demo",
    outboundDialing: true,
    statusPolling: true,
    webhooks: false,
    structuredResults: true,
    transfer: false,
    recordingMetadata: false,
    cancellation: true,
    supportedLocales: [...CALLE_CAPABILITY.supportedCallLanguages],
    supportedRegions: [...CALLE_CAPABILITY.supportedRegions],
    unsupportedActions: [
      { action: "live_transfer", reason: "Demo runtime simulates handoff only." },
      { action: "carrier_dial", reason: "Demo mode cannot reach real carrier." },
    ],
  };
}

export function getDryRunProviderCapabilities(): CallProviderCapabilities {
  return {
    provider: CALLE_CAPABILITY.provider,
    providerVersion: CALLE_CAPABILITY.providerVersion,
    runtime: "dry_run",
    outboundDialing: false,
    statusPolling: false,
    webhooks: CALLE_CAPABILITY.webhookSupported,
    structuredResults: true,
    transfer: false,
    recordingMetadata: false,
    cancellation: CALLE_CAPABILITY.cancelSupported,
    supportedLocales: [...CALLE_CAPABILITY.supportedCallLanguages],
    supportedRegions: [...CALLE_CAPABILITY.supportedRegions],
    unsupportedActions: [
      { action: "outbound_dial", reason: "Dry-run does not place live calls." },
      { action: "transfer", reason: "Not exposed in current SDK." },
      { action: "cancel_provider", reason: "Cancel is local-only in SDK 0.7.x." },
    ],
  };
}

export function getLiveProviderCapabilities(config: CalleConfig): CallProviderCapabilities {
  const canDial =
    config.configured && config.liveCallsEnabled && !config.killSwitch && !config.demoMode;
  return {
    provider: CALLE_CAPABILITY.provider,
    providerVersion: CALLE_CAPABILITY.providerVersion,
    runtime: config.killSwitch ? "disabled" : "live",
    outboundDialing: canDial,
    statusPolling: CALLE_CAPABILITY.pollingSupported,
    webhooks: CALLE_CAPABILITY.webhookSupported,
    structuredResults: true,
    transfer: false,
    recordingMetadata: false,
    cancellation: CALLE_CAPABILITY.cancelSupported,
    supportedLocales: [...CALLE_CAPABILITY.supportedCallLanguages],
    supportedRegions: [...CALLE_CAPABILITY.supportedRegions],
    unsupportedActions: [
      ...(canDial
        ? []
        : [{ action: "outbound_dial", reason: "Live dialing not enabled or demo mode active." }]),
      { action: "transfer", reason: "Not exposed in current SDK." },
      { action: "cancel_provider", reason: "Cancel is local-only in SDK 0.7.x." },
    ],
  };
}

export function resolveProviderCapabilities(config: CalleConfig): CallProviderCapabilities {
  if (config.demoMode) return getDemoProviderCapabilities();
  if (config.mode === "live") return getLiveProviderCapabilities(config);
  if (config.killSwitch) {
    return { ...getDryRunProviderCapabilities(), runtime: "disabled", outboundDialing: false };
  }
  return getDryRunProviderCapabilities();
}
