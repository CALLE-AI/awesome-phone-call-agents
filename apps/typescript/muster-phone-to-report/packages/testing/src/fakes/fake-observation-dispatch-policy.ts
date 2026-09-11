import type {
  ObservationDispatchDecision,
  ObservationDispatchPolicyPort,
} from "@muster/application";
import type { CallAttempt, EndpointObservationProfile } from "@muster/domain";

export class FakeObservationDispatchPolicy implements ObservationDispatchPolicyPort {
  private readonly values: Array<{
    readonly profile: EndpointObservationProfile;
    readonly attempt: CallAttempt;
  }> = [];

  public constructor(private readonly decision: ObservationDispatchDecision) {}

  public get evaluations(): readonly {
    readonly profile: EndpointObservationProfile;
    readonly attempt: CallAttempt;
  }[] {
    return [...this.values];
  }

  public async evaluate(input: {
    readonly profile: EndpointObservationProfile;
    readonly attempt: CallAttempt;
  }): Promise<ObservationDispatchDecision> {
    this.values.push(input);
    return this.decision;
  }
}
