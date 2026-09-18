export const DECISIONS = ["rollback", "scale", "ack", "escalate"] as const;
export type Decision = (typeof DECISIONS)[number];

export type IncidentStatus =
  | "gathering"
  | "calling"
  | "in_call"
  | "executing"
  | "resolved"
  | "escalated"
  | "failed"
  | "timeout"
  | "no_answer";

export type SpokenDecision = {
  decision: Decision | "unknown";
  scaleTo: number | null;
  confirmationOk: boolean;
  escalateTo: string | null;
  notes: string;
  raw: Record<string, unknown>;
};

export type TranscriptTurn = {
  offsetSeconds: number;
  speaker: string;
  text: string;
};

export type AuditEvent = {
  at: string;
  kind: string;
  detail: string;
  data?: unknown;
};

export type AwsSnapshot = {
  gatheredAt: string;
  accountId: string;
  callerArn: string;
  region: string;
  cluster: string;
  service: string;
  serviceStatus: string | null;
  runningCount: number | null;
  desiredCount: number | null;
  pendingCount: number | null;
  currentTaskDefinition: string | null;
  currentRevision: number | null;
  previousTaskDefinition: string | null;
  previousRevision: number | null;
  events: string[];
  alarm: {
    name: string | null;
    state: string | null;
    reason: string | null;
    updatedAt: string | null;
  };
  cpuPercent: number | null;
  target5xx: number | null;
  unhealthyTargets: number | null;
  securityGroup: {
    id: string;
    ingress: string[];
  } | null;
  recentLogs: string[];
};

export type ExecutionResult = {
  at: string;
  action: Decision;
  ok: boolean;
  command: string;
  output: string;
  error?: string;
};

export type Incident = {
  id: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  status: IncidentStatus;
  source: string;
  triggerReason: string;
  alarmName: string | null;
  confirmationCode: string;
  snapshot: AwsSnapshot | null;
  postActionSnapshot: AwsSnapshot | null;
  calleCallId: string | null;
  escalateCallId: string | null;
  resultCallId: string | null;
  webhookUrl: string | null;
  spoken: SpokenDecision | null;
  evidence: string[];
  transcript: TranscriptTurn[];
  execution: ExecutionResult | null;
  error: string | null;
  scenarioId: string | null;
  sayOnPhone: string | null;
  recommended: Decision | null;
  fixCommand: string | null;
  audit: AuditEvent[];
  attempts: number;
  timeoutAt: string;
};

export type CreateIncidentInput = {
  source: string;
  triggerReason: string;
  alarmName?: string | null;
  scenarioId?: string | null;
};
