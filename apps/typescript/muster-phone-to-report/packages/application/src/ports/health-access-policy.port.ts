export interface HealthAccessContext {
  readonly listenerScope: "loopback" | "non-loopback" | "unknown";
  readonly peerScope: "loopback" | "non-loopback" | "unknown";
  readonly harnessAuthorized: boolean;
  readonly internalPolicyAuthorized: boolean;
}

export type HealthAccessDecision = "allowed" | "denied";

export interface HealthAccessPolicy {
  evaluate(context: HealthAccessContext): Promise<HealthAccessDecision>;
}
