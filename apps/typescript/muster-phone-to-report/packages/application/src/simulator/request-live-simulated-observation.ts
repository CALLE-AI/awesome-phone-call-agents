import { ApplicationError } from "../errors/application-error.js";
import type { Clock } from "../ports/clock.port.js";
import type {
  LiveSimulatorAuthorizationReservationPort,
  ReserveLiveSimulatorAuthorizationInput,
} from "../ports/live-simulator-authorization.repository.js";

export class RequestLiveSimulatedObservation {
  public constructor(
    private readonly dependencies: {
      readonly authorizations: LiveSimulatorAuthorizationReservationPort;
      readonly clock: Clock;
    },
  ) {}

  public async execute(input: Omit<ReserveLiveSimulatorAuthorizationInput, "now">): Promise<
    Readonly<{
      outcome: "reserved" | "replayed";
      operationId: string;
    }>
  > {
    const result = await this.dependencies.authorizations.reserve({
      ...input,
      now: this.dependencies.clock.now(),
    });
    if (result.outcome !== "reserved" && result.outcome !== "replayed") {
      throw ApplicationError.validation("live_authorization_invalid");
    }
    return Object.freeze({ outcome: result.outcome, operationId: result.operationId });
  }
}
