import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type {
  LiveSimulatorAuthorizationBindingPort,
  LiveSimulatorAuthorizationIssuerPort,
  LiveSimulatorAuthorizationReservationPort,
} from "@muster/application";
import type { OrganizationId } from "@muster/domain";

export type RunAuthorizationBinding = "bound" | "replayed" | "conflict" | "missing" | "expired";

export type RunAuthorizationReservation =
  "reserved" | "replayed" | "conflict" | "missing" | "expired" | "invalid_predecessor";

export interface RunAuthorizationReservationBoundary {
  reserve(input: {
    readonly token: string;
    readonly runId: string;
    readonly scenarioId: string;
    readonly scenarioRevision: number;
    readonly audience: string;
    readonly endpointAlias: string;
    readonly predecessorOperationId?: string | null;
  }): Promise<RunAuthorizationReservation>;
}

export interface RunAuthorizationClaims {
  readonly audience: string;
  readonly runId: string;
  readonly scenarioId: string;
  readonly scenarioRevision: number;
  readonly endpointAlias: string;
  readonly authorizedTargetDigest: string;
  readonly publicOrigin: string;
  readonly purpose: "non-production-synthetic-live-smoke";
  readonly callBudget: 1;
  readonly concurrency: 1;
  readonly retryBudget: 0;
  readonly dtmfPolicy: "forbidden";
  readonly terminalDeadlineSeconds: number;
  readonly issuedAtEpochSeconds: number;
  readonly expiresAtEpochSeconds: number;
  readonly nonce: string;
  readonly predecessorOperationId: string | null;
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const aliasPattern = /^[a-z][a-z0-9-]{0,62}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;

function requireIdentifier(value: string, field: string): string {
  if (!identifierPattern.test(value)) throw new Error(`Invalid run authorization: ${field}`);
  return value;
}

function requireAlias(value: string, field: string): string {
  if (!aliasPattern.test(value)) throw new Error(`Invalid run authorization: ${field}`);
  return value;
}

function requireSigningKey(value: string): string {
  if (value.length < 32) throw new Error("Invalid run authorization: signingKey");
  return value;
}

function requireDigest(value: string, field: string): string {
  if (!digestPattern.test(value)) throw new Error(`Invalid run authorization: ${field}`);
  return value;
}

function requirePublicOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid run authorization: publicOrigin");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.origin !== value
  ) {
    throw new Error("Invalid run authorization: publicOrigin");
  }
  return value;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(payload: string, signingKey: string): string {
  return createHmac("sha256", requireSigningKey(signingKey))
    .update(payload, "utf8")
    .digest("base64url");
}

function nonceDigest(nonce: string): string {
  return createHash("sha256").update(nonce, "utf8").digest("hex");
}

function requireEpochSeconds(value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error("Invalid run authorization: nowEpochSeconds");
  }
  return value;
}

