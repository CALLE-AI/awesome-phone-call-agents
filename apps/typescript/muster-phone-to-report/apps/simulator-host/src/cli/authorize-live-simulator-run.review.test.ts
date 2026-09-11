import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

interface CliModule {
  readonly authorizeLiveSimulatorRun: (input: Record<string, unknown>) => Promise<unknown>;
  readonly encodeAuthorizationNonce: (entropy: Uint8Array) => string;
  readonly runAuthorizeLiveSimulatorCli: (
    argv: readonly string[],
    environment?: Readonly<Record<string, string | undefined>>,
  ) => Promise<void>;
}

const authorizedTargetDigest = "b".repeat(64);

async function loadCli(): Promise<Partial<CliModule>> {
  try {
    return (await import("./authorize-live-simulator-run.js")) as Partial<CliModule>;
  } catch (error) {
    if (error instanceof Error && /Cannot find module|Failed to load url/iu.test(error.message)) {
      return {};
    }
    throw error;
  }
}

function dependencies() {
  const issue = vi.fn(async () => ({ outcome: "issued", operationId: "operation-cli-001" }));
  const output: string[] = [];
  return {
    issue,
    output,
    input: {
      configuration: {
        organizationId: "org-test",
        endpointAlias: "greenhouse-synthetic",
        authorizationAudience: "muster-live-simulator",
        authorizationSigningKey: "test-only-signing-key-with-at-least-32-bytes",
        authorizedTargetDigest,
        publicBaseUrl: "https://simulator.invalid",
      },
      authorizationIssuer: { issue },
      predecessorLookup: {
        find: vi.fn(async () => ({
          scenarioId: "synthetic-abnormal",
          scenarioRevision: 2,
          terminal: true,
          hasEvidence: true,
          provenance: "SIMULATED",
        })),
      },
      scenarios: [
        {
          scenarioId: "synthetic-normal",
          revision: 2,
          supportedModes: ["DETERMINISTIC_REPLAY", "LIVE_SMOKE"],
        },
        {
          scenarioId: "synthetic-recovery",
          revision: 2,
          supportedModes: ["DETERMINISTIC_REPLAY", "LIVE_SMOKE"],
        },
      ],
      nowEpochSeconds: () => 1_786_464_000,
      generateOperationId: () => "operation-cli-001",
      generateNonce: () => "nonce-cli-001",
      writeOutput: (value: string) => output.push(value),
    },
  };
}

