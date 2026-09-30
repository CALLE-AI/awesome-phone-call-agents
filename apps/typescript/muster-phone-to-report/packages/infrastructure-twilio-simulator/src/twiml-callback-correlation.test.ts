import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { OrganizationId } from "@muster/domain";
import { SIMULATOR_SCENARIO_CATALOG } from "@muster/testing";

import { createDtmfSafetyStop } from "./dtmf-canary.js";
import { createTwilioSyntheticEndpoint } from "./twiml-synthetic-endpoint.js";

const publicBaseUrl = "https://simulator.invalid";
const twilioAuthToken = "test-only-twilio-auth-token";
const traceContext = Object.freeze({
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
});
const scenario = SIMULATOR_SCENARIO_CATALOG.find(
  (candidate) => candidate.scenarioId === "synthetic-normal" && candidate.revision === 2,
)!;

function signature(requestUrl: string, form: Readonly<Record<string, string>>): string {
  const signed = Object.keys(form)
    .sort()
    .reduce((value, key) => `${value}${key}${form[key] ?? ""}`, requestUrl);
  return createHmac("sha1", twilioAuthToken).update(signed, "utf8").digest("base64");
}

describe("opaque Twilio callback correlation", () => {
  it("authenticates initial and canary callbacks without placing a permit in a URL or TwiML", async () => {
    const authenticateInitial = vi.fn().mockResolvedValue({
      outcome: "bound",
      callbackHandle: "operation-live-opaque",
      scenario,
    });
    const authenticateBound = vi.fn().mockResolvedValue({ outcome: "replayed", scenario });
    const endpoint = createTwilioSyntheticEndpoint({
      organizationId: OrganizationId.create("org-callback-correlation"),
      publicBaseUrl,
      endpointAlias: "greenhouse-synthetic",
      audience: "muster-live-simulator",
      twilioAuthToken,
      callbackAuthorizations: { authenticateInitial, authenticateBound },
      recordEvent: vi.fn(),
      dtmfSafetyStop: createDtmfSafetyStop(),
    });
    const voiceUrl = `${publicBaseUrl}/twilio/voice`;
    const voiceForm = { CallSid: "CA_CALLBACK_ONE" };
    const voice = await endpoint.handleVoice({
      requestUrl: voiceUrl,
      twilioSignature: signature(voiceUrl, voiceForm),
      form: voiceForm,
      traceContext,
    });

    expect(voice.statusCode).toBe(200);
    expect(voice.body).toContain("/twilio/canary/operation-live-opaque");
    expect(voice.body).not.toMatch(/permit|runAuthorization|token|canary\/[^"']+\?/iu);
    expect(authenticateInitial).toHaveBeenCalledWith({
      organizationId: OrganizationId.create("org-callback-correlation"),
      endpointAlias: "greenhouse-synthetic",
      audience: "muster-live-simulator",
      providerCallDigest: "CA_CALLBACK_ONE",
      callerDigest: "legacy-caller",
      authorizedTargetDigest: "legacy-target",
    });

    const canaryUrl = `${publicBaseUrl}/twilio/canary/operation-live-opaque`;
    const canaryForm = { CallSid: "CA_CALLBACK_ONE", Digits: "" };
    await expect(
      endpoint.handleCanary({
        requestUrl: canaryUrl,
        callbackHandle: "operation-live-opaque",
        twilioSignature: signature(canaryUrl, canaryForm),
        form: canaryForm,
        traceContext,
      }),
    ).resolves.toMatchObject({ statusCode: 200, canary: { status: "clear" } });
    expect(authenticateBound).toHaveBeenCalledWith({
      organizationId: OrganizationId.create("org-callback-correlation"),
      callbackHandle: "operation-live-opaque",
      endpointAlias: "greenhouse-synthetic",
      audience: "muster-live-simulator",
      providerCallDigest: "CA_CALLBACK_ONE",
      callerDigest: "legacy-caller",
      authorizedTargetDigest: "legacy-target",
    });
  });
});
