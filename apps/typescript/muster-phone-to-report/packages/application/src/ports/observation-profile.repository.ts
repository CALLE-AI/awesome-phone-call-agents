import type { EndpointObservationProfile, OrganizationId } from "@muster/domain";

export type ObservationProfileEstablishResult = Readonly<{
  outcome: "established" | "replayed";
  value: EndpointObservationProfile;
}>;

export interface ObservationProfileRepository {
  establish(profile: EndpointObservationProfile): Promise<ObservationProfileEstablishResult>;
  findByEndpoint(
    organizationId: OrganizationId,
    endpointId: string,
  ): Promise<EndpointObservationProfile | undefined>;
}