describe("scenario-bound simulator authorization CLI", () => {
  it("encodes arbitrary nonce entropy into an opaque identifier with an alphanumeric prefix", async () => {
    const api = await loadCli();
    expect(api.encodeAuthorizationNonce).toBeTypeOf("function");
    const entropy = Uint8Array.from([251, 255, 255, ...Array<number>(21).fill(0)]);

    const nonce = api.encodeAuthorizationNonce?.(entropy);

    expect(nonce).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{47}$/u);
    expect(nonce).toHaveLength(48);
  });

  it("does not expose the legacy standalone authorization command", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
    ) as { readonly scripts?: Readonly<Record<string, string>> };

    expect(manifest.scripts?.["simulator:authorize"]).toBeUndefined();
  });

  it("fails the legacy standalone CLI closed before configuration or durable permit issuance", async () => {
    const api = await loadCli();
    expect(api.runAuthorizeLiveSimulatorCli).toBeTypeOf("function");

    await expect(
      api.runAuthorizeLiveSimulatorCli?.(["--scenario", "synthetic-normal"], {}),
    ).rejects.toThrowError("Standalone live-smoke authorization is disabled");
  });

  it("issues a normal scenario-bound one-use permit without printing an executable command", async () => {
    const api = await loadCli();
    expect(api.authorizeLiveSimulatorRun).toBeTypeOf("function");
    const fixture = dependencies();

    const result = await api.authorizeLiveSimulatorRun?.({
      ...fixture.input,
      argv: ["--scenario", "synthetic-normal"],
    });

    expect(result).toMatchObject({
      operationId: "operation-cli-001",
      scenarioId: "synthetic-normal",
    });
    expect(fixture.issue).toHaveBeenCalledOnce();
    expect(fixture.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizedTargetDigest,
        publicOrigin: "https://simulator.invalid",
        purpose: "non-production-synthetic-live-smoke",
        callBudget: 1,
        concurrency: 1,
        retryBudget: 0,
        dtmfPolicy: "forbidden",
        terminalDeadlineSeconds: 120,
      }),
    );
    expect(fixture.output).toHaveLength(1);
    expect(fixture.output[0]).not.toMatch(/pnpm|simulator:authorize|--predecessor/iu);
  });

  it("rejects a recovery authorization with a missing predecessor before issuance or output", async () => {
    const api = await loadCli();
    expect(api.authorizeLiveSimulatorRun).toBeTypeOf("function");
    const fixture = dependencies();

    await expect(
      api.authorizeLiveSimulatorRun?.({
        ...fixture.input,
        argv: ["--scenario", "synthetic-recovery"],
      }),
    ).rejects.toThrowError("Recovery predecessor operation ID is required");
    expect(fixture.issue).not.toHaveBeenCalled();
    expect(fixture.output).toEqual([]);
  });

  it("rejects a malformed recovery predecessor before issuance or output", async () => {
    const api = await loadCli();
    expect(api.authorizeLiveSimulatorRun).toBeTypeOf("function");
    const fixture = dependencies();

    await expect(
      api.authorizeLiveSimulatorRun?.({
        ...fixture.input,
        argv: ["--scenario", "synthetic-recovery", "--predecessor", "../../secret"],
      }),
    ).rejects.toThrowError("Recovery predecessor operation ID is invalid");
    expect(fixture.issue).not.toHaveBeenCalled();
    expect(fixture.output).toEqual([]);
  });

  it("binds the exact validated recovery predecessor into the issued permit", async () => {
    const api = await loadCli();
    expect(api.authorizeLiveSimulatorRun).toBeTypeOf("function");
    const fixture = dependencies();

    await api.authorizeLiveSimulatorRun?.({
      ...fixture.input,
      argv: ["--scenario", "synthetic-recovery", "--predecessor", "operation-abnormal-001"],
    });

    expect(fixture.issue).toHaveBeenCalledWith(
      expect.objectContaining({ predecessorOperationId: "operation-abnormal-001" }),
    );
    expect(fixture.output).toHaveLength(1);
  });

  it("durably rejects every invalid recovery predecessor before issuance or output", async () => {
    const api = await loadCli();
    expect(api.authorizeLiveSimulatorRun).toBeTypeOf("function");
    const invalidPredecessors = [
      undefined,
      {
        scenarioId: "synthetic-normal",
        scenarioRevision: 2,
        terminal: true,
        hasEvidence: true,
        provenance: "SIMULATED",
      },
      {
        scenarioId: "synthetic-abnormal",
        scenarioRevision: 1,
        terminal: true,
        hasEvidence: true,
        provenance: "SIMULATED",
      },
      {
        scenarioId: "synthetic-abnormal",
        scenarioRevision: 2,
        terminal: false,
        hasEvidence: true,
        provenance: "SIMULATED",
      },
      {
        scenarioId: "synthetic-abnormal",
        scenarioRevision: 2,
        terminal: true,
        hasEvidence: false,
        provenance: "SIMULATED",
      },
      {
        scenarioId: "synthetic-abnormal",
        scenarioRevision: 2,
        terminal: true,
        hasEvidence: true,
        provenance: "REAL",
      },
    ] as const;

    for (const predecessor of invalidPredecessors) {
      const fixture = dependencies();
      const find = vi.fn(async () => predecessor);
      await expect(
        api.authorizeLiveSimulatorRun?.({
          ...fixture.input,
          predecessorLookup: { find },
          argv: ["--scenario", "synthetic-recovery", "--predecessor", "operation-abnormal-001"],
        }),
      ).rejects.toThrowError("Recovery predecessor is not an eligible live abnormal observation");
      expect(find).toHaveBeenCalledWith("operation-abnormal-001");
      expect(fixture.issue).not.toHaveBeenCalled();
      expect(fixture.output).toEqual([]);
    }
  });
});
