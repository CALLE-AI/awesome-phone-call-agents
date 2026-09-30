import type { OrganizationId } from "../shared/organization-id.js";

export const OBSERVATION_PROVENANCES = Object.freeze(["SIMULATED", "PROVIDER_OBSERVED"] as const);

export type ObservationProvenance = (typeof OBSERVATION_PROVENANCES)[number];
export type EndpointCompatibility = "simulator-tested" | "provider-observed";
export type ExpectedZoneApplicability = "required" | "reviewed_not_applicable";

export interface UnitMappingRule {
  readonly ruleId: string;
  readonly spokenUnit: string;
  readonly normalizedUnit: string;
}

export interface ExactDecimalRange {
  readonly minimum: string;
  readonly maximum: string;
}

export interface ExpectedZone {
  readonly zoneId: string;
  readonly ordinal: number;
  readonly applicability: ExpectedZoneApplicability;
  readonly requiredFacet: "measurement";
  readonly allowedUnitMappings: readonly UnitMappingRule[];
  readonly admissibleRange?: ExactDecimalRange;
}

export type DtmfPolicy =
  | Readonly<{ kind: "forbidden" }>
  | Readonly<{
      kind: "allowlisted_fixed_plan";
      planReferenceId: string;
      instructionFingerprint: string;
    }>;

export interface CreateEndpointObservationProfileInput {
  readonly endpointId: string;
  readonly organizationId: OrganizationId;
  readonly adapterVersionId: string;
  readonly expectedZones: readonly ExpectedZone[];
  readonly dtmfPolicy: DtmfPolicy;
  readonly compatibility: EndpointCompatibility;
  readonly provenance: ObservationProvenance;
  readonly authorizationReferenceId: string;
}

function requireNonEmpty(value: string, field: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`${field} must be a non-empty, trimmed value`);
  }
}

function cloneUnitMapping(rule: UnitMappingRule): UnitMappingRule {
  requireNonEmpty(rule.ruleId, "unit mapping ruleId");
  requireNonEmpty(rule.spokenUnit, "unit mapping spokenUnit");
  requireNonEmpty(rule.normalizedUnit, "unit mapping normalizedUnit");
  return Object.freeze({ ...rule });
}

function cloneExpectedZone(zone: ExpectedZone): ExpectedZone {
  requireNonEmpty(zone.zoneId, "expected zone zoneId");
  if (!Number.isSafeInteger(zone.ordinal) || zone.ordinal < 0) {
    throw new Error("expected zone ordinal must be a non-negative integer");
  }
  if (zone.requiredFacet !== "measurement") {
    throw new Error("expected zone requiredFacet must be measurement");
  }

  const allowedUnitMappings = Object.freeze(zone.allowedUnitMappings.map(cloneUnitMapping));
  if (zone.applicability === "required" && allowedUnitMappings.length === 0) {
    throw new Error("required expected zones require at least one unit mapping");
  }
  if (
    new Set(allowedUnitMappings.map(({ ruleId }) => ruleId)).size !== allowedUnitMappings.length
  ) {
    throw new Error("expected zone unit mapping ruleIds must be unique");
  }
  const normalizedUnitsBySpokenUnit = new Map<string, Set<string>>();
  for (const mapping of allowedUnitMappings) {
    const normalizedUnits =
      normalizedUnitsBySpokenUnit.get(mapping.spokenUnit) ?? new Set<string>();
    normalizedUnits.add(mapping.normalizedUnit);
    normalizedUnitsBySpokenUnit.set(mapping.spokenUnit, normalizedUnits);
  }
  const contradictorySpokenUnit = [...normalizedUnitsBySpokenUnit.entries()]
    .filter(([, normalizedUnits]) => normalizedUnits.size > 1)
    .map(([spokenUnit]) => spokenUnit)
    .sort()[0];
  if (contradictorySpokenUnit !== undefined) {
    throw new Error(
      `expected zone unit mappings contradict for spoken unit ${contradictorySpokenUnit}`,
    );
  }
  const admissibleRange =
    zone.admissibleRange === undefined ? undefined : Object.freeze({ ...zone.admissibleRange });

  return Object.freeze({
    zoneId: zone.zoneId,
    ordinal: zone.ordinal,
    applicability: zone.applicability,
    requiredFacet: zone.requiredFacet,
    allowedUnitMappings,
    ...(admissibleRange === undefined ? {} : { admissibleRange }),
  });
}