function validateClaims(value: unknown): RunAuthorizationClaims {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid run authorization: payload");
  }
  const claims = value as Partial<RunAuthorizationClaims>;
  const keys = Object.keys(value);
  const expectedKeys = [
    "audience",
    "runId",
    "scenarioId",
    "scenarioRevision",
    "endpointAlias",
    "authorizedTargetDigest",
    "publicOrigin",
    "purpose",
    "callBudget",
    "concurrency",
    "retryBudget",
    "dtmfPolicy",
    "terminalDeadlineSeconds",
    "issuedAtEpochSeconds",
    "expiresAtEpochSeconds",
    "nonce",
    "predecessorOperationId",
  ];
  if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) {
    throw new Error("Invalid run authorization: payload");
  }
  if (
    typeof claims.audience !== "string" ||
    typeof claims.runId !== "string" ||
    typeof claims.scenarioId !== "string" ||
    typeof claims.endpointAlias !== "string" ||
    typeof claims.authorizedTargetDigest !== "string" ||
    typeof claims.publicOrigin !== "string" ||
    typeof claims.nonce !== "string" ||
    (claims.predecessorOperationId !== null && typeof claims.predecessorOperationId !== "string") ||
    !Number.isSafeInteger(claims.scenarioRevision) ||
    !Number.isSafeInteger(claims.issuedAtEpochSeconds) ||
    !Number.isSafeInteger(claims.expiresAtEpochSeconds)
  ) {
    throw new Error("Invalid run authorization: payload");
  }
  requireIdentifier(claims.audience, "audience");
  requireIdentifier(claims.runId, "runId");
  requireAlias(claims.scenarioId, "scenarioId");
  requireAlias(claims.endpointAlias, "endpointAlias");
  requireDigest(claims.authorizedTargetDigest, "authorizedTargetDigest");
  requirePublicOrigin(claims.publicOrigin);
  requireIdentifier(claims.nonce, "nonce");
  if (claims.predecessorOperationId !== null) {
    requireIdentifier(claims.predecessorOperationId, "predecessorOperationId");
  }
  if ((claims.scenarioRevision ?? 0) < 1) {
    throw new Error("Invalid run authorization: scenarioRevision");
  }
  if (
    claims.purpose !== "non-production-synthetic-live-smoke" ||
    claims.callBudget !== 1 ||
    claims.concurrency !== 1 ||
    claims.retryBudget !== 0 ||
    claims.dtmfPolicy !== "forbidden" ||
    !Number.isSafeInteger(claims.terminalDeadlineSeconds) ||
    (claims.terminalDeadlineSeconds ?? 0) < 1 ||
    (claims.terminalDeadlineSeconds ?? 0) > 120
  ) {
    throw new Error("Invalid run authorization: safety claims");
  }
  if ((claims.expiresAtEpochSeconds ?? 0) <= (claims.issuedAtEpochSeconds ?? 0)) {
    throw new Error("Invalid run authorization: expiry");
  }
  return Object.freeze(claims as RunAuthorizationClaims);
}

export async function issueRunAuthorization(input: {
  readonly organizationId: OrganizationId;
  readonly runId: string;
  readonly scenarioId: string;
  readonly scenarioRevision: number;
  readonly endpointAlias: string;
  readonly audience: string;
  readonly authorizedTargetDigest: string;
  readonly publicOrigin: string;
  readonly purpose: "non-production-synthetic-live-smoke";
  readonly callBudget: 1;
  readonly concurrency: 1;
  readonly retryBudget: 0;
  readonly dtmfPolicy: "forbidden";
  readonly terminalDeadlineSeconds: number;
  readonly signingKey: string;
  readonly nonce: string;
  readonly predecessorOperationId?: string | null;
  readonly nowEpochSeconds: number;
  readonly ttlSeconds: number;
  readonly authorizationIssuer: LiveSimulatorAuthorizationIssuerPort;
}): Promise<Readonly<{ token: string; expiresAtEpochSeconds: number }>> {
  const nowEpochSeconds = requireEpochSeconds(input.nowEpochSeconds);
  if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds < 1 || input.ttlSeconds > 300) {
    throw new Error("Invalid run authorization: ttlSeconds");
  }
  const claims = validateClaims({
    audience: input.audience,
    runId: input.runId,
    scenarioId: input.scenarioId,
    scenarioRevision: input.scenarioRevision,
    endpointAlias: input.endpointAlias,
    authorizedTargetDigest: input.authorizedTargetDigest,
    publicOrigin: input.publicOrigin,
    purpose: input.purpose,
    callBudget: input.callBudget,
    concurrency: input.concurrency,
    retryBudget: input.retryBudget,
    dtmfPolicy: input.dtmfPolicy,
    terminalDeadlineSeconds: input.terminalDeadlineSeconds,
    issuedAtEpochSeconds: nowEpochSeconds,
    expiresAtEpochSeconds: nowEpochSeconds + input.ttlSeconds,
    nonce: input.nonce,
    predecessorOperationId: input.predecessorOperationId ?? null,
  });
  const semanticDigest = createHash("sha256")
    .update(
      JSON.stringify([
        claims.runId,
        claims.scenarioId,
        claims.scenarioRevision,
        claims.audience,
        claims.endpointAlias,
        claims.authorizedTargetDigest,
        claims.publicOrigin,
        claims.purpose,
        claims.callBudget,
        claims.concurrency,
        claims.retryBudget,
        claims.dtmfPolicy,
        claims.terminalDeadlineSeconds,
        claims.expiresAtEpochSeconds,
        claims.predecessorOperationId,
      ]),
      "utf8",
    )
    .digest("hex");
  await input.authorizationIssuer.issue({
    organizationId: input.organizationId,
    nonceDigest: nonceDigest(claims.nonce),
    semanticDigest,
    operationId: claims.runId,
    scenarioId: claims.scenarioId,
    scenarioRevision: claims.scenarioRevision,
    audience: claims.audience,
    endpointAlias: claims.endpointAlias,
    authorizedTargetDigest: claims.authorizedTargetDigest,
    publicOrigin: claims.publicOrigin,
    purpose: claims.purpose,
    callBudget: claims.callBudget,
    concurrency: claims.concurrency,
    retryBudget: claims.retryBudget,
    dtmfPolicy: claims.dtmfPolicy,
    terminalDeadlineSeconds: claims.terminalDeadlineSeconds,
    predecessorOperationId: claims.predecessorOperationId,
    issuedAt: new Date(claims.issuedAtEpochSeconds * 1_000).toISOString(),
    expiresAt: new Date(claims.expiresAtEpochSeconds * 1_000).toISOString(),
  });
  const payload = encode(JSON.stringify(claims));
  return Object.freeze({
    token: `${payload}.${sign(payload, input.signingKey)}`,
    expiresAtEpochSeconds: claims.expiresAtEpochSeconds,
  });
}

