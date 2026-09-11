import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

interface ApiProcessConfigurationModule {
  readonly parseApiProcessConfiguration: (environment: Record<string, string | undefined>) => {
    readonly host: string;
    readonly port: number;
    readonly runtimeProfile: "production";
    readonly healthExposure: "disabled";
    readonly readinessTimeoutMs: number;
  };
}

describe("API production bootstrap", () => {
  it("has an executable telemetry-preloaded entrypoint and parses explicit process configuration", async () => {
    const packageManifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { readonly scripts?: Readonly<Record<string, string>> };
    expect(packageManifest.scripts?.["start"]).toBe(
      "node --import @muster/observability/register dist/main.js",
    );
    const mainSource = await readFile(new URL("../main.ts", import.meta.url), "utf8");
    expect(mainSource).toContain('import { startApi } from "./composition/start-api.js";');
    expect(mainSource).toContain("await startApi();");

    const moduleUrl = new URL("./create-api-process.ts", import.meta.url).href;
    const loaded = (await import(
      /* @vite-ignore */ moduleUrl
    )) as Partial<ApiProcessConfigurationModule>;
    if (loaded.parseApiProcessConfiguration === undefined) {
      throw new Error("parseApiProcessConfiguration is not implemented");
    }
    expect(
      loaded.parseApiProcessConfiguration({
        RUNTIME_PROFILE: "production",
        HEALTH_EXPOSURE: "disabled",
        API_HOST: "0.0.0.0",
        API_PORT: "3000",
        READINESS_TIMEOUT_MS: "750",
        DATABASE_URL: "postgresql://runtime-value",
        JOB_SCHEMA: "pgboss",
      }),
    ).toMatchObject({
      host: "0.0.0.0",
      port: 3000,
      runtimeProfile: "production",
      healthExposure: "disabled",
      readinessTimeoutMs: 750,
    });
  });
});
