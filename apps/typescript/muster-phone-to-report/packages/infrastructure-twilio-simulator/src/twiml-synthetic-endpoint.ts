import { createHash, createHmac } from "node:crypto";

import twilio from "twilio";

import {
  validateSimulatorScenario,
  type SimulatorScenario,
  type W3CTraceContext,
} from "@muster/contracts";
import type {
  LiveSimulatorAuthorizationRecord,
  LiveSimulatorAuthorizationRepository,
  LiveSimulatorProviderFactRepository,
} from "@muster/application";
import type { OrganizationId } from "@muster/domain";

import { createDtmfSafetyStop, type DtmfCanaryResult, type DtmfSafetyStop } from "./dtmf-canary.js";

export type TwilioSimulatorEvent = Readonly<{
  event: "simulator.twilio.request";
  outcome:
    | "provider_signature_rejected"
    | "authorization_rejected"
    | "authorization_bound"
    | "authorization_replayed"
    | "voice_rendered"
    | "canary_clear"
    | "canary_failed"
    | "status_recorded";
  traceId: string;
  spanId: string;
}>;

export interface TwilioSyntheticRequest {
  readonly requestUrl: string;
  readonly callbackHandle?: string;
  readonly twilioSignature: string;
  readonly form: Readonly<Record<string, string>>;
  readonly traceContext: W3CTraceContext;
  readonly idempotencyToken?: string;
}

export interface TwilioSyntheticResponse {
  readonly statusCode: number;
  readonly contentType: "application/xml" | "text/plain";
  readonly body: string;
  readonly canary?: DtmfCanaryResult;
}

export interface TwilioSyntheticEndpoint {
  handleVoice(input: TwilioSyntheticRequest): Promise<TwilioSyntheticResponse>;
  handleCanary(input: TwilioSyntheticRequest): Promise<TwilioSyntheticResponse>;
  handleStatus(input: TwilioSyntheticRequest): Promise<TwilioSyntheticResponse>;
}

type CallbackAuthorizationSuccess = Readonly<{
  outcome: "bound" | "replayed";
  callbackHandle: string;
  scenario: SimulatorScenario;
}>;

type CallbackAuthorizationResult =
  CallbackAuthorizationSuccess | Readonly<{ outcome: "missing" | "unmatched" | "conflict" }>;

interface CallbackIdentity {
  readonly providerCallDigest: string;
  readonly callerDigest: string;
  readonly authorizedTargetDigest: string;
}

export interface TwilioCallbackAuthorizationPort {
  authenticateInitial(input: {
    readonly organizationId: OrganizationId;
    readonly endpointAlias: string;
    readonly audience: string;
    readonly providerCallDigest: string;
    readonly callerDigest: string;
    readonly authorizedTargetDigest: string;
  }): Promise<CallbackAuthorizationResult>;
  authenticateBound(input: {
    readonly organizationId: OrganizationId;
    readonly callbackHandle: string;
    readonly endpointAlias: string;
    readonly audience: string;
    readonly providerCallDigest: string;
    readonly callerDigest: string;
    readonly authorizedTargetDigest: string;
  }): Promise<CallbackAuthorizationResult>;
  authenticateStatus?(input: {
    readonly organizationId: OrganizationId;
    readonly endpointAlias: string;
    readonly audience: string;
    readonly providerCallDigest: string;
    readonly callerDigest: string;
    readonly authorizedTargetDigest: string;
  }): Promise<CallbackAuthorizationResult>;
}

export function digestLiveSmokeIdentity(value: string, hmacKey: string): string {
  if (hmacKey.length < 32 || value.length < 1 || value.length > 256 || value.trim() !== value) {
    throw new Error("Invalid live-smoke callback identity");
  }
  return createHmac("sha256", hmacKey).update(value, "utf8").digest("hex");
}

