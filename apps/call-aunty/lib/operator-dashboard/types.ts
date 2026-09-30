/** Client-safe operator dashboard types. Synthetic identities only. */

export type OperatorBucket =
  | "pending"
  | "active"
  | "completed"
  | "blocked"
  | "failed"
  | "needs_review";

export type OperatorPhoneStatus =
  | "draft"
  | "approved"
  | "queued"
  | "dialing"
  | "ringing"
  | "connected"
  | "in_progress"
  | "completed"
  | "no_answer"
  | "busy"
  | "voicemail"
  | "failed"
  | "canceled"
  | "blocked"
  | "needs_review";

export type OperatorPurpose =
  | "follow_up_after_check_in"
  | "appointment_coordination"
  | "callback_confirmation";

export type OperatorIncidentKind =
  | "failover"
  | "consent_block"
  | "safety"
  | "timeout"
  | "provider_outage"
  | "replay";

export type ProviderCircuitState = "closed" | "open" | "half_open";

export type OperatorDashboardCall = {
  id: string;
  bucket: OperatorBucket;
  phoneStatus: OperatorPhoneStatus;
  purpose: OperatorPurpose;
  womanId: string;
  recipientMasked: string;
  status: string;
  policyDecision: "allow" | "dry_run" | "deny";
  dryRun: boolean;
  attemptCount: number;
  canRetry: boolean;
  failureCode: string | null;
  phoneProviderId: string | null;
  failoverAttempts: number;
  replayId: string | null;
  updatedAt: string;
  createdAt: string;
};

export type OperatorProviderHealth = {
  id: string;
  circuit: ProviderCircuitState;
  consecutiveFailures: number;
  acceptedCalls: number;
  lastFailureCode: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
};

export type OperatorIncident = {
  kind: OperatorIncidentKind;
  workflowId: string;
  summary: string;
  fromProvider?: string;
  toProvider?: string;
};

export type OperatorDashboardFixture = {
  id: string;
  title: string;
  purpose: string;
  synthetic: true;
  replayId?: string;
  call: OperatorDashboardCall;
  incident?: OperatorIncident;
};

export type OperatorDashboardSnapshot = {
  summary: Record<OperatorBucket, number>;
  calls: OperatorDashboardCall[];
  providerHealth: OperatorProviderHealth[];
  incidents: OperatorIncident[];
};
