import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { OrganizationId } from "@muster/domain";
import { SIMULATOR_SCENARIO_CATALOG } from "@muster/testing";

const organizationId = OrganizationId.create("org-twiml-synthetic-endpoint");

const traceContext = Object.freeze({
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
});

async function loadEndpointApi(): Promise<Record<string, (...args: never[]) => unknown>> {
  const moduleUrl = new URL("./index.ts", import.meta.url).href;
  return (await import(/* @vite-ignore */ moduleUrl)) as Record<
    string,
    (...args: never[]) => unknown
  >;
}

function liveCatalog() {
  return SIMULATOR_SCENARIO_CATALOG.map((scenario) =>
    scenario.scenarioId === "synthetic-normal"
      ? Object.freeze({
          ...scenario,
          supportedModes: Object.freeze(["DETERMINISTIC_REPLAY", "LIVE_SMOKE"] as const),
        })
      : scenario,
  );
}

function expectedTwilioSignature(
  authToken: string,
  requestUrl: string,
  form: Readonly<Record<string, string>>,
): string {
  const signed = Object.keys(form)
    .sort()
    .reduce((value, key) => `${value}${key}${form[key] ?? ""}`, requestUrl);
  return createHmac("sha1", authToken).update(signed, "utf8").digest("base64");
}

async function createHarness() {
  const api = await loadEndpointApi();
  const events: unknown[] = [];
  const publicBaseUrl = "https://simulator.invalid";
  const endpointAlias = "synthetic-demo-endpoint";
  const audience = "muster-twilio-simulator";
  const twilioAuthToken = "test-only-twilio-signature-key";
  const pendingHandles: string[] = [];
  const bindings = new Map<string, string>();
  const syntheticScenario = liveCatalog().find(
    (candidate) => candidate.scenarioId === "synthetic-normal" && candidate.revision === 1,
  )!;
  const endpoint = (api["createTwilioSyntheticEndpoint"] as CallableFunction)({
    organizationId,
    publicBaseUrl,
    endpointAlias,
    audience,
    twilioAuthToken,
    callbackAuthorizations: {
      authenticateInitial: async (input: { readonly providerCallDigest: string }) => {
        const callbackHandle = pendingHandles.shift();
        if (callbackHandle === undefined) {
          const replay = [...bindings.entries()].find(
            ([, providerIdentity]) => providerIdentity === input.providerCallDigest,
          );
          return replay === undefined
            ? { outcome: "missing" }
            : { outcome: "replayed", callbackHandle: replay[0], scenario: syntheticScenario };
        }
        const existing = bindings.get(callbackHandle);
        if (existing !== undefined && existing !== input.providerCallDigest) {
          return { outcome: "conflict" };
        }
        bindings.set(callbackHandle, input.providerCallDigest);
        return {
          outcome: existing === undefined ? "bound" : "replayed",
          callbackHandle,
          scenario: syntheticScenario,
        };
      },
      authenticateBound: async (input: {
        readonly callbackHandle: string;
        readonly providerCallDigest: string;
      }) =>
        bindings.get(input.callbackHandle) === input.providerCallDigest
          ? { outcome: "replayed", scenario: syntheticScenario }
          : { outcome: "conflict" },
    },
    recordEvent: (event: unknown) => events.push(event),
  }) as {
    handleVoice(input: unknown): Promise<{
      readonly statusCode: number;
      readonly contentType: string;
      readonly body: string;
    }>;
    handleCanary(input: unknown): Promise<{
      readonly statusCode: number;
      readonly body: string;
      readonly canary?: unknown;
    }>;
  };

  const issue = async (operationId: string, nonce: string) => {
    void nonce;
    pendingHandles.push(operationId);
    return { callbackHandle: operationId };
  };

  return {
    api,
    endpoint,
    issue,
    events,
    publicBaseUrl,
    twilioAuthToken,
  };
}

