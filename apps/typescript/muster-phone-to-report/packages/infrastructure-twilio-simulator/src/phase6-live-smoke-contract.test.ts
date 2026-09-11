import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { OrganizationId } from "@muster/domain";
import { SIMULATOR_SCENARIO_CATALOG } from "@muster/testing";

import { createDtmfSafetyStop } from "./dtmf-canary.js";
import { createTwilioSyntheticEndpoint } from "./twiml-synthetic-endpoint.js";

const organizationId = OrganizationId.create("org-phase6-live-smoke");
const publicBaseUrl = "https://phase6.invalid";
const twilioAuthToken = "test-only-twilio-auth-token";
const identityHmacKey = "test-only-identity-hmac-key-at-least-32-bytes";
const caller = "+12025550115";
const target = "+12025550116";
const callSid = "CA_PHASE6_BOUND_CALL";
const traceContext = Object.freeze({
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
});
const scenario = SIMULATOR_SCENARIO_CATALOG.find(
  (candidate) => candidate.scenarioId === "synthetic-normal" && candidate.revision === 2,
)!;

function signature(url: string, form: Readonly<Record<string, string>>): string {
  const signed = Object.keys(form)
    .sort()
    .reduce((value, key) => `${value}${key}${form[key] ?? ""}`, url);
  return createHmac("sha1", twilioAuthToken).update(signed, "utf8").digest("base64");
}

function digest(value: string): string {
  return createHmac("sha256", identityHmacKey).update(value, "utf8").digest("hex");
}

function createHarness(overrides: Readonly<Record<string, unknown>> = {}) {
  const facts: Array<Readonly<Record<string, unknown>>> = [];
  const authenticateInitial = vi.fn(async () => ({
    outcome: "bound" as const,
    callbackHandle: "operation-phase6",
    scenario,
  }));
  const authenticateBound = vi.fn(async () => ({
    outcome: "replayed" as const,
    callbackHandle: "operation-phase6",
    scenario,
  }));
  const authenticateStatus = vi.fn(async () => ({
    outcome: "replayed" as const,
    callbackHandle: "operation-phase6",
    scenario,
  }));
  const providerFacts = {
    append: vi.fn(async (fact: Readonly<Record<string, unknown>>) => {
      const duplicate = facts.find(
        (candidate) =>
          candidate["operationId"] === fact["operationId"] && candidate["phase"] === fact["phase"],
      );
      if (duplicate !== undefined) return Object.freeze({ outcome: "replayed" as const });
      facts.push(Object.freeze({ ...fact }));
      return Object.freeze({ outcome: "appended" as const });
    }),
  };
  const dtmfSafetyStop = createDtmfSafetyStop();
  const endpoint = createTwilioSyntheticEndpoint({
    organizationId,
    publicBaseUrl,
    endpointAlias: "greenhouse-synthetic",
    audience: "muster-live-simulator",
    twilioAuthToken,
    callbackAuthorizations: {
      authenticateInitial,
      authenticateBound,
      authenticateStatus,
    },
    providerFacts,
    identityHmacKey,
    now: () => "2026-08-24T20:00:00.000Z",
    recordEvent: vi.fn(),
    dtmfSafetyStop,
    ...overrides,
  } as never);
  return {
    endpoint: endpoint as typeof endpoint & {
      handleStatus(input: unknown): Promise<{
        readonly statusCode: number;
        readonly contentType: string;
        readonly body: string;
      }>;
    },
    authenticateInitial,
    authenticateBound,
    authenticateStatus,
    providerFacts,
    facts,
    dtmfSafetyStop,
  };
}

function voiceRequest(
  requestUrl = `${publicBaseUrl}/twilio/voice`,
  form: Readonly<Record<string, string>> = { CallSid: callSid, From: caller, To: target },
) {
  return Object.freeze({
    requestUrl,
    twilioSignature: signature(requestUrl, form),
    form,
    traceContext,
  });
}