function cloneDtmfPolicy(policy: DtmfPolicy): DtmfPolicy {
  if (policy.kind === "forbidden") {
    return Object.freeze({ kind: "forbidden" });
  }
  requireNonEmpty(policy.planReferenceId, "DTMF planReferenceId");
  requireNonEmpty(policy.instructionFingerprint, "DTMF instructionFingerprint");
  return Object.freeze({ ...policy });
}

export class EndpointObservationProfile {
  public readonly endpointId: string;
  public readonly organizationId: OrganizationId;
  public readonly adapterVersionId: string;
  public readonly expectedZones: readonly ExpectedZone[];
  public readonly dtmfPolicy: DtmfPolicy;
  public readonly compatibility: EndpointCompatibility;
  public readonly provenance: ObservationProvenance;
  public readonly authorizationReferenceId: string;

  private constructor(input: CreateEndpointObservationProfileInput) {
    this.endpointId = input.endpointId;
    this.organizationId = input.organizationId;
    this.adapterVersionId = input.adapterVersionId;
    this.expectedZones = input.expectedZones;
    this.dtmfPolicy = input.dtmfPolicy;
    this.compatibility = input.compatibility;
    this.provenance = input.provenance;
    this.authorizationReferenceId = input.authorizationReferenceId;
    Object.freeze(this);
  }

  public static create(input: CreateEndpointObservationProfileInput): EndpointObservationProfile {
    requireNonEmpty(input.endpointId, "endpointId");
    requireNonEmpty(input.adapterVersionId, "adapterVersionId");
    requireNonEmpty(input.authorizationReferenceId, "authorizationReferenceId");
    if (input.expectedZones.length === 0) {
      throw new Error("EndpointObservationProfile requires at least one expected zone");
    }
    if (input.provenance === "SIMULATED" && input.compatibility !== "simulator-tested") {
      throw new Error("SIMULATED provenance requires simulator-tested compatibility");
    }
    if (input.provenance === "PROVIDER_OBSERVED" && input.compatibility !== "provider-observed") {
      throw new Error("PROVIDER_OBSERVED provenance requires provider-observed compatibility");
    }

    const expectedZones = input.expectedZones
      .map(cloneExpectedZone)
      .sort(
        (left, right) => left.ordinal - right.ordinal || left.zoneId.localeCompare(right.zoneId),
      );
    const zoneIds = new Set(expectedZones.map(({ zoneId }) => zoneId));
    const ordinals = new Set(expectedZones.map(({ ordinal }) => ordinal));
    if (zoneIds.size !== expectedZones.length || ordinals.size !== expectedZones.length) {
      throw new Error("EndpointObservationProfile expected zone IDs and ordinals must be unique");
    }

    return new EndpointObservationProfile({
      ...input,
      expectedZones: Object.freeze(expectedZones),
      dtmfPolicy: cloneDtmfPolicy(input.dtmfPolicy),
    });
  }

  public toValue(): CreateEndpointObservationProfileInput {
    return Object.freeze({
      endpointId: this.endpointId,
      organizationId: this.organizationId,
      adapterVersionId: this.adapterVersionId,
      expectedZones: this.expectedZones,
      dtmfPolicy: this.dtmfPolicy,
      compatibility: this.compatibility,
      provenance: this.provenance,
      authorizationReferenceId: this.authorizationReferenceId,
    });
  }
}