export function createRepositoryTwilioCallbackAuthorizationPort(input: {
  readonly authorizations: LiveSimulatorAuthorizationRepository;
  readonly scenarios: readonly SimulatorScenario[];
  readonly now: () => string;
}): TwilioCallbackAuthorizationPort {
  const scenarioFor = (
    scenarioId: string,
    scenarioRevision: number,
  ): SimulatorScenario | undefined =>
    input.scenarios.find(
      (scenario) => scenario.scenarioId === scenarioId && scenario.revision === scenarioRevision,
    );
  const success = (
    result:
      | Readonly<{
          outcome: "bound" | "replayed";
          authorization: LiveSimulatorAuthorizationRecord;
        }>
      | Readonly<{ outcome: "missing" | "unmatched" | "conflict" }>,
  ): CallbackAuthorizationResult => {
    if (result.outcome !== "bound" && result.outcome !== "replayed") {
      return Object.freeze({ outcome: result.outcome });
    }
    const scenario = scenarioFor(
      result.authorization.scenarioId,
      result.authorization.scenarioRevision,
    );
    return scenario === undefined
      ? Object.freeze({ outcome: "conflict" as const })
      : Object.freeze({
          outcome: result.outcome,
          callbackHandle: result.authorization.operationId,
          scenario,
        });
  };
  return Object.freeze({
    async authenticateInitial(
      request: Parameters<TwilioCallbackAuthorizationPort["authenticateInitial"]>[0],
    ) {
      return success(
        await input.authorizations.claimInitialCallback({
          ...request,
          boundAt: input.now(),
        }),
      );
    },
    async authenticateBound(
      request: Parameters<TwilioCallbackAuthorizationPort["authenticateBound"]>[0],
    ) {
      return success(
        await input.authorizations.authenticateBoundCallback({
          ...request,
          operationId: request.callbackHandle,
        }),
      );
    },
    async authenticateStatus(
      request: Parameters<NonNullable<TwilioCallbackAuthorizationPort["authenticateStatus"]>>[0],
    ) {
      return success(await input.authorizations.authenticateStatusCallback(request));
    },
  });
}

function rejected(): TwilioSyntheticResponse {
  return Object.freeze({ statusCode: 403, contentType: "text/plain", body: "" });
}

function unavailable(): TwilioSyntheticResponse {
  return Object.freeze({ statusCode: 503, contentType: "text/plain", body: "" });
}

function unmatched(): TwilioSyntheticResponse {
  return Object.freeze({
    statusCode: 200,
    contentType: "application/xml",
    body: '<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="rejected"/></Response>',
  });
}

function field(input: TwilioSyntheticRequest, name: string): string | undefined {
  const value = input.form[name];
  return value === undefined || value.length === 0 ? undefined : value;
}

export function renderTwilioScenarioReport(value: unknown): string {
  const scenario = validateSimulatorScenario(value);
  return scenario.reportSegments.map(({ text }) => text).join(" ");
}

