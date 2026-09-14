import { createHash, randomUUID } from "node:crypto";

import { Pool } from "pg";

import {
  ApplicationError,
  RecordObservationResult,
  RequestObservation,
  classifyApplicationError,
  type CallAttemptRepository,
  type RecordObservationResultDependencies,
  type VoiceCallResult,
} from "@muster/application";
import type { W3CTraceContext } from "@muster/contracts";
import { EndpointObservationProfile, OrganizationId } from "@muster/domain";
import { createCalleLiveObservationAdapter } from "@muster/infrastructure-calle";
import {
  LiveSimulatorJobHandler,
  createPgBossJobInfrastructure,
} from "@muster/infrastructure-jobs";
import { createLocalTranscriptCustody } from "@muster/infrastructure-local-evidence";
import {
  createPostgresPersistence,
  validatePostgresConnectionString,
} from "@muster/infrastructure-postgres";
import {
  CALLE_PROVIDER_OBSERVED_UNIT_MAPPING_RULE_ID,
  CALLE_PROVIDER_PERCENT_SYMBOL_UNIT_MAPPING_RULE_ID,
  calculateLiveSmokeWorkerTimeoutMs,
  createDtmfSafetyStop,
  createLiveSmokeEvidenceCoordinator,
  createLiveSmokeRunGate,
  LiveSmokeResultPersistenceError,
  createRepositoryTwilioCallbackAuthorizationPort,
  createRunAuthorizationReservationBoundary,
  createTwilioSyntheticEndpoint,
  verifyRunAuthorization,
  mapCalleTerminalOutput,
  type CalleTerminalOutput,
  type LiveSmokeResultPersistence,
  type RunAuthorizationReservationBoundary,
} from "@muster/infrastructure-twilio-simulator";
import { createSimulatorHostObservability } from "@muster/observability/simulator-host";
import { SIMULATOR_SCENARIO_CATALOG } from "@muster/testing";

import {
  loadSimulatorHostConfiguration,
  type SimulatorHostConfiguration,
} from "../configuration.js";
import {
  createLiveSimulatorController,
  startSimulatorHostHttpRuntime,
} from "../live-runs/live-simulator-http-runtime.js";
import {
  projectLiveSimulatorOperation,
  type LiveSimulatorAdmission,
} from "../live-runs/live-simulator-projection.js";
import { TwilioSimulatorController } from "../twilio/twilio-simulator.controller.js";
import { createSimulatorHost } from "./create-simulator-host.js";

interface OwnedPostgres {
  readonly liveSimulatorAuthorizations: ReturnType<
    typeof createPostgresPersistence
  >["liveSimulatorAuthorizations"];
  readonly liveSimulatorProviderFacts: ReturnType<
    typeof createPostgresPersistence
  >["liveSimulatorProviderFacts"];
  readonly callAttempts: ReturnType<typeof createPostgresPersistence>["callAttempts"];
  readonly observationProfiles: ReturnType<typeof createPostgresPersistence>["observationProfiles"];
  readonly evidence: ReturnType<typeof createPostgresPersistence>["evidence"];
  readonly observations: ReturnType<typeof createPostgresPersistence>["observations"];
  readonly runObservationResultTransaction: ReturnType<
    typeof createPostgresPersistence
  >["runObservationResultTransaction"];
  disconnect(): Promise<void>;
}

interface SimulatorHostObservabilityBoundary {
  establishTraceContext(
    input?:
      | Readonly<Record<string, string | undefined>>
      | { readonly traceparent: string; readonly tracestate?: string },
  ): {
    readonly traceparent: string;
    readonly tracestate?: string;
  };
  record(event: Readonly<{ outcome: string; reason?: string }>): void;
  runJobSpan<T>(operation: () => Promise<T>): Promise<T>;
  runProviderSpan<T>(operation: () => Promise<T>): Promise<T>;
  runCallbackSpan<T>(
    traceContext: { readonly traceparent: string; readonly tracestate?: string },
    operation: () => Promise<T>,
  ): Promise<T>;
  runRestSpan<T>(
    input: Readonly<{
      method: "GET" | "POST" | "OPTIONS" | "OTHER";
      route:
        | "/api/v1/live-simulator/capability"
        | "/api/v1/live-simulator/operations"
        | "/api/v1/live-simulator/operations/{operationId}";
      traceContext: W3CTraceContext;
    }>,
    operation: () => Promise<T>,
  ): Promise<T>;
  recordHttpRequest(input: {
    readonly method: "GET" | "POST" | "OPTIONS" | "OTHER";
    readonly route:
      | "/api/v1/live-simulator/capability"
      | "/api/v1/live-simulator/operations"
      | "/api/v1/live-simulator/operations/{operationId}"
      | "/twilio/voice"
      | "/twilio/status"
      | "/twilio/canary/{callbackHandle}";
    readonly statusCode: number;
    readonly durationSeconds: number;
  }): void;
  close(): Promise<void>;
}