export function verifyRunAuthorization(input: {
  readonly token: string;
  readonly signingKey: string;
  readonly audience: string;
  readonly endpointAlias: string;
  readonly nowEpochSeconds: number;
  readonly authorizedTargetDigest?: string;
  readonly publicOrigin?: string;
  readonly purpose?: "non-production-synthetic-live-smoke";
  readonly callBudget?: 1;
  readonly concurrency?: 1;
  readonly retryBudget?: 0;
  readonly dtmfPolicy?: "forbidden";
  readonly terminalDeadlineSeconds?: number;
}): RunAuthorizationClaims {
  const nowEpochSeconds = requireEpochSeconds(input.nowEpochSeconds);
  if (input.token.length === 0 || input.token.length > 4096) {
    throw new Error("Invalid run authorization: token");
  }
  const parts = input.token.split(".");
  const payload = parts[0];
  const suppliedSignature = parts[1];
  if (parts.length !== 2 || payload === undefined || suppliedSignature === undefined) {
    throw new Error("Invalid run authorization: token");
  }
  const expectedSignature = sign(payload, input.signingKey);
  const expected = Buffer.from(expectedSignature, "utf8");
  const supplied = Buffer.from(suppliedSignature, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error("Invalid run authorization: signature");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new Error("Invalid run authorization: payload");
  }
  const claims = validateClaims(decoded);
  if (
    claims.audience !== input.audience ||
    claims.endpointAlias !== input.endpointAlias ||
    claims.issuedAtEpochSeconds > nowEpochSeconds ||
    claims.expiresAtEpochSeconds <= nowEpochSeconds
  ) {
    throw new Error("Invalid run authorization: claims");
  }
  for (const [expected, actual] of [
    [input.authorizedTargetDigest, claims.authorizedTargetDigest],
    [input.publicOrigin, claims.publicOrigin],
    [input.purpose, claims.purpose],
    [input.callBudget, claims.callBudget],
    [input.concurrency, claims.concurrency],
    [input.retryBudget, claims.retryBudget],
    [input.dtmfPolicy, claims.dtmfPolicy],
    [input.terminalDeadlineSeconds, claims.terminalDeadlineSeconds],
  ] as const) {
    if (expected !== undefined && expected !== actual) {
      throw new Error("Invalid run authorization: claims");
    }
  }
  return claims;
}

/** Builds the composition-root boundary that validates signed exact claims before
 * atomically reserving the nonce in a durable, single-use store. */
