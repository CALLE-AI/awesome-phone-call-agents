import {
  ApplicationError,
  type ObservationProfileEstablishResult,
  type ObservationProfileRepository,
} from "@muster/application";
import {
  EndpointObservationProfile,
  OrganizationId,
  type DtmfPolicy,
  type EndpointCompatibility,
  type ExpectedZone,
  type ObservationProvenance,
} from "@muster/domain";

import type { PrismaRepositoryClient } from "./prisma-transaction.js";
import { runInPrismaTransaction } from "./prisma-transaction.js";

interface PersistedUnitMapping {
  readonly ruleId: string;
  readonly spokenUnit: string;
  readonly normalizedUnit: string;
}

interface PersistedExpectedZone {
  readonly zoneId: string;
  readonly ordinal: number;
  readonly applicability: "required" | "reviewedNotApplicable";
  readonly requiredFacet: string;
  readonly admissibleMinimum: string | null;
  readonly admissibleMaximum: string | null;
  readonly unitMappings: readonly PersistedUnitMapping[];
}

interface PersistedAdapterVersion {
  readonly organizationId: string;
  readonly id: string;
  readonly endpointId: string;
  readonly dtmfPolicyKind: "forbidden" | "allowlistedFixedPlan";
  readonly dtmfPlanReferenceId: string | null;
  readonly dtmfInstructionFingerprint: string | null;
  readonly compatibility: "simulatorTested" | "providerObserved";
  readonly provenance: "simulated" | "providerObserved";
  readonly expectedZones: readonly PersistedExpectedZone[];
}

function toPersistedProvenance(
  provenance: ObservationProvenance,
): "simulated" | "providerObserved" {
  return provenance === "SIMULATED" ? "simulated" : "providerObserved";
}

function toDomainProvenance(provenance: "simulated" | "providerObserved"): ObservationProvenance {
  return provenance === "simulated" ? "SIMULATED" : "PROVIDER_OBSERVED";
}

function toPersistedCompatibility(
  compatibility: EndpointCompatibility,
): "simulatorTested" | "providerObserved" {
  return compatibility === "simulator-tested" ? "simulatorTested" : "providerObserved";
}

function toDomainCompatibility(
  compatibility: "simulatorTested" | "providerObserved",
): EndpointCompatibility {
  return compatibility === "simulatorTested" ? "simulator-tested" : "provider-observed";
}

function toDomainDtmfPolicy(record: PersistedAdapterVersion): DtmfPolicy {
  if (record.dtmfPolicyKind === "forbidden") {
    return { kind: "forbidden" };
  }
  if (record.dtmfPlanReferenceId === null || record.dtmfInstructionFingerprint === null) {
    throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
  }
  return {
    kind: "allowlisted_fixed_plan",
    planReferenceId: record.dtmfPlanReferenceId,
    instructionFingerprint: record.dtmfInstructionFingerprint,
  };
}

function toDomainZone(record: PersistedExpectedZone): ExpectedZone {
  if (record.requiredFacet !== "measurement") {
    throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
  }
  const hasRange = record.admissibleMinimum !== null || record.admissibleMaximum !== null;
  if (hasRange && (record.admissibleMinimum === null || record.admissibleMaximum === null)) {
    throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
  }
  return {
    zoneId: record.zoneId,
    ordinal: record.ordinal,
    applicability: record.applicability === "required" ? "required" : "reviewed_not_applicable",
    requiredFacet: "measurement",
    allowedUnitMappings: record.unitMappings.map((mapping) => ({
      ruleId: mapping.ruleId,
      spokenUnit: mapping.spokenUnit,
      normalizedUnit: mapping.normalizedUnit,
    })),
    ...(record.admissibleMinimum === null || record.admissibleMaximum === null
      ? {}
      : {
          admissibleRange: {
            minimum: record.admissibleMinimum,
            maximum: record.admissibleMaximum,
          },
        }),
  };
}

function toDomainProfile(
  authorizationReferenceId: string,
  record: PersistedAdapterVersion,
): EndpointObservationProfile {
  return EndpointObservationProfile.create({
    endpointId: record.endpointId,
    organizationId: OrganizationId.create(record.organizationId),
    adapterVersionId: record.id,
    expectedZones: record.expectedZones.map(toDomainZone),
    dtmfPolicy: toDomainDtmfPolicy(record),
    compatibility: toDomainCompatibility(record.compatibility),
    provenance: toDomainProvenance(record.provenance),
    authorizationReferenceId,
  });
}

function canonicalProfile(profile: EndpointObservationProfile): string {
  // Unit-mapping insertion order is not profile identity, so stable sorting makes equivalent
  // immutable profiles replay across repository instances.
  const value = profile.toValue();
  return JSON.stringify({
    ...value,
    organizationId: value.organizationId.value,
    expectedZones: value.expectedZones
      .map((zone) => ({
        ...zone,
        allowedUnitMappings: [...zone.allowedUnitMappings].sort(
          (left, right) =>
            left.ruleId.localeCompare(right.ruleId) ||
            left.spokenUnit.localeCompare(right.spokenUnit) ||
            left.normalizedUnit.localeCompare(right.normalizedUnit),
        ),
      }))
      .sort(
        (left, right) => left.ordinal - right.ordinal || left.zoneId.localeCompare(right.zoneId),
      ),
  });
}

