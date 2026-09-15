import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

async function loadConfigurationApi(): Promise<Record<string, unknown>> {
  try {
    return (await import("./configuration.js")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const validEnvironment = Object.freeze({
  RUNTIME_PROFILE: "test",
  SIMULATOR_HOST_ENABLED: "true",
  SIMULATOR_PUBLIC_BASE_URL: "https://simulator.invalid",
  SIMULATOR_DEMO_ORIGIN: "http://127.0.0.1:4173",
  SIMULATOR_ENDPOINT_ALIAS: "greenhouse-synthetic",
  SIMULATOR_AUTHORIZATION_AUDIENCE: "muster-live-simulator",
  SIMULATOR_CALL_BUDGET: "1",
  SIMULATOR_CONCURRENCY: "1",
  SIMULATOR_PROVIDER_TIMEOUT_MS: "120000",
  SIMULATOR_PROVIDER_TERMINAL_TIMEOUT_MS: "180000",
  SIMULATOR_CUSTODY_ROOT: resolve(".local/live-simulator-evidence"),
  SIMULATOR_CUSTODY_MAX_TRANSCRIPT_BYTES: "16384",
  SIMULATOR_CUSTODY_MAX_ENTRIES: "8",
  DATABASE_URL: "postgresql://placeholder.invalid/muster",
  SIMULATOR_JOBS_SCHEMA: "simulator_jobs",
  SIMULATOR_ORGANIZATION_ID: "org-simulator-host",
  SIMULATOR_LISTEN_HOST: "127.0.0.1",
  SIMULATOR_LISTEN_PORT: "0",
  CALLE_API_KEY: "test-only-calle-key",
  SIMULATOR_TARGET_ALLOWLIST_JSON: '{"greenhouse-synthetic":"test-only-target"}',
  SIMULATOR_KILL_SWITCH_FILE: resolve(".local/simulator-host.kill-switch"),
  SIMULATOR_AUTHORIZATION_SIGNING_KEY: "test-only-signing-key-with-32-bytes",
  SIMULATOR_CALLBACK_IDENTITY_HMAC_KEY: "test-only-callback-key-with-32-bytes",
  TWILIO_AUTH_TOKEN: "test-only-twilio-token",
});

describe("dedicated simulator host configuration", () => {
  it("admits only the bounded non-production one-call profile", async () => {
    const api = await loadConfigurationApi();
    expect(api["loadSimulatorHostConfiguration"]).toBeTypeOf("function");

    const configuration = (api["loadSimulatorHostConfiguration"] as CallableFunction)(
      validEnvironment,
    );
    expect(configuration).toMatchObject({
      runtimeProfile: "test",
      enabled: true,
      publicBaseUrl: "https://simulator.invalid",
      demoOrigin: "http://127.0.0.1:4173",
      endpointAlias: "greenhouse-synthetic",
      authorizationAudience: "muster-live-simulator",
      callBudget: 1,
      concurrency: 1,
      timeoutMs: 120_000,
      providerTerminalTimeoutMs: 180_000,
    });
    expect(configuration).not.toHaveProperty("expectedCallerDigest");
  });

  it("AC-ASYNC-5 separates the 120-second callback deadline from the 180-second provider-terminal watchdog", async () => {
    const api = await loadConfigurationApi();
    const load = api["loadSimulatorHostConfiguration"] as CallableFunction;

    expect(load({ ...validEnvironment, SIMULATOR_PROVIDER_TIMEOUT_MS: "120000" })).toMatchObject({
      timeoutMs: 120_000,
      providerTerminalTimeoutMs: 180_000,
    });
    expect(() =>
      load({ ...validEnvironment, SIMULATOR_PROVIDER_TIMEOUT_MS: "120001" }),
    ).toThrowError(/Simulator host configuration is invalid/u);
    expect(() =>
      load({ ...validEnvironment, SIMULATOR_PROVIDER_TERMINAL_TIMEOUT_MS: "180001" }),
    ).toThrowError(/Simulator host configuration is invalid/u);
  });

  it("binds the signed endpoint alias to one allowlisted exact target and a live fail-closed kill switch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "muster-simulator-config-"));
    const killSwitchFile = join(directory, "kill-switch");
    await writeFile(killSwitchFile, "ALLOW\n", { encoding: "utf8", mode: 0o600 });
    const api = await loadConfigurationApi();

    const configuration = (api["loadSimulatorHostConfiguration"] as CallableFunction)({
      ...validEnvironment,
      SIMULATOR_CUSTODY_ROOT: join(directory, "custody"),
      SIMULATOR_KILL_SWITCH_FILE: killSwitchFile,
    }) as {
      readonly targetAddress: string;
      readonly killSwitch: { assertDispatchAllowed(): void };
    };

    expect(configuration.targetAddress).toBe("test-only-target");
    expect(() => configuration.killSwitch.assertDispatchAllowed()).not.toThrow();
    await writeFile(killSwitchFile, "STOP\n", "utf8");
    expect(() => configuration.killSwitch.assertDispatchAllowed()).toThrowError(
      /Simulator host kill switch is active/u,
    );
  });

  it.each([
    ["production runtime", { ...validEnvironment, RUNTIME_PROFILE: "production" }],
    ["missing CALL-E key", { ...validEnvironment, CALLE_API_KEY: undefined }],
    ["non-HTTPS callback", { ...validEnvironment, SIMULATOR_PUBLIC_BASE_URL: "http://local" }],
    [
      "credentialed demo origin",
      { ...validEnvironment, SIMULATOR_DEMO_ORIGIN: "http://user:secret@127.0.0.1:4173" },
    ],
    ["retry-capable budget", { ...validEnvironment, SIMULATOR_CALL_BUDGET: "2" }],
    [
      "alias missing from target allowlist",
      { ...validEnvironment, SIMULATOR_TARGET_ALLOWLIST_JSON: '{"different-alias":"target"}' },
    ],
    ["relative custody root", { ...validEnvironment, SIMULATOR_CUSTODY_ROOT: "./relative" }],
    ["short signing key", { ...validEnvironment, SIMULATOR_AUTHORIZATION_SIGNING_KEY: "short" }],
  ])(
    "fails closed for %s without exposing protected configuration",
    async (_label, environment) => {
      const api = await loadConfigurationApi();
      expect(api["loadSimulatorHostConfiguration"]).toBeTypeOf("function");

      expect(() =>
        (api["loadSimulatorHostConfiguration"] as CallableFunction)(environment),
      ).toThrowError(/Simulator host configuration is invalid/u);
      try {
        (api["loadSimulatorHostConfiguration"] as CallableFunction)(environment);
      } catch (error: unknown) {
        expect(String(error)).not.toMatch(/test-only|target|signing-key|twilio-token/iu);
      }
    },
  );
});
