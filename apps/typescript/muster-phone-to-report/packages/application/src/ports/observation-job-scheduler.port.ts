import type { ObservationJobPayload, ObservationSchedulingOutcome } from "@muster/contracts";

export interface ObservationJobSchedulerPort {
  scheduleObservation(payload: ObservationJobPayload): Promise<ObservationSchedulingOutcome>;
}
