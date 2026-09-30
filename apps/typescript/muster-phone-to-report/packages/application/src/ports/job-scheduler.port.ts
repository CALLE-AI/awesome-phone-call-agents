import type {
  FoundationHealthJobPayload,
  FoundationHealthSchedulingOutcome,
} from "@muster/contracts";

export interface JobSchedulerPort {
  scheduleFoundationHealthCheck(
    payload: FoundationHealthJobPayload,
  ): Promise<FoundationHealthSchedulingOutcome>;
}