export function createRunAuthorizationReservationBoundary(input: {
  readonly organizationId: OrganizationId;
  readonly signingKey: string;
  readonly audience: string;
  readonly endpointAlias: string;
  readonly authorizationReservations: LiveSimulatorAuthorizationReservationPort;
  readonly authorizedTargetDigest: string;
  readonly publicOrigin: string;
  readonly nowEpochSeconds: () => number;
}): RunAuthorizationReservationBoundary {
  return Object.freeze({
    async reserve(
      request: Parameters<RunAuthorizationReservationBoundary["reserve"]>[0],
    ): Promise<RunAuthorizationReservation> {
      if (request.audience !== input.audience || request.endpointAlias !== input.endpointAlias) {
        return "conflict";
      }
      let claims: RunAuthorizationClaims;
      let nowEpochSeconds: number;
      try {
        nowEpochSeconds = requireEpochSeconds(input.nowEpochSeconds());
        claims = verifyRunAuthorization({
          token: request.token,
          signingKey: input.signingKey,
          audience: input.audience,
          endpointAlias: input.endpointAlias,
          nowEpochSeconds,
          authorizedTargetDigest: input.authorizedTargetDigest,
          publicOrigin: input.publicOrigin,
          purpose: "non-production-synthetic-live-smoke",
          callBudget: 1,
          concurrency: 1,
          retryBudget: 0,
          dtmfPolicy: "forbidden",
          terminalDeadlineSeconds: 120,
        });
      } catch {
        return "conflict";
      }
      if (
        claims.runId !== request.runId ||
        claims.scenarioId !== request.scenarioId ||
        claims.scenarioRevision !== request.scenarioRevision ||
        claims.predecessorOperationId !== (request.predecessorOperationId ?? null)
      ) {
        return "conflict";
      }
      const semanticDigest = createHash("sha256")
        .update(
          JSON.stringify([
            claims.runId,
            claims.scenarioId,
            claims.scenarioRevision,
            claims.audience,
            claims.endpointAlias,
            claims.authorizedTargetDigest,
            claims.publicOrigin,
            claims.purpose,
            claims.callBudget,
            claims.concurrency,
            claims.retryBudget,
            claims.dtmfPolicy,
            claims.terminalDeadlineSeconds,
            claims.expiresAtEpochSeconds,
            claims.predecessorOperationId,
          ]),
          "utf8",
        )
        .digest("hex");
      const reservation = await input.authorizationReservations.reserve({
        organizationId: input.organizationId,
        nonceDigest: nonceDigest(claims.nonce),
        semanticDigest,
        now: new Date(nowEpochSeconds * 1_000).toISOString(),
        operationId: claims.runId,
        scenarioId: claims.scenarioId,
        scenarioRevision: claims.scenarioRevision,
        audience: claims.audience,
        endpointAlias: claims.endpointAlias,
        authorizedTargetDigest: claims.authorizedTargetDigest,
        publicOrigin: claims.publicOrigin,
        purpose: claims.purpose,
        callBudget: claims.callBudget,
        concurrency: claims.concurrency,
        retryBudget: claims.retryBudget,
        dtmfPolicy: claims.dtmfPolicy,
        terminalDeadlineSeconds: claims.terminalDeadlineSeconds,
        predecessorOperationId: claims.predecessorOperationId,
      });
      return reservation.outcome;
    },
  });
}

export async function bindRunAuthorization(input: {
  readonly organizationId: OrganizationId;
  readonly claims: RunAuthorizationClaims;
  readonly providerCallId: string;
  readonly nowEpochSeconds: number;
  readonly authorizationBindings: LiveSimulatorAuthorizationBindingPort;
}): Promise<"bound" | "replayed"> {
  const providerCallId = requireIdentifier(input.providerCallId, "providerCallId");
  const result = await input.authorizationBindings.bind({
    organizationId: input.organizationId,
    nonceDigest: nonceDigest(input.claims.nonce),
    providerDispatchIdentity: providerCallId,
    boundAt: new Date(requireEpochSeconds(input.nowEpochSeconds) * 1_000).toISOString(),
    operationId: input.claims.runId,
  });
  const disposition = result.outcome;
  if (disposition !== "bound" && disposition !== "replayed") {
    throw new Error("Run authorization cannot be consumed");
  }
  return disposition;
}
