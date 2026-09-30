import { describe, expect, it } from "vitest";

describe("EndpointObservationProfile", () => {
  // Test strategy: prove the profile is a deeply immutable, exact-version safety snapshot.
  // Persistence, provider behavior, live authorization, and hardware compatibility are
  // deliberately not tested in this phase.
  it("preserves an exact immutable SIMULATED profile without upgrading compatibility", async () => {
    const { EndpointObservationProfile, OrganizationId } = await import("../index.js");
    const profile = EndpointObservationProfile.create({
      endpointId: "endpoint_simulated_001",
      organizationId: OrganizationId.create("org_test_001"),
      adapterVersionId: "adapter_version_simulated_001",
      expectedZones: [
        {
          zoneId: "zone-02",
          ordinal: 1,
          applicability: "required",
          requiredFacet: "measurement",
          allowedUnitMappings: [
            {
              ruleId: "unit_rule_fahrenheit_v1",
              spokenUnit: "degrees fahrenheit",
              normalizedUnit: "degF",
            },
          ],
        },
        {
          zoneId: "zone-01",
          ordinal: 0,
          applicability: "required",
          requiredFacet: "measurement",
          allowedUnitMappings: [
            {
              ruleId: "unit_rule_fahrenheit_v1",
              spokenUnit: "degrees fahrenheit",
              normalizedUnit: "degF",
            },
          ],
        },
      ],
      dtmfPolicy: { kind: "forbidden" },
      compatibility: "simulator-tested",
      provenance: "SIMULATED",
      authorizationReferenceId: "authorization_ref_opaque_001",
    });

    expect(profile).toMatchObject({
      endpointId: "endpoint_simulated_001",
      adapterVersionId: "adapter_version_simulated_001",
      compatibility: "simulator-tested",
      provenance: "SIMULATED",
      dtmfPolicy: { kind: "forbidden" },
    });
    expect(profile.expectedZones.map(({ zoneId }: { readonly zoneId: string }) => zoneId)).toEqual([
      "zone-01",
      "zone-02",
    ]);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.expectedZones)).toBe(true);
    expect(Object.isFrozen(profile.expectedZones[0]?.allowedUnitMappings)).toBe(true);
    expect(Reflect.set(profile.expectedZones[0] ?? {}, "zoneId", "zone-rewritten")).toBe(false);

    expect(() =>
      EndpointObservationProfile.create({
        ...profile.toValue(),
        compatibility: "provider-observed",
        provenance: "SIMULATED",
      }),
    ).toThrowError("SIMULATED provenance requires simulator-tested compatibility");
  });

  it("rejects malformed, duplicate, and contradictory unit mappings independently of input order", async () => {
    const { EndpointObservationProfile, OrganizationId } = await import("../index.js");
    const createProfile = (allowedUnitMappings: readonly object[]) =>
      EndpointObservationProfile.create({
        endpointId: "endpoint_simulated_unit_policy",
        organizationId: OrganizationId.create("org_test_001"),
        adapterVersionId: "adapter_version_simulated_unit_policy",
        expectedZones: [
          {
            zoneId: "zone-01",
            ordinal: 0,
            applicability: "required",
            requiredFacet: "measurement",
            allowedUnitMappings,
          },
        ],
        dtmfPolicy: { kind: "forbidden" },
        compatibility: "simulator-tested",
        provenance: "SIMULATED",
        authorizationReferenceId: "authorization_ref_opaque_unit_policy",
      });
    const duplicateRuleMappings = [
      {
        ruleId: "unit_rule_duplicate",
        spokenUnit: "degrees fahrenheit",
        normalizedUnit: "degF",
      },
      {
        ruleId: "unit_rule_duplicate",
        spokenUnit: "degrees fahrenheit",
        normalizedUnit: "celsius",
      },
    ];

    for (const mappings of [duplicateRuleMappings, [...duplicateRuleMappings].reverse()]) {
      expect(() => createProfile(mappings)).toThrowError(
        "expected zone unit mapping ruleIds must be unique",
      );
    }
    expect(() => createProfile([])).toThrowError(
      "required expected zones require at least one unit mapping",
    );
    expect(() =>
      createProfile([
        {
          ruleId: "unit_rule_fahrenheit_v1",
          spokenUnit: "degrees",
          normalizedUnit: "degF",
        },
        {
          ruleId: "unit_rule_celsius_v1",
          spokenUnit: "degrees",
          normalizedUnit: "degC",
        },
      ]),
    ).toThrowError("expected zone unit mappings contradict for spoken unit degrees");
  });
});