export function createTwilioSyntheticEndpoint(input: {
  readonly organizationId: OrganizationId;
  readonly publicBaseUrl: string;
  readonly endpointAlias: string;
  readonly audience: string;
  readonly twilioAuthToken: string;
  readonly callbackAuthorizations: TwilioCallbackAuthorizationPort;
  readonly providerFacts?: LiveSimulatorProviderFactRepository;
  readonly onProviderFactPersistenceFailure?: (input: { readonly operationId: string }) => void;
  readonly identityHmacKey?: string;
  readonly now?: () => string;
  readonly recordEvent: (event: TwilioSimulatorEvent) => void;
  readonly dtmfSafetyStop?: DtmfSafetyStop;
}): TwilioSyntheticEndpoint {
  if (!input.publicBaseUrl.startsWith("https://") || input.publicBaseUrl.endsWith("/")) {
    throw new Error("Invalid Twilio simulator public base URL");
  }
  if (input.twilioAuthToken.length === 0) throw new Error("Twilio auth token is required");
  if (input.identityHmacKey !== undefined && input.identityHmacKey.length < 32) {
    throw new Error("Twilio callback identity HMAC key is required");
  }
  const dtmfSafetyStop = input.dtmfSafetyStop ?? createDtmfSafetyStop();
  const now = input.now ?? (() => new Date().toISOString());
  const traceIdentifiers = (
    request: TwilioSyntheticRequest,
  ): Readonly<{ traceId: string; spanId: string }> | undefined => {
    const match = /^00-(?!0{32})([0-9a-f]{32})-((?!0{16})[0-9a-f]{16})-[0-9a-f]{2}$/u.exec(
      request.traceContext.traceparent.trim().toLowerCase(),
    );
    return match?.[1] === undefined || match[2] === undefined
      ? undefined
      : Object.freeze({ traceId: match[1], spanId: match[2] });
  };
  const record = (
    outcome: TwilioSimulatorEvent["outcome"],
    identifiers: Readonly<{ traceId: string; spanId: string }>,
  ): void => {
    try {
      input.recordEvent(
        Object.freeze({ event: "simulator.twilio.request", outcome, ...identifiers }),
      );
    } catch {
      // Callback telemetry is best effort and cannot alter the signed TwiML response.
    }
  };

  const expectedUrl = (request: TwilioSyntheticRequest, phase: "voice" | "canary" | "status") =>
    phase === "voice"
      ? `${input.publicBaseUrl}/twilio/voice`
      : phase === "status"
        ? `${input.publicBaseUrl}/twilio/status`
        : `${input.publicBaseUrl}/twilio/canary/${encodeURIComponent(request.callbackHandle ?? "")}`;

  const identity = (request: TwilioSyntheticRequest): CallbackIdentity | undefined => {
    const callSid = field(request, "CallSid");
    if (callSid === undefined) return undefined;
    if (input.identityHmacKey === undefined) {
      return Object.freeze({
        providerCallDigest: callSid,
        callerDigest: "legacy-caller",
        authorizedTargetDigest: "legacy-target",
      });
    }
    const caller = field(request, "From");
    const target = field(request, "To");
    if (caller === undefined || target === undefined) return undefined;
    return Object.freeze({
      providerCallDigest: digestLiveSmokeIdentity(callSid, input.identityHmacKey),
      callerDigest: digestLiveSmokeIdentity(caller, input.identityHmacKey),
      authorizedTargetDigest: digestLiveSmokeIdentity(target, input.identityHmacKey),
    });
  };

  const authenticate = async (
    request: TwilioSyntheticRequest,
    phase: "voice" | "canary" | "status",
  ): Promise<
    | Readonly<{
        scenario: SimulatorScenario;
        callbackHandle: string;
        identity: CallbackIdentity;
        traceId: string;
      }>
    | "unmatched"
    | undefined
  > => {
    const identifiers = traceIdentifiers(request);
    if (identifiers === undefined) return undefined;
    const url = expectedUrl(request, phase);
    if (
      request.requestUrl !== url ||
      !twilio.validateRequest(input.twilioAuthToken, request.twilioSignature, url, {
        ...request.form,
      })
    ) {
      record("provider_signature_rejected", identifiers);
      return undefined;
    }
    try {
      const callbackIdentity = identity(request);
      if (callbackIdentity === undefined) throw new Error("invalid callback identity");
      const authorization =
        phase === "voice"
          ? await input.callbackAuthorizations.authenticateInitial({
              organizationId: input.organizationId,
              endpointAlias: input.endpointAlias,
              audience: input.audience,
              ...callbackIdentity,
            })
          : phase === "status"
            ? await input.callbackAuthorizations.authenticateStatus?.({
                organizationId: input.organizationId,
                endpointAlias: input.endpointAlias,
                audience: input.audience,
                ...callbackIdentity,
              })
            : await input.callbackAuthorizations.authenticateBound({
                organizationId: input.organizationId,
                callbackHandle: request.callbackHandle ?? "",
                endpointAlias: input.endpointAlias,
                audience: input.audience,
                ...callbackIdentity,
              });
      if (authorization === undefined) throw new Error("status callback unavailable");
      if (authorization.outcome === "unmatched" || authorization.outcome === "missing") {
        record("authorization_rejected", identifiers);
        return "unmatched";
      }
      if (authorization.outcome !== "bound" && authorization.outcome !== "replayed") {
        throw new Error("callback conflict");
      }
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(authorization.callbackHandle) ||
        !authorization.scenario.supportedModes.includes("LIVE_SMOKE") ||
        authorization.scenario.origin !== "SIMULATED" ||
        authorization.scenario.dtmf.policy !== "forbidden" ||
        authorization.scenario.dtmf.allowlist.length !== 0
      ) {
        throw new Error("invalid scenario");
      }
      record(
        authorization.outcome === "bound" ? "authorization_bound" : "authorization_replayed",
        identifiers,
      );
      return Object.freeze({
        scenario: authorization.scenario,
        callbackHandle: authorization.callbackHandle,
        identity: callbackIdentity,
        traceId: identifiers.traceId,
      });
    } catch {
      record("authorization_rejected", identifiers);
      return undefined;
    }
  };

  const appendFact = async (fact: {
    readonly phase: "voice" | "canary" | "status";
    readonly outcome: "accepted" | "zero_dtmf" | "dtmf_observed" | "completed" | "failed";
    readonly callbackHandle: string;
    readonly identity: CallbackIdentity;
    readonly traceId: string;
    readonly actionsObserved: 0 | 1 | null;
  }): Promise<void> => {
    if (input.providerFacts === undefined) return;
    const occurredAt = now();
    const semanticDigest = createHash("sha256")
      .update(
        JSON.stringify([
          fact.callbackHandle,
          fact.phase,
          fact.outcome,
          fact.identity.providerCallDigest,
          fact.actionsObserved,
        ]),
        "utf8",
      )
      .digest("hex");
    try {
      await input.providerFacts.append({
        organizationId: input.organizationId,
        operationId: fact.callbackHandle,
        phase: fact.phase,
        providerCallDigest: fact.identity.providerCallDigest,
        semanticDigest,
        outcome: fact.outcome,
        occurredAt,
        traceId: fact.traceId,
        signatureValidated: true,
        actionsObserved: fact.actionsObserved,
        inboundCallCount: null,
      });
    } catch (error: unknown) {
      try {
        input.onProviderFactPersistenceFailure?.({ operationId: fact.callbackHandle });
      } catch {
        // The signed callback still fails closed even if the local failure signal is unavailable.
      }
      throw error;
    }
  };

  return Object.freeze({
    async handleVoice(request: TwilioSyntheticRequest): Promise<TwilioSyntheticResponse> {
      if (dtmfSafetyStop.isBlocked()) return unavailable();
      const authenticated = await authenticate(request, "voice");
      if (authenticated === "unmatched") return unmatched();
      if (authenticated === undefined) return rejected();
      try {
        await appendFact({
          phase: "voice",
          outcome: "accepted",
          callbackHandle: authenticated.callbackHandle,
          identity: authenticated.identity,
          traceId: authenticated.traceId,
          actionsObserved: null,
        });
      } catch {
        return unavailable();
      }
      const response = new twilio.twiml.VoiceResponse();
      const action = `${input.publicBaseUrl}/twilio/canary/${encodeURIComponent(authenticated.callbackHandle)}`;
      // Keep a bounded readiness interval so report audio does not race the answered-call transition.
      const gather = response.gather({
        action,
        actionOnEmptyResult: true,
        finishOnKey: "",
        input: ["dtmf"],
        method: "POST",
        numDigits: 1,
        timeout: 1,
      });
      gather.pause({ length: 1 });
      gather.say(renderTwilioScenarioReport(authenticated.scenario));
      response.hangup();
      record("voice_rendered", traceIdentifiers(request)!);
      return Object.freeze({
        statusCode: 200,
        contentType: "application/xml",
        body: response.toString(),
      });
    },

    async handleCanary(request: TwilioSyntheticRequest): Promise<TwilioSyntheticResponse> {
      const authenticated = await authenticate(request, "canary");
      if (authenticated === "unmatched") return unmatched();
      if (authenticated === undefined) return rejected();
      const canary = dtmfSafetyStop.observe(request.form);
      try {
        await appendFact({
          phase: "canary",
          outcome: canary.status === "clear" ? "zero_dtmf" : "dtmf_observed",
          callbackHandle: authenticated.callbackHandle,
          identity: authenticated.identity,
          traceId: authenticated.traceId,
          actionsObserved: canary.actionsObserved === 0 ? 0 : 1,
        });
      } catch {
        return unavailable();
      }
      const response = new twilio.twiml.VoiceResponse();
      response.hangup();
      record(
        canary.status === "clear" ? "canary_clear" : "canary_failed",
        traceIdentifiers(request)!,
      );
      return Object.freeze({
        statusCode: 200,
        contentType: "application/xml",
        body: response.toString(),
        canary,
      });
    },

    async handleStatus(request: TwilioSyntheticRequest): Promise<TwilioSyntheticResponse> {
      const authenticated = await authenticate(request, "status");
      if (authenticated === "unmatched") return unmatched();
      if (authenticated === undefined) return rejected();
      const status = field(request, "CallStatus");
      const duration = field(request, "CallDuration");
      if (
        status === undefined ||
        !new Set(["completed", "busy", "failed", "no-answer", "canceled"]).has(status) ||
        (duration !== undefined && (!/^\d{1,2}$/u.test(duration) || Number(duration) > 60))
      ) {
        return rejected();
      }
      try {
        await appendFact({
          phase: "status",
          outcome: status === "completed" ? "completed" : "failed",
          callbackHandle: authenticated.callbackHandle,
          identity: authenticated.identity,
          traceId: authenticated.traceId,
          actionsObserved: null,
        });
      } catch {
        return unavailable();
      }
      record("status_recorded", traceIdentifiers(request)!);
      return Object.freeze({ statusCode: 204, contentType: "text/plain", body: "" });
    },
  });
}