describe("Twilio synthetic voice endpoint", () => {
  it("renders the exact revision-2 four-zone report and auxiliary statuses from the synthetic route boundary", async () => {
    const api = await loadEndpointApi();
    expect(api["renderTwilioScenarioReport"]).toBeTypeOf("function");
    const scenario = SIMULATOR_SCENARIO_CATALOG.find(
      (candidate) => candidate.scenarioId === "synthetic-normal" && candidate.revision === 2,
    );

    const report = (api["renderTwilioScenarioReport"] as CallableFunction)(scenario);

    expect(report).toBe(
      "This is a SIMULATED synthetic greenhouse phone report. " +
        "Zone 1, North house air temperature, is 71.5 degrees Fahrenheit, status OK. " +
        "Zone 2, Propagation bench temperature, is 68.0 degrees Fahrenheit, status OK. " +
        "Zone 3, Greenhouse relative humidity, is 68 percent, status OK. " +
        "Zone 4, Irrigation reservoir level, is 82 percent, status OK. " +
        "Sound is normal. Power is mains available. Battery is normal. Output is off.",
    );
  });

  it("safety-stops the host process after any redacted DTMF observation", async () => {
    const api = await loadEndpointApi();
    expect(api["createDtmfSafetyStop"]).toBeTypeOf("function");
    const safetyStop = (api["createDtmfSafetyStop"] as CallableFunction)();
    expect(safetyStop.isBlocked()).toBe(false);

    const result = safetyStop.observe({ Digits: "9" });

    expect(result).toEqual({
      status: "failed",
      actionsObserved: 1,
      compatibility: "simulator-tested",
      reason: "dtmf_observed",
    });
    expect(safetyStop.isBlocked()).toBe(true);
    expect(() => safetyStop.assertDispatchAllowed()).toThrowError(/DTMF safety stop is active/u);
    expect(JSON.stringify(safetyStop)).not.toContain("9");
  });

  it("renders the exact authorized synthetic scenario and replays only the same provider call", async () => {
    const harness = await createHarness();
    await harness.issue("run-normal-001", "nonce-normal-001");
    const requestUrl = `${harness.publicBaseUrl}/twilio/voice`;
    const form = { CallSid: "CA_SYNTHETIC_CALL_A" };
    const request = {
      requestUrl,
      twilioSignature: expectedTwilioSignature(harness.twilioAuthToken, requestUrl, form),
      form,
      traceContext,
    };

    const first = await harness.endpoint.handleVoice(request);
    const replay = await harness.endpoint.handleVoice(request);
    expect(first).toEqual(replay);
    expect(first).toMatchObject({ statusCode: 200, contentType: "application/xml" });
    expect(first.body).toContain("SIMULATED synthetic phone report");
    expect(first.body).toContain("71.5 degrees Fahrenheit");
    expect(first.body).toContain("68.0 degrees Fahrenheit");
    expect(first.body).toMatch(/<Gather[^>]*input="dtmf"/u);
    expect(first.body).toMatch(/actionOnEmptyResult="true"/u);
    expect(first.body).not.toMatch(/<Play|<Dial|<Number|<Pay|\sdigits=/iu);

    const differentForm = { CallSid: "CA_SYNTHETIC_CALL_B" };
    const conflict = await harness.endpoint.handleVoice({
      ...request,
      form: differentForm,
      twilioSignature: expectedTwilioSignature(harness.twilioAuthToken, requestUrl, differentForm),
    });
    expect(conflict.statusCode).toBe(200);
    expect(conflict.body).toContain("<Reject");
    expect(conflict.body).not.toContain("71.5");
  });

  it("validates the provider signature before consuming the exact run authorization", async () => {
    const harness = await createHarness();
    await harness.issue("run-signature-001", "nonce-signature-001");
    const requestUrl = `${harness.publicBaseUrl}/twilio/voice`;
    const form = { CallSid: "CA_SYNTHETIC_SIGNATURE" };

    const rejected = await harness.endpoint.handleVoice({
      requestUrl,
      twilioSignature: "invalid-provider-signature",
      form,
      traceContext,
    });
    expect(rejected.statusCode).toBe(403);
    expect(JSON.stringify(rejected)).not.toMatch(/signing-key|auth-token|runAuthorization/iu);

    const accepted = await harness.endpoint.handleVoice({
      requestUrl,
      twilioSignature: expectedTwilioSignature(harness.twilioAuthToken, requestUrl, form),
      form,
      traceContext,
    });
    expect(accepted.statusCode).toBe(200);
    expect(harness.events).toContainEqual(
      expect.objectContaining({
        event: "simulator.twilio.request",
        outcome: "provider_signature_rejected",
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      }),
    );
    expect(JSON.stringify(harness.events)).not.toMatch(
      /test-only|CA_SYNTHETIC|run-signature|nonce-signature/iu,
    );
  });

  it("persists a zero-action canary result and redacts every observed DTMF value", async () => {
    const harness = await createHarness();
    const clearAuthorization = await harness.issue("run-clear-001", "nonce-clear-001");
    const voiceUrl = `${harness.publicBaseUrl}/twilio/voice`;
    const voiceForm = { CallSid: "CA_SYNTHETIC_CLEAR" };
    await harness.endpoint.handleVoice({
      requestUrl: voiceUrl,
      twilioSignature: expectedTwilioSignature(harness.twilioAuthToken, voiceUrl, voiceForm),
      form: voiceForm,
      traceContext,
    });
    const clearUrl = `${harness.publicBaseUrl}/twilio/canary/${clearAuthorization.callbackHandle}`;
    const clearForm = { CallSid: "CA_SYNTHETIC_CLEAR", Digits: "" };
    const clear = await harness.endpoint.handleCanary({
      requestUrl: clearUrl,
      callbackHandle: clearAuthorization.callbackHandle,
      twilioSignature: expectedTwilioSignature(harness.twilioAuthToken, clearUrl, clearForm),
      form: clearForm,
      traceContext,
    });
    expect(clear).toMatchObject({
      statusCode: 200,
      canary: { status: "clear", actionsObserved: 0, compatibility: "simulator-tested" },
    });

    const observed = (harness.api["mapDtmfCanary"] as CallableFunction)({ Digits: "9" });
    expect(observed).toEqual({
      status: "failed",
      actionsObserved: 1,
      compatibility: "simulator-tested",
      reason: "dtmf_observed",
    });
    expect(JSON.stringify(observed)).not.toContain("9");
    expect(JSON.stringify(observed)).not.toMatch(/phone|credential|authorization/iu);
  });

  it("keeps voice and canary responses safe and singular when endpoint event telemetry throws", async () => {
    const api = await loadEndpointApi();
    const publicBaseUrl = "https://simulator.invalid";
    const twilioAuthToken = "test-only-twilio-signature-key";
    const scenario = liveCatalog().find(
      (candidate) => candidate.scenarioId === "synthetic-normal" && candidate.revision === 1,
    )!;
    const authenticateInitial = vi.fn(async () => ({
      outcome: "bound" as const,
      callbackHandle: "operation-throwing-telemetry",
      scenario,
    }));
    const authenticateBound = vi.fn(async () => ({
      outcome: "replayed" as const,
      scenario,
    }));
    const recordEvent = vi.fn(() => {
      throw new Error("endpoint telemetry unavailable");
    });
    const endpoint = (api["createTwilioSyntheticEndpoint"] as CallableFunction)({
      organizationId,
      publicBaseUrl,
      endpointAlias: "synthetic-demo-endpoint",
      audience: "muster-twilio-simulator",
      twilioAuthToken,
      callbackAuthorizations: { authenticateInitial, authenticateBound },
      recordEvent,
    }) as {
      handleVoice(input: unknown): Promise<{ readonly statusCode: number; readonly body: string }>;
      handleCanary(input: unknown): Promise<{ readonly statusCode: number; readonly body: string }>;
    };
    const voiceUrl = `${publicBaseUrl}/twilio/voice`;
    const voiceForm = { CallSid: "CA_THROWING_TELEMETRY" };

    await expect(
      endpoint.handleVoice({
        requestUrl: voiceUrl,
        twilioSignature: expectedTwilioSignature(twilioAuthToken, voiceUrl, voiceForm),
        form: voiceForm,
        traceContext,
      }),
    ).resolves.toMatchObject({ statusCode: 200, body: expect.stringContaining("<Gather") });

    const canaryUrl = `${publicBaseUrl}/twilio/canary/operation-throwing-telemetry`;
    const canaryForm = { CallSid: "CA_THROWING_TELEMETRY", Digits: "" };
    await expect(
      endpoint.handleCanary({
        requestUrl: canaryUrl,
        callbackHandle: "operation-throwing-telemetry",
        twilioSignature: expectedTwilioSignature(twilioAuthToken, canaryUrl, canaryForm),
        form: canaryForm,
        traceContext,
      }),
    ).resolves.toMatchObject({ statusCode: 200, body: expect.stringContaining("<Hangup") });

    expect(authenticateInitial).toHaveBeenCalledOnce();
    expect(authenticateBound).toHaveBeenCalledOnce();
    expect(recordEvent).toHaveBeenCalledTimes(4);
  });

  it("uses only the supported public Twilio package root", async () => {
    const source = await readFile(
      new URL("./twiml-synthetic-endpoint.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('from "twilio";');
    expect(source).not.toMatch(/twilio\/lib\//u);
  });
});
