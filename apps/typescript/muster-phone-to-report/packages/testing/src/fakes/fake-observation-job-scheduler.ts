import type { ObservationJobSchedulerPort } from "@muster/application";
import type { ObservationJobPayload, ObservationSchedulingOutcome } from "@muster/contracts";

export class FakeObservationJobScheduler implements ObservationJobSchedulerPort {
  private readonly payloads: ObservationJobPayload[] = [];
  private readonly jobs = new Map<string, ObservationJobPayload>();

  public get scheduledPayloads(): readonly ObservationJobPayload[] {
    return [...this.payloads];
  }

  public get logicalJobs(): readonly ObservationJobPayload[] {
    return [...this.jobs.values()];
  }

  public async scheduleObservation(
    payload: ObservationJobPayload,
  ): Promise<ObservationSchedulingOutcome> {
    this.payloads.push(payload);
    const key = JSON.stringify([payload.organizationId, payload.operationId]);
    if (this.jobs.has(key)) return Object.freeze({ outcome: "duplicate" });
    this.jobs.set(key, payload);
    return Object.freeze({
      outcome: "scheduled",
      jobId: `fake-observation-job-${String(this.jobs.size)}`,
    });
  }
}