function createLiveSimulatorObservationProfile(input: {
  readonly organizationId: OrganizationId;
  readonly endpointAlias: string;
  readonly authorizationAudience: string;
}): EndpointObservationProfile {
  const adapterIdentity = createHash("sha256")
    .update(`${input.organizationId.value}:${input.endpointAlias}:greenhouse.v3`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return EndpointObservationProfile.create({
    endpointId: input.endpointAlias,
    organizationId: input.organizationId,
    adapterVersionId: `adapter-live-simulator-${adapterIdentity}`,
    expectedZones: [
      ["zone-01", "degrees Fahrenheit", "degF"],
      ["zone-02", "degrees Fahrenheit", "degF"],
      ["zone-03", "percent", "percent"],
      ["zone-04", "percent", "percent"],
    ].map(([zoneId, spokenUnit, normalizedUnit], ordinal) => ({
      zoneId: zoneId!,
      ordinal,
      applicability: "required" as const,
      requiredFacet: "measurement" as const,
      allowedUnitMappings: [
        {
          ruleId: CALLE_PROVIDER_OBSERVED_UNIT_MAPPING_RULE_ID,
          spokenUnit: spokenUnit!,
          normalizedUnit: normalizedUnit!,
        },
        ...(spokenUnit === "percent"
          ? [
              {
                ruleId: CALLE_PROVIDER_PERCENT_SYMBOL_UNIT_MAPPING_RULE_ID,
                spokenUnit: "%",
                normalizedUnit: "percent",
              },
            ]
          : []),
      ],
    })),
    dtmfPolicy: { kind: "forbidden" },
    compatibility: "simulator-tested",
    provenance: "SIMULATED",
    authorizationReferenceId: `simulator-host:${input.authorizationAudience}:${input.endpointAlias}`,
  });
}

export function createPostgresDisconnect(input: {
  readonly disconnectPersistence: () => Promise<void>;
  readonly endPool: () => Promise<void>;
  readonly cleanupTimeoutMs?: number;
}): () => Promise<void> {
  const cleanupTimeoutMs = input.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
  if (!Number.isSafeInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1) {
    throw new Error("Simulator host PostgreSQL cleanup timeout is invalid");
  }
  let disconnectPromise: Promise<void> | undefined;
  return () =>
    (disconnectPromise ??= (async () => {
      const results = await Promise.allSettled([
        runCleanupWithinDeadline(input.disconnectPersistence, cleanupTimeoutMs),
        runCleanupWithinDeadline(input.endPool, cleanupTimeoutMs),
      ]);
      const failureCount = results.filter(({ status }) => status === "rejected").length;
      if (failureCount > 0) {
        throw new Error(`Simulator host PostgreSQL cleanup failed (${String(failureCount)})`);
      }
    })());
}

function createOwnedPostgres(configuration: SimulatorHostConfiguration): OwnedPostgres {
  const pool = new Pool({
    connectionString: validatePostgresConnectionString(configuration.connectionString),
    max: 3,
    connectionTimeoutMillis: 1_000,
    statement_timeout: 4_000,
    lock_timeout: 4_000,
  });
  const persistence = createPostgresPersistence(pool, { probeTimeoutMs: 500 });
  const disconnect = createPostgresDisconnect({
    disconnectPersistence: async () => await persistence.disconnect(),
    endPool: async () => await pool.end(),
  });
  return Object.freeze({
    ...persistence,
    disconnect,
  });
}

const defaultFactories = Object.freeze({
  createPostgres: createOwnedPostgres,
  createCustody: (configuration: SimulatorHostConfiguration) =>
    createLocalTranscriptCustody({
      rootDirectory: configuration.custodyRoot,
      maxTranscriptBytes: configuration.custodyMaxTranscriptBytes,
      maxEntries: configuration.custodyMaxEntries,
    }),
  createObservability: (): SimulatorHostObservabilityBoundary => createSimulatorHostObservability(),
  createProvider: (input: { readonly custody: ReturnType<typeof createLocalTranscriptCustody> }) =>
    createCalleLiveObservationAdapter({ custody: input.custody }),
  createTwilioEndpoint: (input: Parameters<typeof createTwilioSyntheticEndpoint>[0]) =>
    createTwilioSyntheticEndpoint(input),
  createJobs: (configuration: SimulatorHostConfiguration) =>
    createPgBossJobInfrastructure({
      connectionString: configuration.connectionString,
      schema: configuration.jobsSchema,
      concurrency: 1,
      observationConcurrency: 1,
      retryLimit: 0,
      workTimeoutSeconds: Math.ceil(
        calculateLiveSmokeWorkerTimeoutMs({
          callbackDeadlineMs: configuration.timeoutMs,
          providerTerminalTimeoutMs: configuration.providerTerminalTimeoutMs,
        }) / 1_000,
      ),
    }),
  startHttp: startSimulatorHostHttpRuntime,
});

export interface SimulatorHostProcessRuntime {
  readonly baseUrl: string;
  close(): Promise<void>;
}

type RuntimeFactories = typeof defaultFactories;

interface CloseableResource {
  close(): void | Promise<void>;
}

function isCloseableResource(resource: unknown): resource is CloseableResource {
  return (
    typeof resource === "object" &&
    resource !== null &&
    "close" in resource &&
    typeof resource.close === "function"
  );
}

const DEFAULT_CLEANUP_TIMEOUT_MS = 5_000;

async function runCleanupWithinDeadline(
  cleanup: () => Promise<void>,
  cleanupTimeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Simulator host resource cleanup timed out"));
    }, cleanupTimeoutMs);
    void Promise.resolve()
      .then(cleanup)
      .then(
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve();
        },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(new Error("Simulator host resource cleanup failed"));
        },
      );
  });
}

