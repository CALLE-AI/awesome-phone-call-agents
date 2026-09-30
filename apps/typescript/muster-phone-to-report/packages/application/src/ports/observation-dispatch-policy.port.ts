import type { CallAttempt, EndpointObservationProfile } from "@muster/domain";

export type ObservationDispatchBlockReason =
  | "ineligible_profile"
  | "authorization_inactive"
  | "dtmf_not_approved"
  | "capacity_unavailable"
  | "kill_switch_active"
  | "provider_binding_unapproved";

export type ObservationDispatchDecision =
  | Readonly<{ outcome: "allowed" }>
  | Readonly<{ outcome: "blocked"; reason: ObservationDispatchBlockReason }>;

export interface ObservationDispatchPolicyPort {
  evaluate(input: {
    readonly profile: EndpointObservationProfile;
    readonly attempt: CallAttempt;
  }): Promise<ObservationDispatchDecision>;
}