describe("Phase 6 guarded Twilio callback contract", () => {
  it("AC-ERROR-8 validates voice, canary, and status against the configured exact origin", async () => {
    const persistenceFailure = vi.fn();
    const harness = createHarness({ onProviderFactPersistenceFailure: persistenceFailure });
    const spoofedUrl = "https://forwarded-host.invalid/twilio/voice";
    const spoofed = await harness.endpoint.handleVoice(voiceRequest(spoofedUrl));
    expect(spoofed).toEqual({ statusCode: 403, contentType: "text/plain", body: "" });
    expect(harness.authenticateInitial).not.toHaveBeenCalled();

    const missingSignature = await harness.endpoint.handleVoice({
      ...voiceRequest(),
      twilioSignature: "",
    });
    expect(missingSignature).toEqual({ statusCode: 403, contentType: "text/plain", body: "" });
    expect(harness.facts).toEqual([]);
    expect(persistenceFailure).not.toHaveBeenCalled();
  });

  it("AC-ERROR-9 derives keyed caller and target digests before atomically binding CallSid", async () => {
    const harness = createHarness();
    const response = await harness.endpoint.handleVoice(voiceRequest());

    expect(response.statusCode).toBe(200);
    expect(harness.authenticateInitial).toHaveBeenCalledWith({
      organizationId,
      endpointAlias: "greenhouse-synthetic",
      audience: "muster-live-simulator",
      providerCallDigest: digest(callSid),
      callerDigest: digest(caller),
      authorizedTargetDigest: digest(target),
    });
    const authenticationCalls = JSON.stringify(harness.authenticateInitial.mock.calls);
    expect(authenticationCalls).not.toContain(caller);
    expect(authenticationCalls).not.toContain(target);
    expect(authenticationCalls).not.toContain(callSid);
  });

  it("AC-ERROR-9 returns TwiML Reject for a validly signed unmatched inbound call", async () => {
    const harness = createHarness({
      callbackAuthorizations: {
        authenticateInitial: vi.fn(async () => ({ outcome: "unmatched" as const })),
        authenticateBound: vi.fn(async () => ({ outcome: "unmatched" as const })),
        authenticateStatus: vi.fn(async () => ({ outcome: "unmatched" as const })),
      },
    });

    const response = await harness.endpoint.handleVoice(voiceRequest());
    expect(response).toMatchObject({ statusCode: 200, contentType: "application/xml" });
    expect(response.body).toMatch(/<Reject(?:\s|\/|>)/u);
    expect(response.body).not.toContain("SIMULATED synthetic greenhouse phone report");
  });

  it("AC-ASYNC-4 makes same-SID voice, canary, and status redelivery byte-identical", async () => {
    const harness = createHarness();
    const voice = voiceRequest();
    const voiceFirst = await harness.endpoint.handleVoice(voice);
    const voiceReplay = await harness.endpoint.handleVoice({
      ...voice,
      idempotencyToken: "redacted-transport-token-two",
    } as never);
    expect(voiceReplay).toEqual(voiceFirst);

    const canaryUrl = `${publicBaseUrl}/twilio/canary/operation-phase6`;
    const canaryForm = { CallSid: callSid, From: caller, To: target };
    const canaryRequest = {
      requestUrl: canaryUrl,
      callbackHandle: "operation-phase6",
      twilioSignature: signature(canaryUrl, canaryForm),
      form: canaryForm,
      traceContext,
    };
    const canaryFirst = await harness.endpoint.handleCanary(canaryRequest);
    const canaryReplay = await harness.endpoint.handleCanary(canaryRequest);
    expect(canaryReplay).toEqual(canaryFirst);

    const statusUrl = `${publicBaseUrl}/twilio/status`;
    const statusForm = {
      CallSid: callSid,
      From: caller,
      To: target,
      CallStatus: "completed",
      CallDuration: "7",
    };
    const statusRequest = {
      requestUrl: statusUrl,
      twilioSignature: signature(statusUrl, statusForm),
      form: statusForm,
      traceContext,
    };
    const statusFirst = await harness.endpoint.handleStatus(statusRequest);
    const statusReplay = await harness.endpoint.handleStatus(statusRequest);
    expect(statusReplay).toEqual(statusFirst);
    expect(harness.facts.map((fact) => fact["phase"])).toEqual(["voice", "canary", "status"]);
    expect(harness.providerFacts.append).toHaveBeenCalledTimes(6);
  });

  it("signals signed voice, canary, and status fact persistence failures without raw detail", async () => {
    const persistenceFailure = vi.fn();
    const protectedDetail = "protected callback fact repository detail";
    const harness = createHarness({
      providerFacts: {
        append: vi.fn(async () => {
          throw new Error(protectedDetail);
        }),
      },
      onProviderFactPersistenceFailure: persistenceFailure,
    });
    const canaryUrl = `${publicBaseUrl}/twilio/canary/operation-phase6`;
    const canaryForm = { CallSid: callSid, From: caller, To: target };
    const statusUrl = `${publicBaseUrl}/twilio/status`;
    const statusForm = {
      CallSid: callSid,
      From: caller,
      To: target,
      CallStatus: "completed",
      CallDuration: "7",
    };

    const responses = await Promise.all([
      harness.endpoint.handleVoice(voiceRequest()),
      harness.endpoint.handleCanary({
        requestUrl: canaryUrl,
        callbackHandle: "operation-phase6",
        twilioSignature: signature(canaryUrl, canaryForm),
        form: canaryForm,
        traceContext,
      }),
      harness.endpoint.handleStatus({
        requestUrl: statusUrl,
        twilioSignature: signature(statusUrl, statusForm),
        form: statusForm,
        traceContext,
      }),
    ]);

    expect(responses).toEqual([
      { statusCode: 503, contentType: "text/plain", body: "" },
      { statusCode: 503, contentType: "text/plain", body: "" },
      { statusCode: 503, contentType: "text/plain", body: "" },
    ]);
    expect(persistenceFailure).toHaveBeenCalledTimes(3);
    expect(persistenceFailure).toHaveBeenCalledWith({ operationId: "operation-phase6" });
    expect(JSON.stringify({ responses, calls: persistenceFailure.mock.calls })).not.toContain(
      protectedDetail,
    );
  });

  it("AC-HAPPY-5 renders a bounded DTMF-only Gather, an empty-result action, and terminal Hangup", async () => {
    const harness = createHarness();
    const voice = await harness.endpoint.handleVoice(voiceRequest());
    expect(voice.body).toMatch(/<Gather[^>]*input="dtmf"/u);
    expect(voice.body).toContain('actionOnEmptyResult="true"');
    expect(voice.body).toMatch(/<Hangup\s*\/>/u);
    expect(voice.body).not.toMatch(/<Dial|<Number|<Play[^>]*digits=|sendDigits/iu);

    const canaryUrl = `${publicBaseUrl}/twilio/canary/operation-phase6`;
    const canaryForm = { CallSid: callSid, From: caller, To: target };
    const canary = await harness.endpoint.handleCanary({
      requestUrl: canaryUrl,
      callbackHandle: "operation-phase6",
      twilioSignature: signature(canaryUrl, canaryForm),
      form: canaryForm,
      traceContext,
    });
    expect(canary.canary).toMatchObject({ status: "clear", actionsObserved: 0 });
    expect(canary.body).toMatch(/<Hangup\s*\/>/u);
  });

  it("AC-ERROR-4 safety-stops on any digit without retaining the digit", async () => {
    const harness = createHarness();
    await harness.endpoint.handleVoice(voiceRequest());
    const canaryUrl = `${publicBaseUrl}/twilio/canary/operation-phase6`;
    const canaryForm = { CallSid: callSid, From: caller, To: target, Digits: "#" };
    const response = await harness.endpoint.handleCanary({
      requestUrl: canaryUrl,
      callbackHandle: "operation-phase6",
      twilioSignature: signature(canaryUrl, canaryForm),
      form: canaryForm,
      traceContext,
    });

    expect(response.canary).toMatchObject({ status: "failed", actionsObserved: 1 });
    expect(harness.dtmfSafetyStop.isBlocked()).toBe(true);
    expect(JSON.stringify(harness.facts)).not.toContain("#");
    expect(harness.facts.at(-1)).toMatchObject({ phase: "canary", outcome: "dtmf_observed" });
  });
});
