import type { JobSchedulerPort } from "@muster/application";
import type {
  FoundationHealthJobPayload,
  FoundationHealthSchedulingOutcome,
} from "@muster/contracts";

export class FakeJobScheduler implements JobSchedulerPort {
  private readonly payloads: FoundationHealthJobPayload[] = [];

  public constructor(private readonly result: FoundationHealthSchedulingOutcome) {}

  public get scheduledPayloads(): readonly FoundationHealthJobPayload[] {
    return [...this.payloads];
  }

  public async scheduleFoundationHealthCheck(
    payload: FoundationHealthJobPayload,
  ): Promise<FoundationHealthSchedulingOutcome> {
    this.payloads.push(payload);
    return this.result;
  }
}