export class PrismaObservationProfileRepository implements ObservationProfileRepository {
  public constructor(private readonly client: PrismaRepositoryClient) {}

  public async establish(
    profile: EndpointObservationProfile,
  ): Promise<ObservationProfileEstablishResult> {
    const value = profile.toValue();
    try {
      await runInPrismaTransaction(this.client, async (transaction) => {
        await transaction.endpoint.create({
          data: {
            organizationId: value.organizationId.value,
            id: value.endpointId,
            activeAdapterVersionId: null,
            authorizationReferenceId: value.authorizationReferenceId,
          },
        });
        await transaction.adapterVersion.create({
          data: {
            organizationId: value.organizationId.value,
            id: value.adapterVersionId,
            endpointId: value.endpointId,
            dtmfPolicyKind:
              value.dtmfPolicy.kind === "forbidden" ? "forbidden" : "allowlistedFixedPlan",
            dtmfPlanReferenceId:
              value.dtmfPolicy.kind === "forbidden" ? null : value.dtmfPolicy.planReferenceId,
            dtmfInstructionFingerprint:
              value.dtmfPolicy.kind === "forbidden"
                ? null
                : value.dtmfPolicy.instructionFingerprint,
            compatibility: toPersistedCompatibility(value.compatibility),
            provenance: toPersistedProvenance(value.provenance),
          },
        });
        for (const zone of value.expectedZones) {
          await transaction.adapterExpectedZone.create({
            data: {
              organizationId: value.organizationId.value,
              endpointId: value.endpointId,
              adapterVersionId: value.adapterVersionId,
              zoneId: zone.zoneId,
              ordinal: zone.ordinal,
              applicability:
                zone.applicability === "required" ? "required" : "reviewedNotApplicable",
              requiredFacet: zone.requiredFacet,
              admissibleMinimum: zone.admissibleRange?.minimum ?? null,
              admissibleMaximum: zone.admissibleRange?.maximum ?? null,
            },
          });
          for (const mapping of zone.allowedUnitMappings) {
            await transaction.adapterZoneUnitMapping.create({
              data: {
                organizationId: value.organizationId.value,
                endpointId: value.endpointId,
                adapterVersionId: value.adapterVersionId,
                zoneId: zone.zoneId,
                ruleId: mapping.ruleId,
                spokenUnit: mapping.spokenUnit,
                normalizedUnit: mapping.normalizedUnit,
              },
            });
          }
        }
        await transaction.endpoint.update({
          where: {
            organizationId_id: {
              organizationId: value.organizationId.value,
              id: value.endpointId,
            },
          },
          data: { activeAdapterVersionId: value.adapterVersionId },
        });
      });
      return Object.freeze({ outcome: "established", value: profile });
    } catch {
      const established = await this.findByEndpoint(value.organizationId, value.endpointId);
      if (established === undefined) {
        if (await this.adapterVersionIdentityExists(value.organizationId, value.adapterVersionId)) {
          throw ApplicationError.idempotencyConflict("observation_profile_conflict");
        }
        throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
      }
      if (canonicalProfile(established) !== canonicalProfile(profile)) {
        throw ApplicationError.idempotencyConflict("observation_profile_conflict");
      }
      return Object.freeze({ outcome: "replayed", value: established });
    }
  }

  public async findByEndpoint(
    organizationId: OrganizationId,
    endpointId: string,
  ): Promise<EndpointObservationProfile | undefined> {
    try {
      const endpoint = await this.client.endpoint.findUnique({
        where: {
          organizationId_id: { organizationId: organizationId.value, id: endpointId },
        },
      });
      if (endpoint === null) {
        return undefined;
      }
      if (endpoint.activeAdapterVersionId === null) {
        throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
      }
      const adapterVersion = await this.client.adapterVersion.findUnique({
        where: {
          organizationId_id: {
            organizationId: organizationId.value,
            id: endpoint.activeAdapterVersionId,
          },
        },
        include: {
          expectedZones: {
            include: { unitMappings: { orderBy: { ruleId: "asc" } } },
            orderBy: [{ ordinal: "asc" }, { zoneId: "asc" }],
          },
        },
      });
      return adapterVersion === null
        ? undefined
        : toDomainProfile(endpoint.authorizationReferenceId, adapterVersion);
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
  }

  private async adapterVersionIdentityExists(
    organizationId: OrganizationId,
    adapterVersionId: string,
  ): Promise<boolean> {
    try {
      return (
        (await this.client.adapterVersion.findUnique({
          where: {
            organizationId_id: {
              organizationId: organizationId.value,
              id: adapterVersionId,
            },
          },
          select: { id: true },
        })) !== null
      );
    } catch {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
  }
}
