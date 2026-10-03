import { normalizePhones } from "./phone";
import type { CalleV4Config } from "./config";

export type CallPolicy = {
  maxRecipients: number;
  requireConsent: boolean;
  blockSecrets: boolean;
};

const DEFAULTS: CallPolicy = {
  maxRecipients: 20,
  requireConsent: true,
  blockSecrets: true,
};

const SECRET_PATTERN =
  /(password|passcode|otp|one-time code|credit card|bank account|social security|pin\b|cvv)/i;

export function enforcePolicy(
  task: string,
  phones: string[],
  policy: CallPolicy = DEFAULTS,
  opts?: { consent?: boolean; region?: string; allowedRegions?: string[] },
): string[] {
  if (policy.blockSecrets && SECRET_PATTERN.test(task)) {
    throw new Error("Task requests sensitive credentials and is blocked");
  }
  if (policy.requireConsent && opts?.consent !== true) {
    throw new Error("Explicit recipient consent is required");
  }
  if (opts?.region && opts.allowedRegions && opts.allowedRegions.length > 0) {
    if (!opts.allowedRegions.includes(opts.region.toUpperCase())) {
      throw new Error(`Recipient region ${opts.region} is not allowed`);
    }
  }
  const normalized = normalizePhones(phones);
  if (normalized.length === 0) {
    throw new Error("At least one E.164 recipient is required");
  }
  if (normalized.length > policy.maxRecipients) {
    throw new Error("Recipient limit exceeded");
  }
  return normalized;
}

export function consentGranted(metadata?: Record<string, string>): boolean {
  return metadata?.consent === "true";
}

export function regionFromMetadata(metadata?: Record<string, string>): string | undefined {
  return metadata?.region?.toUpperCase();
}

export function policyFromConfig(config: CalleV4Config): { allowedRegions: string[] } {
  return { allowedRegions: config.allowedRegions };
}