function createResourceOwnershipScope(cleanupTimeoutMs: number) {
  const cleanupOperations: Array<() => Promise<void>> = [];
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    own(cleanup: () => void | Promise<void>): void {
      cleanupOperations.push(async () => await cleanup());
    },
    ownCloseable(resource: unknown): void {
      if (isCloseableResource(resource)) {
        cleanupOperations.push(async () => await resource.close());
      }
    },
    close(): Promise<void> {
      return (closePromise ??= (async () => {
        let failureCount = 0;
        for (const cleanup of cleanupOperations.reverse()) {
          try {
            await runCleanupWithinDeadline(cleanup, cleanupTimeoutMs);
          } catch {
            failureCount += 1;
          }
        }
        if (failureCount > 0) {
          throw new Error(`Simulator host resource cleanup failed (${String(failureCount)})`);
        }
      })());
    },
  });
}

export function createSimulatorHostCallAttemptBoundaries(input: {
  readonly organizationId: OrganizationId | string;
  readonly callAttempts: Pick<
    CallAttemptRepository,
    "findById" | "recordCalling" | "recordTerminalFailure"
  >;
  readonly now: () => string;
  readonly liveAuthorizations?: Pick<
    OwnedPostgres["liveSimulatorAuthorizations"],
    "claimDispatch" | "recordDispatchDisposition"
  >;
}) {
  const organizationId =
    typeof input.organizationId === "string"
      ? OrganizationId.create(input.organizationId)
      : input.organizationId;
  return Object.freeze({
    terminalAttempts: Object.freeze({
      recordFailure: async (failure: {
        readonly operationId: string;
        readonly outcome:
          "blocked" | "no_answer" | "busy" | "provider_failed" | "evidence_unavailable";
        readonly retryable: false;
      }) => {
        const attempt = await input.callAttempts.findById(organizationId, failure.operationId);
        if (attempt === undefined) throw new Error("Live simulator CallAttempt is unavailable");
        if (attempt.stage === "terminal" && attempt.terminalOutcome !== null) {
          return Object.freeze({ terminalOutcome: attempt.terminalOutcome });
        }
        try {
          const terminal = await input.callAttempts.recordTerminalFailure({
            organizationId,
            operationId: failure.operationId,
            outcome: failure.outcome,
            retryable: false,
            transitionedAt: input.now(),
          });
          if (terminal.stage !== "terminal" || terminal.terminalOutcome === null) {
            throw new Error("Live simulator terminal CallAttempt is unavailable");
          }
          return Object.freeze({ terminalOutcome: terminal.terminalOutcome });
        } catch (error: unknown) {
          try {
            const winner = await input.callAttempts.findById(organizationId, failure.operationId);
            if (winner?.stage === "terminal" && winner.terminalOutcome !== null) {
              return Object.freeze({ terminalOutcome: winner.terminalOutcome });
            }
          } catch {
            // Preserve the transition failure when its durable winner cannot be read.
          }
          throw error;
        }
      },
    }),
    dispatchAttempts: Object.freeze({
      claim: async ({ operationId }: { readonly operationId: string }) => {
        const authorizationClaim = await input.liveAuthorizations?.claimDispatch({
          organizationId,
          operationId,
          claimedAt: input.now(),
        });
        if (
          authorizationClaim !== undefined &&
          authorizationClaim.outcome !== "claimed" &&
          authorizationClaim.outcome !== "reconcile"
        ) {
          throw new Error("Live simulator dispatch authorization is unavailable");
        }
        let attempt = await input.callAttempts.findById(organizationId, operationId);
        if (attempt === undefined || attempt.stage === "terminal") {
          throw new Error("Live simulator CallAttempt is unavailable");
        }
        if (attempt.stage === "scheduled") {
          attempt = (
            await input.callAttempts.recordCalling({
              organizationId,
              operationId,
              transitionedAt: input.now(),
            })
          ).value;
        }
        if (attempt.stage !== "calling") throw new Error("Live simulator CallAttempt is invalid");
        return Object.freeze({
          ...(authorizationClaim === undefined ? {} : { outcome: authorizationClaim.outcome }),
          providerDispatchIdentity: attempt.providerDispatchIdentity,
          adapterVersionId: attempt.adapterVersionId,
        });
      },
      recordDisposition: async (disposition: {
        readonly operationId: string;
        readonly outcome: "provider_returned" | "provider_failed";
      }): Promise<void> => {
        if (input.liveAuthorizations === undefined) return;
        const result = await input.liveAuthorizations.recordDispatchDisposition({
          organizationId,
          operationId: disposition.operationId,
          outcome: disposition.outcome,
        });
        if (result.outcome !== "recorded" && result.outcome !== "replayed") {
          throw new Error("Live simulator dispatch disposition was not durable");
        }
      },
    }),
  });
}

