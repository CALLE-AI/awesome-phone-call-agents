export type IncidentSeverity = 'P0' | 'P1' | 'P2';

export interface Incident {
  id: string;
  service: string;
  severity: IncidentSeverity;
  title: string;
  errorRate: number; // e.g. 42.5%
  rootCause: string;
  lastCommit: {
    hash: string;
    author: string;
    message: string;
    file: string;
    line: number;
  };
  status: 'active' | 'mitigating' | 'resolved';
  createdAt: string;
}

export type ActionDecision =
  | 'rollback'
  | 'restart'
  | 'scale_up'
  | 'acknowledge_only'
  | 'unknown';

export interface VoiceSREResult {
  action_decision: ActionDecision;
  target_service: string;
  target_version?: string;
  engineer_notes: string;
}

export interface RemediationLog {
  timestamp: string;
  step: string;
  status: 'pending' | 'success' | 'failed';
  details: string;
}

export interface SystemMetrics {
  service: string;
  currentVersion: string;
  activePods: number;
  cpuUsagePercent: number;
  errorRatePercent: number;
  p99LatencyMs: number;
  status: 'healthy' | 'critical' | 'recovering';
  activeIncident?: Incident;
  recentRemediations: RemediationLog[];
}
