export type SecurityDisposition =
  | "mock"
  | "live"
  | "unauthorized"
  | "disabled"
  | "kill_switch"
  | "origin_denied"
  | "recipient_denied"
  | "manual_review";

export type SecurityFacts = {
  hasApiKey: boolean;
  explicitLiveIntent: boolean;
  liveCallsEnabled: boolean;
  killSwitch: boolean;
  operatorAuthorized: boolean;
  loopback: boolean;
  recipientValid: boolean;
  recipientAuthorized: boolean;
  originApproved: boolean;
  providerHttps: boolean;
  redirectDetected: boolean;
};

export function classifySecurity(facts: SecurityFacts): SecurityDisposition {
  if (!facts.explicitLiveIntent) return "mock";
  if (!facts.operatorAuthorized) return "unauthorized";
  if (!facts.originApproved) return "origin_denied";
  if (!facts.liveCallsEnabled) return "disabled";
  if (facts.killSwitch) return "kill_switch";
  if (!facts.loopback) return "unauthorized";
  if (!facts.recipientValid || !facts.recipientAuthorized) return "recipient_denied";
  if (!facts.providerHttps || facts.redirectDetected) return "manual_review";
  if (!facts.hasApiKey) return "disabled";
  return "live";
}

export const SECURITY_RULES = Object.freeze([
  "api-key-is-not-intent",
  "api-key-is-not-authorization",
  "mock-is-default",
  "live-intent-is-explicit",
  "kill-switch-wins",
  "loopback-is-default-live-scope",
  "credentialed-origin-is-exact-match",
  "live-provider-is-https",
  "redirects-are-errors",
  "recipient-is-e164",
  "recipient-is-trusted",
  "live-errors-never-become-mock-success",
]);