export function createAtomicLiveResultPersistence(input: {
  readonly organizationId: OrganizationId | string;
  readonly callAttempts: Pick<CallAttemptRepository, "findById">;
  readonly runObservationResultTransaction: ReturnType<
    typeof createPostgresPersistence
  >["runObservationResultTransaction"];
  readonly createRecordResult?: (
    repositories: Pick<
      RecordObservationResultDependencies,
      "attempts" | "profiles" | "evidence" | "observations"
    >,
  ) => Pick<RecordObservationResult, "execute">;
}): LiveSmokeResultPersistence {
  const organizationId =
    typeof input.organizationId === "string"
      ? OrganizationId.create(input.organizationId)
      : input.organizationId;
  const createRecordResult =
    input.createRecordResult ??
    ((repositories) =>
      new RecordObservationResult({
        ...repositories,
        clock: { now: () => new Date().toISOString() },
        identifiers: { generate: randomUUID },
      }));
  type CommitDisposition = Awaited<ReturnType<LiveSmokeResultPersistence["commitAtomically"]>>;
  const durableWinner = async (operationId: string): Promise<CommitDisposition | undefined> => {
    const attempt = await input.callAttempts.findById(organizationId, operationId);
    if (attempt?.stage !== "terminal" || attempt.terminalOutcome === null) return undefined;
    return attempt.terminalOutcome === "observation_recorded"
      ? Object.freeze({
          disposition: "committed" as const,
          winner: "observation_recorded" as const,
        })
      : Object.freeze({
          disposition: "committed" as const,
          winner: "terminal_failure" as const,
          terminalOutcome: attempt.terminalOutcome,
        });
  };
  class DurableTerminalFailureWinner extends Error {
    public constructor(
      public readonly terminalOutcome:
        "blocked" | "no_answer" | "busy" | "provider_failed" | "evidence_unavailable",
    ) {
      super("A durable terminal failure won result persistence");
      this.name = "DurableTerminalFailureWinner";
    }
  }
  return Object.freeze({
    commitAtomically: async (
      { operationId, result }: { readonly operationId: string; readonly result: VoiceCallResult },
      canCommit: () => boolean,
    ): Promise<CommitDisposition> => {
      try {
        const persisted = await input.runObservationResultTransaction(async (repositories) => {
          const output = await createRecordResult(repositories).execute({
            organizationId,
            operationId,
            result,
          });
          // The transaction checks this barrier again after the callback returns. Once it is closed,
          // preserve that authoritative rollback path instead of replacing it with admission errors.
          if (!canCommit()) return output;
          if (result.kind === "evidence" && output.kind === "terminal_failure") {
            if (
              output.attempt.stage !== "terminal" ||
              output.attempt.terminalOutcome === null ||
              output.attempt.terminalOutcome === "observation_recorded"
            ) {
              throw new Error("Live simulator terminal winner is invalid");
            }
            // A concurrent durable failure is authoritative, but no evidence staged in this
            // transaction may accompany it. The sentinel rolls this transaction back safely.
            throw new DurableTerminalFailureWinner(output.attempt.terminalOutcome);
          }
          if (
            result.kind === "evidence" &&
            (output.kind !== "observation_recorded" ||
              output.attempt.stage !== "terminal" ||
              output.attempt.terminalOutcome !== "observation_recorded" ||
              output.observation.quality !== "complete" ||
              output.observation.readings.length !== 4 ||
              output.observation.readings.some(({ disposition }) => disposition !== "grounded"))
          ) {
            throw new Error("Live simulator application admission rejected the result");
          }
          if (
            result.kind === "terminal_failure" &&
            (output.kind !== "terminal_failure" ||
              output.attempt.stage !== "terminal" ||
              output.attempt.terminalOutcome === null ||
              output.attempt.terminalOutcome === "observation_recorded")
          ) {
            throw new Error("Live simulator application admission rejected the terminal result");
          }
          return output;
        }, canCommit);
        if (persisted === undefined) {
          return (await durableWinner(operationId)) ?? Object.freeze({ disposition: "blocked" });
        }
        return persisted.kind === "observation_recorded"
          ? Object.freeze({
              disposition: "committed" as const,
              winner: "observation_recorded" as const,
            })
          : Object.freeze({
              disposition: "committed" as const,
              winner: "terminal_failure" as const,
              terminalOutcome: persisted.attempt.terminalOutcome as
                "blocked" | "no_answer" | "busy" | "provider_failed" | "evidence_unavailable",
            });
      } catch (error: unknown) {
        if (error instanceof DurableTerminalFailureWinner) {
          try {
            return (await durableWinner(operationId)) ?? Object.freeze({ disposition: "blocked" });
          } catch {
            throw new LiveSmokeResultPersistenceError("application_persistence_failed");
          }
        }
        try {
          const winner = await durableWinner(operationId);
          if (winner !== undefined) return winner;
        } catch {
          // Preserve the original safe classification when reconciliation is unavailable.
        }
        const safeError = classifyApplicationError(error);
        throw new LiveSmokeResultPersistenceError(
          safeError.code === "evidence_timestamp_invalid"
            ? "evidence_timestamp_invalid"
            : "application_persistence_failed",
        );
      }
    },
  });
}

