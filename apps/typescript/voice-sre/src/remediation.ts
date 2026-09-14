import { Incident, SystemMetrics, RemediationLog, ActionDecision } from './types.js';

class RemediationEngine {
  private state: SystemMetrics = {
    service: 'checkout-service',
    currentVersion: 'v2.4.0',
    activePods: 5,
    cpuUsagePercent: 24.5,
    errorRatePercent: 0.02,
    p99LatencyMs: 42,
    status: 'healthy',
    recentRemediations: []
  };

  public getState(): SystemMetrics {
    return { ...this.state };
  }

  public triggerOutage(): Incident {
    const incident: Incident = {
      id: `INC-${Math.floor(1000 + Math.random() * 9000)}`,
      service: 'checkout-service',
      severity: 'P0',
      title: 'HTTP 500 Spike on /api/v1/checkout/process',
      errorRate: 46.8,
      rootCause: 'StripeSignatureVerificationError: Webhook secret undefined in payment_handler.py',
      lastCommit: {
        hash: '7c8b91a',
        author: 'Sarah Chen',
        message: 'refactor(payment): integrate updated stripe webhook verification',
        file: 'services/payment_handler.py',
        line: 104
      },
      status: 'active',
      createdAt: new Date().toISOString()
    };

    this.state.currentVersion = 'v2.4.1';
    this.state.errorRatePercent = incident.errorRate;
    this.state.p99LatencyMs = 1450;
    this.state.cpuUsagePercent = 88.2;
    this.state.status = 'critical';
    this.state.activeIncident = incident;

    this.addLog('INCIDENT_TRIGGERED', 'failed', `P0 Incident ${incident.id} triggered on ${incident.service}. Error rate: ${incident.errorRate}%`);
    return incident;
  }

  public async executeRemediation(
    decision: ActionDecision,
    targetVersion: string = 'v2.4.0',
    notes: string = ''
  ): Promise<{ success: boolean; message: string; state: SystemMetrics }> {
    if (!this.state.activeIncident) {
      return { success: false, message: 'No active incident to remediate.', state: this.state };
    }

    this.state.status = 'recovering';
    this.state.activeIncident.status = 'mitigating';

    switch (decision) {
      case 'rollback':
        this.addLog('REVERT_GIT_COMMIT', 'success', `Reverted commit ${this.state.activeIncident.lastCommit.hash} by ${this.state.activeIncident.lastCommit.author}`);
        this.addLog('K8S_ROLLBACK_DISPATCH', 'success', `Executing: kubectl rollout undo deployment/checkout-service --to-revision=${targetVersion}`);
        this.addLog('CACHE_FLUSH', 'success', `Flushed Redis distributed cache keys: 'checkout:session:*'`);
        
        // Restore healthy metrics
        this.state.currentVersion = targetVersion;
        this.state.errorRatePercent = 0.01;
        this.state.p99LatencyMs = 45;
        this.state.cpuUsagePercent = 26.1;
        this.state.status = 'healthy';
        this.state.activeIncident.status = 'resolved';
        this.addLog('VERIFICATION_PASSED', 'success', `Health check 200 OK. Error rate normalized to 0.01%. PagerDuty incident resolved.`);
        break;

      case 'restart':
        this.addLog('K8S_POD_RESTART', 'success', `Rolling restart of 5 pods in deployment/checkout-service`);
        this.state.errorRatePercent = 12.4; // temporary partial fix
        this.state.p99LatencyMs = 320;
        this.state.status = 'recovering';
        break;

      case 'scale_up':
        this.addLog('K8S_AUTOSCALE', 'success', `Scaled replicas from 5 to 12 pods`);
        this.state.activePods = 12;
        this.state.cpuUsagePercent = 38.0;
        break;

      case 'acknowledge_only':
      default:
        this.addLog('ACKNOWLEDGED', 'pending', `Engineer acknowledged incident. Notes: ${notes || 'Manual fix pending'}`);
        break;
    }

    return {
      success: true,
      message: `Remediation action '${decision}' executed successfully.`,
      state: this.state
    };
  }

  private addLog(step: string, status: 'pending' | 'success' | 'failed', details: string) {
    const log: RemediationLog = {
      timestamp: new Date().toLocaleTimeString(),
      step,
      status,
      details
    };
    this.state.recentRemediations.unshift(log);
    if (this.state.recentRemediations.length > 20) {
      this.state.recentRemediations.pop();
    }
  }
}

export const remediationEngine = new RemediationEngine();
