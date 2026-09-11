import path from "node:path";

import { describe, expect, it, vi } from "vitest";

async function loadApi(): Promise<Readonly<Record<string, CallableFunction>>> {
  return (await import("./live-smoke-preflight-runtime.js")) as Readonly<
    Record<string, CallableFunction>
  >;
}

describe("live-smoke runtime preflight repository root", () => {
  it("resolves the workspace root when the filtered command runs from the package directory", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
    const packageRoot = path.join(repositoryRoot, "apps", "simulator-host");
    const previousWorkingDirectory = process.cwd();

    process.chdir(packageRoot);
    try {
      const api = await loadApi();
      expect(api["resolveLiveSmokeRepositoryRoot"]).toBeTypeOf("function");
      expect(api["resolveLiveSmokeRepositoryRoot"]!()).toBe(repositoryRoot);
    } finally {
      process.chdir(previousWorkingDirectory);
    }
  });
});

describe("persistent webhook runtime preflight", () => {
  it("accepts only explicit true or the default unset mode", async () => {
    const api = await loadApi();
    expect(api["persistentWebhookEnabled"]).toBeTypeOf("function");
    expect(api["persistentWebhookEnabled"]!({})).toBe(false);
    expect(api["persistentWebhookEnabled"]!({ SIMULATOR_PERSISTENT_WEBHOOK: "" })).toBe(false);
    expect(api["persistentWebhookEnabled"]!({ SIMULATOR_PERSISTENT_WEBHOOK: "true" })).toBe(true);
    for (const value of ["false", "TRUE", "1", " true "]) {
      expect(() =>
        api["persistentWebhookEnabled"]!({ SIMULATOR_PERSISTENT_WEBHOOK: value }),
      ).toThrow();
    }
  });

  it("requires the healthy exact persistent receiver and Twilio POST webhook read-back", async () => {
    const api = await loadApi();
    expect(api["verifyLiveSmokeRestingConfiguration"]).toBeTypeOf("function");
    const request = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ready: true,
        mode: "persistent-demo",
        publicOrigin: "https://demo.invalid",
      }),
    }));
    const readConfiguration = vi.fn(async () => ({
      voice_url: "https://demo.invalid/twilio/voice",
      status_callback: "https://demo.invalid/twilio/status",
      voice_method: "POST",
      status_callback_method: "POST",
    }));
    await expect(
      api["verifyLiveSmokeRestingConfiguration"]!({
        keepWebhook: true,
        publicOrigin: "https://demo.invalid",
        request,
        readConfiguration,
      }),
    ).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith(
      "https://demo.invalid/healthz",
      expect.objectContaining({
        method: "GET",
        headers: { "ngrok-skip-browser-warning": "1" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(readConfiguration).toHaveBeenCalledOnce();
  });

  it.each([
    { ready: false, mode: "persistent-demo", publicOrigin: "https://demo.invalid" },
    { ready: true, mode: "other", publicOrigin: "https://demo.invalid" },
    { ready: true, mode: "persistent-demo", publicOrigin: "https://other.invalid" },
    null,
  ])(
    "blocks mismatched receiver health without accepting Twilio configuration: %j",
    async (health) => {
      const api = await loadApi();
      const readConfiguration = vi.fn();
      await expect(
        api["verifyLiveSmokeRestingConfiguration"]!({
          keepWebhook: true,
          publicOrigin: "https://demo.invalid",
          request: vi.fn(async () => ({ ok: true, json: async () => health })),
          readConfiguration,
        }),
      ).resolves.toBe(false);
      expect(readConfiguration).not.toHaveBeenCalled();
    },
  );

  it.each([
    { voice_url: "https://reject.invalid/voice" },
    { status_callback: "https://other.invalid/twilio/status" },
    { voice_method: "GET" },
    { status_callback_method: "GET" },
    { voice_url: "https://demo.invalid/twilio/voice?different=1" },
  ])("blocks persistent webhook configuration drift: %j", async (drift) => {
    const api = await loadApi();
    await expect(
      api["verifyLiveSmokeRestingConfiguration"]!({
        keepWebhook: true,
        publicOrigin: "https://demo.invalid",
        request: vi.fn(async () => ({
          ok: true,
          json: async () => ({
            ready: true,
            mode: "persistent-demo",
            publicOrigin: "https://demo.invalid",
          }),
        })),
        readConfiguration: vi.fn(async () => ({
          voice_url: "https://demo.invalid/twilio/voice",
          status_callback: "https://demo.invalid/twilio/status",
          voice_method: "POST",
          status_callback_method: "POST",
          ...drift,
        })),
      }),
    ).resolves.toBe(false);
  });

  it("preserves the default Reject preflight without contacting a persistent receiver", async () => {
    const api = await loadApi();
    const request = vi.fn();
    await expect(
      api["verifyLiveSmokeRestingConfiguration"]!({
        keepWebhook: false,
        publicOrigin: "https://demo.invalid",
        rejectUrl: "https://reject.invalid/voice",
        request,
        readConfiguration: vi.fn(async () => ({
          voice_url: "https://reject.invalid/voice",
          status_callback: "",
        })),
      }),
    ).resolves.toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});
