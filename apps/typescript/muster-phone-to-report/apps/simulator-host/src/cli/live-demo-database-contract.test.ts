import path from "node:path";

import { describe, expect, it } from "vitest";

interface LiveDemoDatabasePaths {
  readonly root: string;
  readonly databaseUrl: string;
  readonly provisioningAttestation: string;
  readonly activationScript: string;
  readonly lifecycleState: string;
}

interface ContractApi {
  readonly LIVE_DEMO_DATABASE_START_SUCCESS_MESSAGE: string;
  readonly LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE: string;
  readonly LIVE_DEMO_DATABASE_ATTENTION_MESSAGE: string;
  readonly LIVE_DEMO_DATABASE_USAGE_MESSAGE: string;
  parseLiveDemoDatabaseCommand(arguments_: readonly string[]): "start" | "dispose";
  createLiveDemoDatabasePaths(repositoryRoot: string): LiveDemoDatabasePaths;
  liveDemoDatabaseStartOutput(paths: LiveDemoDatabasePaths): readonly string[];
  liveDemoDatabaseDisposeOutput(): readonly string[];
  liveDemoDatabaseAttentionOutput(): readonly string[];
  createLiveDemoDatabasePowerShellActivation(input: {
    readonly databaseUrl: string;
    readonly attestationFilePath: string;
  }): string;
}

async function loadApi(): Promise<ContractApi> {
  return (await import("./live-demo-database-contract.js")) as ContractApi;
}