function assertLiveTranscriptAdmission(evidence: CalleTerminalOutput["evidence"]): void {
  if (evidence === null || evidence.transcript === undefined || evidence.transcript.length === 0) {
    throw new Error("Live simulator transcript evidence is unavailable");
  }
}

export async function startSimulatorHostRuntime(input: {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly configuration?: SimulatorHostConfiguration;
  readonly cleanupTimeoutMs?: number;
  readonly factories?: RuntimeFactories;
  readonly createProvider?: RuntimeFactories["createProvider"];
  readonly decorateAuthorizationBoundary?: (
    boundary: RunAuthorizationReservationBoundary,
  ) => RunAuthorizationReservationBoundary;
  readonly runGate?: ReturnType<typeof createLiveSmokeRunGate>;
  readonly reconcileLiveSmoke?: (input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly providerCallDigest: string;
  }) => Promise<
    Readonly<{
      outcome: "one_matching_call" | "zero_calls" | "mismatched_call" | "multiple_calls";
      inboundCallCount: number;
    }>
  >;
  readonly cleanupLiveSmoke?: () => Promise<unknown>;
  readonly assertRuntimeSecretsAvailable?: () => void;
  readonly observeViewerReadiness?: Parameters<
    typeof startSimulatorHostHttpRuntime
  >[0]["observeViewerReadiness"];
}): Promise<SimulatorHostProcessRuntime> {
  const configuration =
    input.configuration ?? loadSimulatorHostConfiguration(input.environment ?? process.env);
  const factories = input.factories ?? defaultFactories;
  const createProvider = input.createProvider ?? factories.createProvider;
  const assertRuntimeSecretsAvailable = input.assertRuntimeSecretsAvailable ?? (() => undefined);
  const cleanupTimeoutMs = input.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
  if (!Number.isSafeInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1) {
    throw new Error("Simulator host cleanup timeout is invalid");
  }
  const organizationId = OrganizationId.create(configuration.organizationId);
  const ownership = createResourceOwnershipScope(cleanupTimeoutMs);
  try {
    const postgres = factories.createPostgres(configuration);
    ownership.own(async () => await postgres.disconnect());
    await postgres.observationProfiles.establish(
      createLiveSimulatorObservationProfile({
        organizationId,
        endpointAlias: configuration.endpointAlias,
        authorizationAudience: configuration.authorizationAudience,
      }),
    );
    const custody = factories.createCustody(configuration);
    ownership.ownCloseable(custody);
    const observability = factories.createObservability();
    ownership.own(async () => await observability.close());
    const dtmfSafetyStop = createDtmfSafetyStop();
    const pendingCallbackPersistenceFailures = new Set<string>();
    const callbackActivity: {
      record?: (input: { readonly operationId: string }) => void;
      recordPersistenceFailure: (input: { readonly operationId: string }) => void;
    } = {
      recordPersistenceFailure: ({ operationId }) => {
        pendingCallbackPersistenceFailures.add(operationId);
      },
    };
    const callbackAuthorizations = createRepositoryTwilioCallbackAuthorizationPort({
      authorizations: postgres.liveSimulatorAuthorizations,
      scenarios: SIMULATOR_SCENARIO_CATALOG,
      now: () => new Date().toISOString(),
    });
    const twilioEndpoint = factories.createTwilioEndpoint({
      organizationId,
      publicBaseUrl: configuration.publicBaseUrl,
      endpointAlias: configuration.endpointAlias,
      audience: configuration.authorizationAudience,
      twilioAuthToken: configuration.twilioAuthToken,
      identityHmacKey: configuration.callbackIdentityHmacKey,
      callbackAuthorizations,
      providerFacts: {
        append: async (fact) => {
          const result = await postgres.liveSimulatorProviderFacts.append(fact);
          if (
            fact.signatureValidated &&
            (fact.phase === "voice" || fact.phase === "canary" || fact.phase === "status")
          ) {
            callbackActivity.record?.({ operationId: fact.operationId });
          }
          return result;
        },
        listForOperation: async (factOrganizationId, operationId) =>
          await postgres.liveSimulatorProviderFacts.listForOperation(
            factOrganizationId,
            operationId,
          ),
      },
      onProviderFactPersistenceFailure: ({ operationId }) =>
        callbackActivity.recordPersistenceFailure({ operationId }),
      recordEvent: (event) => observability.record(event),
      dtmfSafetyStop,
    });
    ownership.ownCloseable(twilioEndpoint);
    const twilioController = new TwilioSimulatorController(twilioEndpoint);
    const controller = Object.freeze({
      async voice(request: Parameters<TwilioSimulatorController["voice"]>[0]) {
        assertRuntimeSecretsAvailable();
        return await twilioController.voice(request);
      },
      async canary(request: Parameters<TwilioSimulatorController["canary"]>[0]) {
        assertRuntimeSecretsAvailable();
        return await twilioController.canary(request);
      },
      async status(request: Parameters<TwilioSimulatorController["status"]>[0]) {
        assertRuntimeSecretsAvailable();
        return await twilioController.status(request);
      },
    });
    const durableAuthorizationBoundary = createRunAuthorizationReservationBoundary({
      organizationId,
      signingKey: configuration.authorizationSigningKey,
      audience: configuration.authorizationAudience,
      endpointAlias: configuration.endpointAlias,
      authorizationReservations: postgres.liveSimulatorAuthorizations,
      authorizedTargetDigest: configuration.authorizedTargetDigest,
      publicOrigin: configuration.publicBaseUrl,
      nowEpochSeconds: () => Math.floor(Date.now() / 1_000),
    });
    const guardedAuthorizationBoundary: RunAuthorizationReservationBoundary = Object.freeze({
      async reserve(reservation: Parameters<RunAuthorizationReservationBoundary["reserve"]>[0]) {
        assertRuntimeSecretsAvailable();
        return await durableAuthorizationBoundary.reserve(reservation);
      },
    });
    const authorizationBoundary =
      input.decorateAuthorizationBoundary?.(guardedAuthorizationBoundary) ??
      guardedAuthorizationBoundary;
    const admissions = new Map<string, LiveSimulatorAdmission>();
    const evidencePersistence = {
      persistAdmission: async (admission: {
        readonly operationId: string;
        readonly adapterVersionId: string;
        readonly providerFacts: {
          readonly providerCallId: string;
          readonly observedAt: string;
        };
        readonly evidence: CalleTerminalOutput["evidence"];
      }): Promise<void> => {
        assertLiveTranscriptAdmission(admission.evidence);
        // The provider has already durably retained the bounded transcript in custody. Keep the
        // validated presentation admission in process, then let the result transaction stage the
        // EvidenceRecord with its Observation and four Reading rows as one atomic completion.
        admissions.set(admission.operationId, Object.freeze({ evidence: admission.evidence }));
      },
    };
    const { terminalAttempts, dispatchAttempts } = createSimulatorHostCallAttemptBoundaries({
      organizationId,
      callAttempts: postgres.callAttempts,
      liveAuthorizations: postgres.liveSimulatorAuthorizations,
      now: () => new Date().toISOString(),
    });
    const runGate = input.runGate ?? createLiveSmokeRunGate("OPEN");
    const evidenceCoordinator = createLiveSmokeEvidenceCoordinator({
      organizationId,
      providerFacts: postgres.liveSimulatorProviderFacts,
      terminalAttempts: {
        recordFailure: async ({ operationId, outcome, retryable }) => {
          await terminalAttempts.recordFailure({
            operationId,
            outcome,
            retryable,
          });
        },
      },
      closeRunGate: () => runGate.close(),
      ...(input.cleanupLiveSmoke === undefined
        ? {}
        : {
            cleanup: async () => {
              await input.cleanupLiveSmoke?.();
            },
          }),
      admitCalleEvidence: async (providerOutput) => {
        try {
          await mapCalleTerminalOutput(
            providerOutput,
            {
              operationId: "admission-only",
              adapterVersionId: "admission-only",
              simulationRunId: "admission-only",
            },
            {
              reviewedConfidenceTokens: ["provider-observed"],
              persistAdmission: async ({ evidence }) => {
                assertLiveTranscriptAdmission(evidence);
              },
            },
          );
          return Object.freeze({ outcome: "admissible" as const });
        } catch {
          return Object.freeze({ outcome: "inadmissible" as const });
        }
      },
      reconcile:
        input.reconcileLiveSmoke ??
        (async () => Object.freeze({ outcome: "zero_calls" as const, inboundCallCount: 0 })),
    });
    callbackActivity.record = ({ operationId }) =>
      evidenceCoordinator.recordCallbackActivity({ organizationId, operationId });
    callbackActivity.recordPersistenceFailure = ({ operationId }) =>
      evidenceCoordinator.recordProviderFactPersistenceFailure({ organizationId, operationId });
    for (const operationId of pendingCallbackPersistenceFailures) {
      callbackActivity.recordPersistenceFailure({ operationId });
    }
    pendingCallbackPersistenceFailures.clear();
    const host = createSimulatorHost({
      configuration,
      authorizationBoundary,
      evidencePersistence,
      reviewedConfidenceTokens: ["provider-observed"],
      observability,
      terminalAttempts,
      // Reservation is dispatch authority; the first exact caller/target callback atomically
      // binds the provider CallSid. Binding this internal attempt identity would race the callback.
      dispatchAttempts,
      resultPersistence: createAtomicLiveResultPersistence({
        organizationId,
        callAttempts: postgres.callAttempts,
        runObservationResultTransaction: postgres.runObservationResultTransaction,
      }),
      ...(input.runGate === undefined
        ? {}
        : {
            runGate,
            evidenceCoordinator: {
              claimTerminalPersistence: ({ operationId }: { operationId: string }) =>
                evidenceCoordinator.claimTerminalPersistence({ organizationId, operationId }),
              onTerminal: (
                { operationId }: { operationId: string },
                listener: (reason: "provider_failed" | "persistence_unavailable") => void,
              ) => evidenceCoordinator.onTerminal({ organizationId, operationId }, listener),
              settle: ({ operationId }: { operationId: string }) =>
                evidenceCoordinator.settle({ organizationId, operationId }),
              completeTerminalPersistence: ({ operationId }: { operationId: string }) =>
                evidenceCoordinator.completeTerminalPersistence({ organizationId, operationId }),
              begin: ({
                operationId,
                deadlineMs,
                terminalDeadlineMs,
              }: {
                operationId: string;
                deadlineMs: number;
                terminalDeadlineMs: number;
              }) =>
                evidenceCoordinator.begin({
                  organizationId,
                  operationId,
                  deadlineMs,
                  terminalDeadlineMs,
                }),
              recordCalleTerminal: async (record: {
                operationId: string;
                providerOutput: unknown;
                traceId: string;
                providerCallDigest: string;
              }) => await evidenceCoordinator.recordCalleTerminal(record),
              assertReady: async ({ operationId }: { operationId: string }) =>
                await evidenceCoordinator.waitUntilReady({ organizationId, operationId }),
            },
          }),
      dtmfSafetyStop,
      createProvider: () => createProvider({ custody }),
    });
    const jobs = factories.createJobs(configuration);
    ownership.own(async () => await jobs.stop());
    await jobs.start();
    const guardedHost = Object.freeze({
      async execute(execution: Parameters<typeof host.execute>[0]) {
        assertRuntimeSecretsAvailable();
        return await host.execute(execution);
      },
    });
    const handler = new LiveSimulatorJobHandler(guardedHost, {
      recordFailure: async (failure) => {
        await terminalAttempts.recordFailure(failure);
      },
    });
    await jobs.workLiveSimulator(async (payload, context) => {
      await handler.handle(payload, context);
    });
    const liveController = createLiveSimulatorController({
      runtimeProfile: configuration.runtimeProfile,
      enabled: configuration.enabled,
      scenarios: SIMULATOR_SCENARIO_CATALOG,
      requestLiveObservation: async (request) => {
        assertRuntimeSecretsAvailable();
        let claims: ReturnType<typeof verifyRunAuthorization>;
        try {
          claims = verifyRunAuthorization({
            token: request.permit,
            signingKey: configuration.authorizationSigningKey,
            audience: configuration.authorizationAudience,
            endpointAlias: configuration.endpointAlias,
            nowEpochSeconds: Math.floor(Date.now() / 1_000),
            authorizedTargetDigest: configuration.authorizedTargetDigest,
            publicOrigin: configuration.publicBaseUrl,
          });
        } catch {
          throw ApplicationError.validation("live_authorization_invalid");
        }
        if (
          claims.scenarioId !== request.scenarioId ||
          claims.scenarioRevision !== request.scenarioRevision
        ) {
          throw ApplicationError.validation("live_authorization_invalid");
        }
        const establish = new RequestObservation({
          profiles: postgres.observationProfiles,
          attempts: postgres.callAttempts,
          scheduler: {
            scheduleObservation: async (payload) => {
              const scheduled = await jobs.scheduleLiveSimulator({
                version: "1",
                operationId: payload.operationId,
                scenarioId: claims.scenarioId,
                scenarioRevision: claims.scenarioRevision,
                runAuthorization: request.permit,
                ...(claims.predecessorOperationId === null
                  ? {}
                  : { predecessorOperationId: claims.predecessorOperationId }),
                ...(payload.traceContext === undefined
                  ? {}
                  : { traceContext: payload.traceContext }),
              });
              if (scheduled.outcome === "scheduled") {
                return scheduled.jobId === undefined
                  ? Object.freeze({ outcome: "rejected" as const })
                  : Object.freeze({ outcome: "scheduled" as const, jobId: scheduled.jobId });
              }
              return Object.freeze({ outcome: scheduled.outcome });
            },
          },
          clock: { now: () => new Date().toISOString() },
          identifiers: { generate: () => claims.runId },
        });
        const established = await establish.execute({
          organizationId,
          endpointId: configuration.endpointAlias,
          pollWindowId: `${claims.scenarioId}@${String(claims.scenarioRevision)}`,
          idempotencyKey: `live-simulator:${claims.runId}`,
          correlationId: claims.runId,
          trigger: "manual",
          traceContext: request.traceContext,
        });
        return Object.freeze({
          operationId: established.operation.id,
          resourceVersion: 0,
        });
      },
      getLiveObservation: async (operationId) => {
        const authorization = await postgres.liveSimulatorAuthorizations.findByOperationId(
          organizationId,
          operationId,
        );
        if (authorization === undefined) return undefined;
        const operation = await postgres.observations.findOperation(organizationId, operationId);
        if (operation === undefined) {
          return Object.freeze({
            operationId,
            resourceVersion: 0,
            stage: "scheduled" as const,
            terminal: false,
            terminalOutcome: null,
            scenarioId: authorization.scenarioId,
            scenarioRevision: authorization.scenarioRevision,
            provenance: "SIMULATED" as const,
            transcript: Object.freeze([]),
            evidence: null,
            readings: Object.freeze([]),
            reconciliation: Object.freeze([]),
            auxiliaryStatus: null,
            predecessorOperationId: authorization.predecessorOperationId,
          });
        }
        if (operation.attempt.provenance !== "SIMULATED") {
          return undefined;
        }
        const evidenceRecord =
          operation.evidence === null
            ? undefined
            : await postgres.evidence.findById(organizationId, operation.evidence.evidenceId);
        return projectLiveSimulatorOperation({
          operation,
          authorization,
          evidenceRecord,
          admission: admissions.get(operationId),
        });
      },
    });
    const http = await factories.startHttp({
      host: configuration.listenHost,
      port: configuration.listenPort,
      publicBaseUrl: configuration.publicBaseUrl,
      maxBodyBytes: 16_384,
      closeTimeoutMs: cleanupTimeoutMs,
      allowedDemoOrigin: configuration.demoOrigin,
      liveController,
      twilioController: controller,
      establishTraceContext: (headers) => observability.establishTraceContext(headers),
      runRestSpan: (restInput, operation) => observability.runRestSpan(restInput, operation),
      runCallbackSpan: (traceContext, operation) =>
        observability.runCallbackSpan(traceContext, operation),
      recordHttpRequest: (request) => observability.recordHttpRequest(request),
      ...(input.observeViewerReadiness === undefined
        ? {}
        : { observeViewerReadiness: input.observeViewerReadiness }),
    });
    ownership.own(async () => await http.close());
    return Object.freeze({ baseUrl: http.baseUrl, close: () => ownership.close() });
  } catch (error: unknown) {
    try {
      await ownership.close();
    } catch {
      throw new Error("Simulator host construction failed and rollback was incomplete");
    }
    throw error;
  }
}

export async function startGuardedSimulatorHostRuntime(
  input: Omit<
    Parameters<typeof startSimulatorHostRuntime>[0],
    "runGate" | "reconcileLiveSmoke" | "cleanupLiveSmoke" | "assertRuntimeSecretsAvailable"
  > & {
    readonly runGate: ReturnType<typeof createLiveSmokeRunGate>;
    readonly reconcileLiveSmoke: NonNullable<
      Parameters<typeof startSimulatorHostRuntime>[0]["reconcileLiveSmoke"]
    >;
    readonly cleanupLiveSmoke: NonNullable<
      Parameters<typeof startSimulatorHostRuntime>[0]["cleanupLiveSmoke"]
    >;
    readonly assertRuntimeSecretsAvailable: NonNullable<
      Parameters<typeof startSimulatorHostRuntime>[0]["assertRuntimeSecretsAvailable"]
    >;
  },
): Promise<SimulatorHostProcessRuntime> {
  if (input.runGate.state() !== "CLOSED") {
    throw new Error("Guarded simulator host must start with the run gate closed");
  }
  return await startSimulatorHostRuntime(input);
}
