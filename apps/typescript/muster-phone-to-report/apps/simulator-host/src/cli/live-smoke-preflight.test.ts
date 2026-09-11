import { describe, expect, it, vi } from "vitest";

async function loadApi(): Promise<Readonly<Record<string, CallableFunction>>> {
  return (await import("../index.js")) as Readonly<Record<string, CallableFunction>>;
}

const readyFacts = Object.freeze({
  runtimeProfile: "test",
  publicOrigin: "https://phase6.invalid",
  ngrokCaptureDisabled: true,
  runtimeSecretReferencesResolved: true,
  durableAuthorizationStoreReady: true,
  durableEvidenceStoreReady: true,
  traceContextReady: true,
  targetAuthorized: true,
  calleAccountReachable: true,
  twilioAccountReachable: true,
  twilioRestingRejectVerified: true,
  productionCapabilityAbsent: true,
  runGate: "CLOSED",
  emergencyStopHealthy: true,
});

describe("Phase 6 non-calling preflight and operator gate", () => {
  it("runs every concrete dependency through a narrow read-only probe", async () => {
    const api = await loadApi();
    expect(api["createLiveSmokePreflight"]).toBeTypeOf("function");
    const probes = Object.fromEntries(
      [
        "runtimeSecretReferences",
        "durableRepositories",
        "runGateAndKillSwitch",
        "publicOrigin",
        "twilioRestingConfiguration",
        "providerAccounts",
        "ngrokCapturePolicy",
        "traceAndSignatureConfiguration",
        "authorizedIdentities",
        "productionExclusion",
      ].map((name) => [name, vi.fn(async () => ({ outcome: "PASS" }))]),
    );
    const preflight = api["createLiveSmokePreflight"]!({ probes });

    await expect(preflight.run()).resolves.toMatchObject({ outcome: "PASS" });
    expect(Object.values(probes).every((probe) => probe.mock.calls.length === 1)).toBe(true);

    probes["durableRepositories"]!.mockResolvedValueOnce({ outcome: "BLOCKED" });
    await expect(preflight.run()).resolves.toMatchObject({ outcome: "BLOCKED" });
  });

  it("AC-ENTRY-4 reports only redacted PASS/BLOCKED facts and constructs no provider", async () => {
    const api = await loadApi();
    expect(api["runLiveSmokePreflight"]).toBeTypeOf("function");
    const createProvider = vi.fn(() => {
      throw new Error("provider construction is forbidden during preflight");
    });
    const result = await api["runLiveSmokePreflight"]!({
      facts: readyFacts,
      createProvider,
    });

    expect(result).toMatchObject({
      outcome: "PASS",
      title: "Live-smoke preflight",
      runGateLabel: "Run gate: CLOSED",
      emergencyStopLabel: "Emergency stop",
    });
    expect(result.checks).toContainEqual({
      label: "Synthetic target authorization",
      outcome: "PASS",
    });
    expect(result.checks).not.toContainEqual(
      expect.objectContaining({ label: "Deterministic expected caller" }),
    );
    expect(createProvider).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(
      /api[_ -]?key|auth[_ -]?token|phone|\+1555|permit|CallSid/iu,
    );
  });

  it("AC-ENTRY-4 and AC-ERROR-6 fail closed for every missing prerequisite", async () => {
    const api = await loadApi();
    const run = api["runLiveSmokePreflight"]!;
    for (const key of Object.keys(readyFacts)) {
      if (key === "runtimeProfile" || key === "runGate") continue;
      const facts = { ...readyFacts, [key]: false };
      await expect(run({ facts })).resolves.toMatchObject({ outcome: "BLOCKED" });
    }
    await expect(
      run({ facts: { ...readyFacts, runtimeProfile: "production" } }),
    ).resolves.toMatchObject({ outcome: "BLOCKED" });
    await expect(run({ facts: { ...readyFacts, runGate: "OPEN" } })).resolves.toMatchObject({
      outcome: "BLOCKED",
    });
  });

  it("AC-ENTRY-5 requires fresh confirmation before arming, opening, minting, or reserving", async () => {
    const api = await loadApi();
    expect(api["createLiveSmokeArmSequence"]).toBeTypeOf("function");
    const effects = {
      armTwilio: vi.fn(async () => undefined),
      verifyTwilio: vi.fn(async () => true),
      openRunGate: vi.fn(),
      mintAuthorization: vi.fn(async () => "opaque-permit"),
      reserveAuthorization: vi.fn(async () => "reserved"),
    };
    const sequence = api["createLiveSmokeArmSequence"]!({
      confirmationMaxAgeMs: 30_000,
      now: () => 1_787_600_000_000,
      ...effects,
    });

    await expect(sequence.arm()).resolves.toEqual({ outcome: "blocked" });
    expect(Object.values(effects).every((effect) => effect.mock.calls.length === 0)).toBe(true);
    const receipt = sequence.confirm();
    await expect(sequence.arm(receipt)).resolves.toEqual({ outcome: "armed" });
    expect(effects.armTwilio).toHaveBeenCalledOnce();
    expect(effects.verifyTwilio).toHaveBeenCalledOnce();
    expect(effects.openRunGate).toHaveBeenCalledOnce();
    expect(effects.mintAuthorization).toHaveBeenCalledOnce();
    expect(effects.reserveAuthorization).toHaveBeenCalledOnce();
  });

  it("owns cleanup after the first Twilio mutation and keeps host/tunnel alive when restore read-back fails", async () => {
    const api = await loadApi();
    const cleanup = vi.fn(async () => ({ outcome: "blocked" as const }));
    const sequence = api["createLiveSmokeArmSequence"]!({
      confirmationMaxAgeMs: 30_000,
      now: () => 1_787_600_000_000,
      armTwilio: vi.fn(async () => undefined),
      verifyTwilio: vi.fn(async () => false),
      openRunGate: vi.fn(),
      mintAuthorization: vi.fn(async () => "opaque-permit"),
      reserveAuthorization: vi.fn(async () => "reserved"),
      cleanup,
    });

    await expect(sequence.arm(sequence.confirm())).resolves.toEqual({
      outcome: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("pins CALL-E Bearer credentials to the canonical official HTTPS origin before fetch", async () => {
    const api = await loadApi();
    expect(api["createCalleAccountProbe"]).toBeTypeOf("function");
    const request = vi.fn(async () => ({ ok: true }));
    for (const apiOrigin of [
      "http://api.heycall-e.com",
      "https://attacker.invalid",
      "https://user@api.heycall-e.com",
      "https://api.heycall-e.com:444",
      "https://api.heycall-e.com/path",
      "https://api.heycall-e.com?query=yes",
      "https://api.heycall-e.com#fragment",
    ]) {
      const accountProbe = api["createCalleAccountProbe"]!({
        apiOrigin,
        resolveApiKey: async () => "protected-test-key",
        fetch: request,
      });
      await expect(accountProbe()).resolves.toEqual({ outcome: "BLOCKED" });
    }
    expect(request).not.toHaveBeenCalled();

    const approved = api["createCalleAccountProbe"]!({
      apiOrigin: "https://api.heycall-e.com",
      resolveApiKey: async () => "protected-test-key",
      fetch: request,
    });
    await expect(approved()).resolves.toEqual({ outcome: "PASS" });
    expect(request).toHaveBeenCalledWith(
      "https://api.heycall-e.com/v1/goals",
      expect.objectContaining({
        method: "GET",
        headers: { authorization: "Bearer protected-test-key" },
      }),
    );
  });

  it("blocks when a real production artifact scan finds a live-smoke route marker", async () => {
    const api = await loadApi();
    expect(api["createProductionExclusionProbe"]).toBeTypeOf("function");
    const productionProbe = api["createProductionExclusionProbe"]!({
      readArtifacts: async () => [
        { path: "apps/api/dist/main.js", content: 'register("/twilio/voice")' },
        { path: "apps/web/dist/index.html", content: "<main>production</main>" },
      ],
    });

    await expect(productionProbe()).resolves.toEqual({ outcome: "BLOCKED" });
  });
});