describe("disposable live-demo database command contract", () => {
  it("accepts only the exact start and dispose commands", async () => {
    const api = await loadApi();

    expect(api.parseLiveDemoDatabaseCommand(["start"])).toBe("start");
    expect(api.parseLiveDemoDatabaseCommand(["dispose"])).toBe("dispose");

    for (const arguments_ of [
      [],
      ["START"],
      ["cleanup"],
      ["start", "unexpected"],
      ["start", "--database-url=postgresql://example.invalid/demo"],
      ["start", "--image=postgres:latest"],
      ["dispose", "--container=anything"],
      ["dispose", "--secret=anything"],
      ["dispose", "--output=anywhere"],
    ]) {
      expect(() => api.parseLiveDemoDatabaseCommand(arguments_)).toThrow(
        api.LIVE_DEMO_DATABASE_USAGE_MESSAGE,
      );
    }
  });

  it("derives every protected artifact from the fixed repository-owned root", async () => {
    const api = await loadApi();
    const repositoryRoot = path.resolve("fixture-repository");

    expect(api.createLiveDemoDatabasePaths(repositoryRoot)).toEqual({
      root: path.join(repositoryRoot, ".generated-tmp", "live-demo-database"),
      databaseUrl: path.join(
        repositoryRoot,
        ".generated-tmp",
        "live-demo-database",
        "database-url.txt",
      ),
      provisioningAttestation: path.join(
        repositoryRoot,
        ".generated-tmp",
        "live-demo-database",
        "provisioning-attestation.json",
      ),
      activationScript: path.join(
        repositoryRoot,
        ".generated-tmp",
        "live-demo-database",
        "activate.ps1",
      ),
      lifecycleState: path.join(
        repositoryRoot,
        ".generated-tmp",
        "live-demo-database",
        "lifecycle-state.json",
      ),
    });
    expect(() => api.createLiveDemoDatabasePaths("relative/repository")).toThrow(
      api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
    );
  });

  it("uses fixed success and attention output without reflecting secret-bearing input", async () => {
    const api = await loadApi();
    const paths = api.createLiveDemoDatabasePaths(path.resolve("fixture-repository"));
    const secret = "not-for-output";

    expect(api.LIVE_DEMO_DATABASE_START_SUCCESS_MESSAGE).toBe(
      "Disposable live-demo database ready.",
    );
    expect(api.LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE).toBe(
      "Disposable live-demo database disposed.",
    );
    expect(api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE).toBe(
      "Disposable live-demo database requires attention; protected recovery state was retained.",
    );
    expect(api.liveDemoDatabaseStartOutput(paths)).toEqual([
      api.LIVE_DEMO_DATABASE_START_SUCCESS_MESSAGE,
      paths.activationScript,
    ]);
    expect(api.liveDemoDatabaseDisposeOutput()).toEqual([
      api.LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE,
    ]);
    expect(api.liveDemoDatabaseAttentionOutput()).toEqual([
      api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
    ]);
    expect(
      api.liveDemoDatabaseStartOutput({
        ...paths,
        activationScript: path.resolve("unrelated", "activate.ps1"),
      }),
    ).toEqual(api.liveDemoDatabaseAttentionOutput());
    expect(
      JSON.stringify([
        api.liveDemoDatabaseStartOutput(paths),
        api.liveDemoDatabaseDisposeOutput(),
        api.liveDemoDatabaseAttentionOutput(),
      ]),
    ).not.toContain(secret);
  });

  it("generates deterministic PowerShell that sets only the three approved variables", async () => {
    const api = await loadApi();
    const databaseUrl = "postgresql://demo:password@127.0.0.1:54321/muster_live_demo_abc";
    const attestationFilePath = path.resolve(
      "fixture-repository",
      ".generated-tmp",
      "live-demo-database",
      "provisioning-attestation.json",
    );

    const activation = api.createLiveDemoDatabasePowerShellActivation({
      databaseUrl,
      attestationFilePath,
    });

    expect(activation).toBe(
      [
        `$env:DATABASE_URL = '${databaseUrl}'`,
        `$env:MIGRATION_DATABASE_URL = '${databaseUrl}'`,
        `$env:LIVE_DEMO_DISPOSABLE_DATABASE_ATTESTATION_FILE = '${attestationFilePath}'`,
        "",
      ].join("\n"),
    );
    expect(activation.match(/\$env:/gu)).toHaveLength(3);
    expect(activation).not.toMatch(/Write-(Host|Output)|echo|Invoke-Expression/iu);
  });

  it("single-quotes PowerShell values so apostrophes, dollars, and subexpressions stay inert", async () => {
    const api = await loadApi();
    const databaseUrl =
      "postgresql://demo:pa'ss$(Get-ChildItem)@127.0.0.1:54321/muster_live_demo_abc";
    const attestationFilePath = path.join(
      path.parse(process.cwd()).root,
      "safe'$(Get-ChildItem)",
      "provisioning-attestation.json",
    );

    const activation = api.createLiveDemoDatabasePowerShellActivation({
      databaseUrl,
      attestationFilePath,
    });

    expect(activation).toContain("pa''ss$(Get-ChildItem)");
    expect(activation).toContain("safe''$(Get-ChildItem)");
    expect(activation.match(/Get-ChildItem/gu)).toHaveLength(3);
    expect(activation.split("\n")).toHaveLength(4);
  });

  it("refuses activation values that are remote, credential-free, relative, or multiline", async () => {
    const api = await loadApi();
    const validPath = path.resolve("fixture-repository", "provisioning-attestation.json");
    const validUrl = "postgresql://demo:password@127.0.0.1:54321/muster_live_demo_abc";

    for (const input of [
      {
        databaseUrl: "postgresql://demo:password@example.com:5432/demo",
        attestationFilePath: validPath,
      },
      { databaseUrl: "postgresql://127.0.0.1:5432/demo", attestationFilePath: validPath },
      { databaseUrl: `${validUrl}\nWrite-Host leaked`, attestationFilePath: validPath },
      { databaseUrl: validUrl, attestationFilePath: "relative/attestation.json" },
      { databaseUrl: validUrl, attestationFilePath: `${validPath}\r\nWrite-Host leaked` },
    ]) {
      expect(() => api.createLiveDemoDatabasePowerShellActivation(input)).toThrow(
        api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
      );
    }
  });
});
