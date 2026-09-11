import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { OrganizationId } from "@muster/domain";
import {
  createDtmfSafetyStop,
  createRepositoryTwilioCallbackAuthorizationPort,
  createTwilioSyntheticEndpoint,
} from "@muster/infrastructure-twilio-simulator";
import {
  SIMULATOR_SCENARIO_CATALOG,
  deployMigrations,
  getPostgresTestConnectionUrls,
} from "@muster/testing";

import { startTwilioCallbackHttpRuntime } from "./twilio-callback-http-runtime.js";
import { TwilioSimulatorController } from "./twilio-simulator.controller.js";

function signature(
  authToken: string,
  requestUrl: string,
  form: Readonly<Record<string, string>>,
): string {
  const signed = Object.keys(form)
    .sort()
    .reduce((value, key) => `${value}${key}${form[key] ?? ""}`, requestUrl);
  return createHmac("sha1", authToken).update(signed, "utf8").digest("base64");
}

describe("Twilio callback HTTP boundary integration", () => {
  it("persists signed voice/status callbacks idempotently and rejects signature or CallSid mismatch", async () => {
    const connectionString = getPostgresTestConnectionUrls().repository;
    await deployMigrations(connectionString);
    const pg = await import("pg");
    const pool = new pg.Pool({ connectionString, max: 2 });
    const { createPostgresPersistence } = await import("@muster/infrastructure-postgres");
    const persistence = createPostgresPersistence(pool);
    const organizationId = OrganizationId.create("org-http-provider-facts");
    const publicBaseUrl = "https://simulator.invalid";
    const authToken = "protected-test-auth-token";
    const identityKey = "test-only-identity-hmac-key-at-least-32-bytes";
    const caller = "+12025550113";
    const target = "+12025550114";
    const digest = (value: string) =>
      createHmac("sha256", identityKey).update(value, "utf8").digest("hex");
    await pool.query(
      `TRUNCATE TABLE "live_simulator_provider_facts", "live_simulator_authorizations"`,
    );
    await persistence.liveSimulatorAuthorizations.issue({
      organizationId,
      operationId: "operation-http-provider-facts",
      nonceDigest: "a".repeat(64),
      semanticDigest: "b".repeat(64),
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      audience: "muster-live-simulator",
      endpointAlias: "greenhouse-synthetic",
      callerDigest: digest(caller),
      authorizedTargetDigest: digest(target),
      publicOrigin: publicBaseUrl,
      purpose: "non-production-synthetic-live-smoke",
      callBudget: 1,
      concurrency: 1,
      retryBudget: 0,
      dtmfPolicy: "forbidden",
      terminalDeadlineSeconds: 60,
      predecessorOperationId: null,
      issuedAt: "2026-08-24T20:00:00.000Z",
      expiresAt: "2099-08-24T20:05:00.000Z",
    });
    await persistence.liveSimulatorAuthorizations.reserve({
      organizationId,
      operationId: "operation-http-provider-facts",
      nonceDigest: "a".repeat(64),
      semanticDigest: "b".repeat(64),
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      audience: "muster-live-simulator",
      endpointAlias: "greenhouse-synthetic",
      callerDigest: digest(caller),
      authorizedTargetDigest: digest(target),
      publicOrigin: publicBaseUrl,
      purpose: "non-production-synthetic-live-smoke",
      callBudget: 1,
      concurrency: 1,
      retryBudget: 0,
      dtmfPolicy: "forbidden",
      terminalDeadlineSeconds: 60,
      predecessorOperationId: null,
      now: "2026-08-24T20:00:01.000Z",
    });
    await persistence.liveSimulatorAuthorizations.claimDispatch({
      organizationId,
      operationId: "operation-http-provider-facts",
      claimedAt: "2026-08-24T20:00:01.500Z",
    });
    const endpoint = createTwilioSyntheticEndpoint({
      organizationId,
      publicBaseUrl,
      endpointAlias: "greenhouse-synthetic",
      audience: "muster-live-simulator",
      twilioAuthToken: authToken,
      identityHmacKey: identityKey,
      callbackAuthorizations: createRepositoryTwilioCallbackAuthorizationPort({
        authorizations: persistence.liveSimulatorAuthorizations,
        scenarios: SIMULATOR_SCENARIO_CATALOG,
        now: () => "2026-08-24T20:00:02.000Z",
      }),
      providerFacts: persistence.liveSimulatorProviderFacts,
      now: (() => {
        let second = 3;
        return () => `2026-08-24T20:00:0${String(second++)}.000Z`;
      })(),
      dtmfSafetyStop: createDtmfSafetyStop(),
    });
    const runtime = await startTwilioCallbackHttpRuntime({
      host: "127.0.0.1",
      port: 0,
      publicBaseUrl,
      maxBodyBytes: 512,
      controller: new TwilioSimulatorController(endpoint),
      establishTraceContext: (headers) => ({
        traceparent:
          headers["traceparent"] ?? "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
      }),
    });
    const post = async (path: string, form: Record<string, string>, token = authToken) => {
      const url = `${publicBaseUrl}${path}`;
      return await fetch(`${runtime.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": signature(token, url, form),
        },
        body: new URLSearchParams(form),
      });
    };
    try {
      const voiceForm = { CallSid: "CA_HTTP_DURABLE", From: caller, To: target };
      expect((await post("/twilio/voice", voiceForm, "wrong-token")).status).toBe(403);
      const first = await post("/twilio/voice", voiceForm);
      const replay = await post("/twilio/voice", voiceForm);
      expect(await replay.text()).toBe(await first.text());
      const mismatchedSid = await post("/twilio/voice", {
        ...voiceForm,
        CallSid: "CA_HTTP_MISMATCH",
      });
      expect(mismatchedSid.status).toBe(200);
      expect(await mismatchedSid.text()).toContain("<Reject");
      const statusForm = { ...voiceForm, CallStatus: "completed", CallDuration: "7" };
      expect((await post("/twilio/status", statusForm)).status).toBe(204);
      expect((await post("/twilio/status", statusForm)).status).toBe(204);
      const facts = await persistence.liveSimulatorProviderFacts.listForOperation(
        organizationId,
        "operation-http-provider-facts",
      );
      expect(facts.map(({ phase }) => phase)).toEqual(["voice", "status"]);
    } finally {
      await runtime.close();
      await persistence.disconnect();
      await pool.end();
    }
  }, 60_000);

  it("routes signed status callbacks and keeps same-SID redelivery byte-identical", async () => {
    const status = vi
      .fn()
      .mockResolvedValue({ statusCode: 204, contentType: "text/plain", body: "" });
    const runtime = await startTwilioCallbackHttpRuntime({
      host: "127.0.0.1",
      port: 0,
      publicBaseUrl: "https://simulator.invalid",
      maxBodyBytes: 512,
      controller: { voice: vi.fn(), canary: vi.fn(), status },
      establishTraceContext: () => ({
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
      }),
    });
    try {
      const body = "CallSid=CA_STATUS&CallStatus=completed&CallDuration=7";
      const post = async () =>
        await fetch(`${runtime.baseUrl}/twilio/status`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "x-twilio-signature": "opaque-signature",
          },
          body,
        });
      expect((await post()).status).toBe(204);
      expect((await post()).status).toBe(204);
      expect(status).toHaveBeenCalledTimes(2);
      expect(status.mock.calls[0]).toEqual(status.mock.calls[1]);
    } finally {
      await runtime.close();
    }
  });

  it("covers signature rejection, authorization conflict, DTMF stop, trace, and secret-safe output", async () => {
    const publicBaseUrl = "https://simulator.invalid";
    const authToken = "protected-test-auth-token";
    const scenario = SIMULATOR_SCENARIO_CATALOG.find(
      (candidate) => candidate.scenarioId === "synthetic-normal" && candidate.revision === 2,
    )!;
    let allowInitial = true;
    const events: unknown[] = [];
    const endpoint = createTwilioSyntheticEndpoint({
      organizationId: OrganizationId.create("org-http-integration"),
      publicBaseUrl,
      endpointAlias: "greenhouse-synthetic",
      audience: "muster-live-simulator",
      twilioAuthToken: authToken,
      callbackAuthorizations: {
        authenticateInitial: vi.fn(async () =>
          allowInitial
            ? {
                outcome: "bound" as const,
                callbackHandle: "operation-http-integration",
                scenario,
              }
            : { outcome: "conflict" as const },
        ),
        authenticateBound: vi.fn(async () => ({ outcome: "replayed" as const, scenario })),
      },
      recordEvent: (event) => events.push(event),
      dtmfSafetyStop: createDtmfSafetyStop(),
    });
    const runtime = await startTwilioCallbackHttpRuntime({
      host: "127.0.0.1",
      port: 0,
      publicBaseUrl,
      maxBodyBytes: 512,
      controller: new TwilioSimulatorController(endpoint),
      establishTraceContext: (headers) => ({
        traceparent:
          headers["traceparent"] ?? "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
      }),
    });
    const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const voiceUrl = `${publicBaseUrl}/twilio/voice`;
    const voiceForm = { CallSid: "CA_HTTP_INTEGRATION" };
    const post = async (path: string, body: string, twilioSignature: string) =>
      await fetch(`${runtime.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": twilioSignature,
          traceparent,
        },
        body,
      });

    try {
      const invalidSignature = await post(
        "/twilio/voice",
        "CallSid=CA_HTTP_INTEGRATION",
        "invalid-signature",
      );
      expect(invalidSignature.status).toBe(403);
      expect(await invalidSignature.text()).toBe("");

      allowInitial = false;
      const conflict = await post(
        "/twilio/voice",
        "CallSid=CA_HTTP_INTEGRATION",
        signature(authToken, voiceUrl, voiceForm),
      );
      expect(conflict.status).toBe(403);
      expect(await conflict.text()).toBe("");

      allowInitial = true;
      const accepted = await post(
        "/twilio/voice",
        "CallSid=CA_HTTP_INTEGRATION",
        signature(authToken, voiceUrl, voiceForm),
      );
      expect(accepted.status).toBe(200);

      const canaryPath = "/twilio/canary/operation-http-integration";
      const canaryUrl = `${publicBaseUrl}${canaryPath}`;
      const canaryForm = { CallSid: "CA_HTTP_INTEGRATION", Digits: "5" };
      const dtmf = await post(
        canaryPath,
        "CallSid=CA_HTTP_INTEGRATION&Digits=5",
        signature(authToken, canaryUrl, canaryForm),
      );
      expect(dtmf.status).toBe(200);
      expect(await dtmf.text()).toContain("<Hangup/>");

      const stopped = await post(
        "/twilio/voice",
        "CallSid=CA_HTTP_INTEGRATION",
        signature(authToken, voiceUrl, voiceForm),
      );
      expect(stopped.status).toBe(503);
      expect(JSON.stringify(events)).toContain("4bf92f3577b34da6a3ce929d0e0e4736");
      expect(JSON.stringify(events)).not.toMatch(
        /protected-test-auth-token|CA_HTTP_INTEGRATION|"Digits"|"5"/iu,
      );
    } finally {
      await runtime.close();
    }
  });
});
