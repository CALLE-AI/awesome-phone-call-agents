import { ApplicationError } from "@muster/application";
import type { ObservationOperationResponse } from "@muster/contracts";
import {
  CallAttempt,
  EndpointObservationProfile,
  EvidenceRecord,
  Observation,
  OrganizationId,
  Reading,
  type ObservationProvenance,
} from "@muster/domain";
import { deployMigrations, getPostgresTestConnectionUrls } from "@muster/testing";
import { describe, expect, it } from "vitest";

interface EstablishResult<T> {
  readonly outcome: "established" | "replayed";
  readonly value: T;
}

interface AppendResult<T> {
  readonly outcome: "appended" | "replayed";
  readonly value: T;
}

interface ObservationPersistence {
  readonly observationProfiles: {
    establish(
      profile: EndpointObservationProfile,
    ): Promise<EstablishResult<EndpointObservationProfile>>;
    findByEndpoint(
      organizationId: OrganizationId,
      endpointId: string,
    ): Promise<EndpointObservationProfile | undefined>;
  };
  readonly callAttempts: {
    establish(input: {
      readonly idempotencyKey: string;
      readonly attempt: CallAttempt;
    }): Promise<EstablishResult<CallAttempt>>;
    recordCalling(input: {
      readonly organizationId: OrganizationId;
      readonly operationId: string;
      readonly transitionedAt: string;
    }): Promise<{ readonly outcome: "transitioned" | "replayed"; readonly value: CallAttempt }>;
    recordExtracting(input: {
      readonly organizationId: OrganizationId;
      readonly operationId: string;
      readonly evidenceId: string;
      readonly transitionedAt: string;
    }): Promise<{ readonly outcome: "transitioned" | "replayed"; readonly value: CallAttempt }>;
    recordTerminalObservation(input: {
      readonly organizationId: OrganizationId;
      readonly operationId: string;
      readonly observationId: string;
      readonly transitionedAt: string;
    }): Promise<{ readonly outcome: "transitioned" | "replayed"; readonly value: CallAttempt }>;
    recordTerminalFailure(input: {
      readonly organizationId: OrganizationId;
      readonly operationId: string;
      readonly outcome:
        "blocked" | "no_answer" | "busy" | "provider_failed" | "evidence_unavailable";
      readonly retryable: boolean;
      readonly transitionedAt: string;
    }): Promise<CallAttempt>;
  };
  readonly evidence: {
    append(record: EvidenceRecord): Promise<AppendResult<EvidenceRecord>>;
    findById(
      organizationId: OrganizationId,
      evidenceId: string,
    ): Promise<EvidenceRecord | undefined>;
  };
  readonly observations: {
    append(input: {
      readonly organizationId: OrganizationId;
      readonly observation: Observation;
    }): Promise<AppendResult<Observation>>;
    findById(
      organizationId: OrganizationId,
      observationId: string,
    ): Promise<Observation | undefined>;
    findOperation(
      organizationId: OrganizationId,
      operationId: string,
    ): Promise<ObservationOperationResponse | undefined>;
  };
  disconnect(): Promise<void>;
}

interface PostgresInfrastructureModule {
  readonly createPostgresPersistence: (
    pool: { readonly options: { readonly max: number } },
    options?: { readonly probeTimeoutMs?: number },
  ) => ObservationPersistence;
}

interface TestPool {
  readonly options: { readonly max: number };
  end(): Promise<void>;
}

async function loadPostgresInfrastructure(): Promise<PostgresInfrastructureModule> {
  const moduleUrl = new URL("./index.ts", import.meta.url).href;
  const loaded = (await import(
    /* @vite-ignore */ moduleUrl
  )) as Partial<PostgresInfrastructureModule>;
  if (loaded.createPostgresPersistence === undefined) {
    throw new Error("createPostgresPersistence is not implemented");
  }
  return { createPostgresPersistence: loaded.createPostgresPersistence };
}

async function createPostgresPersistence(): Promise<{
  readonly persistence: ObservationPersistence;
  readonly pool: TestPool;
}> {
  const infrastructure = await loadPostgresInfrastructure();
  const pg = await import("pg");
  const connectionString = getPostgresTestConnectionUrls().repository;
  await deployMigrations(connectionString);
  const pool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 1_000 });
  return { persistence: infrastructure.createPostgresPersistence(pool), pool };
}

function profile(input: {
  readonly organizationId: string;
  readonly endpointId?: string;
  readonly adapterVersionId?: string;
  readonly provenance?: ObservationProvenance;
  readonly unitMappings?: readonly {
    readonly ruleId: string;
    readonly spokenUnit: string;
    readonly normalizedUnit: string;
  }[];
}): EndpointObservationProfile {
  const provenance = input.provenance ?? "SIMULATED";
  return EndpointObservationProfile.create({
    endpointId: input.endpointId ?? "endpoint_contract_001",
    organizationId: OrganizationId.create(input.organizationId),
    adapterVersionId: input.adapterVersionId ?? "adapter_contract_001",
    expectedZones: [
      {
        zoneId: "zone-01",
        ordinal: 0,
        applicability: "required",
        requiredFacet: "measurement",
        allowedUnitMappings: input.unitMappings ?? [
          { ruleId: "fahrenheit-exact-v1", spokenUnit: "degrees", normalizedUnit: "F" },
        ],
      },
    ],
    dtmfPolicy: { kind: "forbidden" },
    compatibility: provenance === "SIMULATED" ? "simulator-tested" : "provider-observed",
    provenance,
    authorizationReferenceId: "authorization_ref_contract_001",
  });
}

function callAttempt(input: {
  readonly id: string;
  readonly organizationId: string;
  readonly semanticFingerprint: string;
  readonly acceptedAt: string;
  readonly endpointId?: string;
  readonly adapterVersionId?: string;
  readonly provenance?: ObservationProvenance;
  readonly providerDispatchIdentity?: string;
}): CallAttempt {
  return CallAttempt.establish({
    id: input.id,
    organizationId: OrganizationId.create(input.organizationId),
    endpointId: input.endpointId ?? "endpoint_contract_001",
    adapterVersionId: input.adapterVersionId ?? "adapter_contract_001",
    trigger: "manual",
    provenance: input.provenance ?? "SIMULATED",
    semanticFingerprint: input.semanticFingerprint,
    providerDispatchIdentity: input.providerDispatchIdentity ?? `provider_dispatch_${input.id}`,
    acceptedAt: input.acceptedAt,
  });
}

function evidence(input: {
  readonly id: string;
  readonly revision: number;
  readonly predecessorEvidenceId: string | null;
  readonly providerRevisionId: string;
  readonly retainedAt: string;
  readonly organizationId?: string;
  readonly callAttemptId?: string;
  readonly adapterVersionId?: string;
  readonly providerRunId?: string;
  readonly capturedAt?: string;
  readonly provenance?: ObservationProvenance;
}): EvidenceRecord {
  return EvidenceRecord.create({
    id: input.id,
    revision: input.revision,
    predecessorEvidenceId: input.predecessorEvidenceId,
    organizationId: OrganizationId.create(input.organizationId ?? "org_corrections_001"),
    callAttemptId: input.callAttemptId ?? "operation_corrections_001",
    adapterVersionId: input.adapterVersionId ?? "adapter_contract_001",
    providerRunId: input.providerRunId ?? "provider_run_corrections_001",
    providerRevisionId: input.providerRevisionId,
    capturedAt: input.capturedAt ?? "2026-08-05T20:00:02.000Z",
    retainedAt: input.retainedAt,
    opaqueCustodyRef: `custody://${input.providerRevisionId}`,
    provenance: input.provenance ?? "SIMULATED",
    sourceCompleteness: "complete",
  });
}

function observation(input: {
  readonly id: string;
  readonly version: number;
  readonly predecessorObservationId: string | null;
  readonly evidence: EvidenceRecord;
  readonly value: string;
  readonly createdAt: string;
  readonly provenance?: ObservationProvenance;
  readonly inputFingerprint?: string;
  readonly extractorVersionId?: string;
  readonly reconciliationPolicyVersion?: string;
  readonly readingProviderRunId?: string;
  readonly readingSourceCapturedAt?: string;
}): Observation {
  const extractorVersionId = input.extractorVersionId ?? "extractor_contract_v1";
  const reading = Reading.create({
    zoneId: "zone-01",
    ordinal: 0,
    disposition: "grounded",
    value: input.value,
    spokenUnit: "degrees",
    normalizedUnit: "F",
    confidenceToken: "reviewed-simulated",
    confidenceSemanticsVersion: "simulated-confidence-v1",
    candidateIds: [`candidate_${input.version}`],
    evidenceAnchorIds: [`anchor_${input.version}`],
    reasonCodes: [],
    evidenceId: input.evidence.id,
    evidenceRevisionId: input.evidence.providerRevisionId,
    providerRunId: input.readingProviderRunId ?? input.evidence.providerRunId,
    adapterVersionId: input.evidence.adapterVersionId,
    extractorVersionId,
    sourceCapturedAt: input.readingSourceCapturedAt ?? input.evidence.capturedAt,
    derivedAt: input.createdAt,
  });
  return Observation.create({
    id: input.id,
    operationId: input.evidence.callAttemptId,
    version: input.version,
    predecessorObservationId: input.predecessorObservationId,
    createdAt: input.createdAt,
    evidenceId: input.evidence.id,
    evidenceRevisionId: input.evidence.providerRevisionId,
    adapterVersionId: input.evidence.adapterVersionId,
    extractorVersionId,
    reconciliationPolicyVersion: input.reconciliationPolicyVersion ?? "reconciliation_contract_v1",
    provenance: input.provenance ?? input.evidence.provenance,
    quality: "complete",
    inputFingerprint: input.inputFingerprint ?? `input_fingerprint_${input.version}`,
    readings: [reading],
  });
}

async function expectRepositoryConflict(
  operation: Promise<unknown>,
  code:
    | "call_attempt_idempotency_conflict"
    | "evidence_revision_conflict"
    | "observation_profile_conflict"
    | "observation_version_conflict",
): Promise<void> {
  let failure: unknown;
  try {
    await operation;
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(ApplicationError);
  expect(failure).toMatchObject({ kind: "idempotency_conflict", code, retryable: false });
  expect(failure).not.toMatchObject({ kind: "dependency_unavailable" });
}

describe.sequential("Observation workflow PostgreSQL repository contracts", () => {
  // Test strategy: real PostgreSQL proves aggregate-specific organization scope, database-
  // established idempotency, append-only correction lineage, and nullable-observation failure.
  // Provider transport, queue delivery, HTTP/OpenAPI, framework internals, and production auth are
  // deliberately deferred to their owning phases.
  it("persists immutable endpoint profiles with organization-scoped identity", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const organizationA = OrganizationId.create("org_profile_a");
    const organizationB = OrganizationId.create("org_profile_b");
    try {
      const first = await persistence.observationProfiles.establish(
        profile({ organizationId: organizationA.value }),
      );
      const second = await persistence.observationProfiles.establish(
        profile({ organizationId: organizationB.value }),
      );

      expect([first.outcome, second.outcome]).toEqual(["established", "established"]);
      await expect(
        persistence.observationProfiles.findByEndpoint(
          OrganizationId.create("org_profile_unknown"),
          "endpoint_contract_001",
        ),
      ).resolves.toBeUndefined();
      expect(
        (
          await persistence.observationProfiles.findByEndpoint(
            organizationA,
            "endpoint_contract_001",
          )
        )?.toValue(),
      ).toEqual(first.value.toValue());
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("replays profiles regardless of unit-mapping input order", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const mappings = [
      { ruleId: "celsius-exact-v1", spokenUnit: "degrees celsius", normalizedUnit: "C" },
      { ruleId: "fahrenheit-exact-v1", spokenUnit: "degrees", normalizedUnit: "F" },
    ] as const;
    try {
      expect(
        (
          await persistence.observationProfiles.establish(
            profile({ organizationId: "org_profile_mapping_order", unitMappings: mappings }),
          )
        ).outcome,
      ).toBe("established");
      expect(
        (
          await persistence.observationProfiles.establish(
            profile({
              organizationId: "org_profile_mapping_order",
              unitMappings: [...mappings].reverse(),
            }),
          )
        ).outcome,
      ).toBe("replayed");
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("classifies an adapter identity owned by another endpoint as a profile conflict", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    try {
      await persistence.observationProfiles.establish(
        profile({
          organizationId: "org_profile_adapter_collision",
          endpointId: "endpoint_profile_adapter_a",
          adapterVersionId: "adapter_profile_shared",
        }),
      );

      await expectRepositoryConflict(
        persistence.observationProfiles.establish(
          profile({
            organizationId: "org_profile_adapter_collision",
            endpointId: "endpoint_profile_adapter_b",
            adapterVersionId: "adapter_profile_shared",
          }),
        ),
        "observation_profile_conflict",
      );
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("reconciles provider-dispatch collisions as permanent attempt conflicts", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    try {
      await persistence.observationProfiles.establish(
        profile({ organizationId: "org_dispatch_collision" }),
      );
      await persistence.callAttempts.establish({
        idempotencyKey: "idempotency_dispatch_a",
        attempt: callAttempt({
          id: "operation_dispatch_a",
          organizationId: "org_dispatch_collision",
          semanticFingerprint: "semantic_dispatch_a",
          providerDispatchIdentity: "provider_dispatch_shared",
          acceptedAt: "2026-08-05T20:00:00.000Z",
        }),
      });
      await expectRepositoryConflict(
        persistence.callAttempts.establish({
          idempotencyKey: "idempotency_dispatch_b",
          attempt: callAttempt({
            id: "operation_dispatch_b",
            organizationId: "org_dispatch_collision",
            semanticFingerprint: "semantic_dispatch_b",
            providerDispatchIdentity: "provider_dispatch_shared",
            acceptedAt: "2026-08-05T20:00:01.000Z",
          }),
        }),
        "call_attempt_idempotency_conflict",
      );
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("rejects attempt candidates whose collided identities resolve to different rows", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const organizationId = "org_attempt_mixed_identity";
    try {
      await persistence.observationProfiles.establish(profile({ organizationId }));
      await persistence.callAttempts.establish({
        idempotencyKey: "idempotency_mixed_a",
        attempt: callAttempt({
          id: "operation_mixed_a",
          organizationId,
          semanticFingerprint: "semantic_mixed_a",
          providerDispatchIdentity: "provider_dispatch_mixed_a",
          acceptedAt: "2026-08-05T20:00:00.000Z",
        }),
      });
      await persistence.callAttempts.establish({
        idempotencyKey: "idempotency_mixed_b",
        attempt: callAttempt({
          id: "operation_mixed_b",
          organizationId,
          semanticFingerprint: "semantic_mixed_b",
          providerDispatchIdentity: "provider_dispatch_mixed_b",
          acceptedAt: "2026-08-05T20:01:00.000Z",
        }),
      });

      const mixedResults = await Promise.allSettled([
        persistence.callAttempts.establish({
          idempotencyKey: "idempotency_mixed_b",
          attempt: callAttempt({
            id: "operation_mixed_a",
            organizationId,
            semanticFingerprint: "semantic_mixed_a",
            providerDispatchIdentity: "provider_dispatch_mixed_candidate",
            acceptedAt: "2026-08-05T20:00:00.000Z",
          }),
        }),
        persistence.callAttempts.establish({
          idempotencyKey: "idempotency_mixed_candidate",
          attempt: callAttempt({
            id: "operation_mixed_a",
            organizationId,
            semanticFingerprint: "semantic_mixed_a",
            providerDispatchIdentity: "provider_dispatch_mixed_b",
            acceptedAt: "2026-08-05T20:00:00.000Z",
          }),
        }),
      ]);

      expect(mixedResults.map(({ status }) => status)).toEqual(["rejected", "rejected"]);
      for (const result of mixedResults) {
        expect(result.status === "rejected" ? result.reason : undefined).toMatchObject({
          kind: "idempotency_conflict",
          code: "call_attempt_idempotency_conflict",
          retryable: false,
        });
      }
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("rejects an ID-only collision under a different idempotency key", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const organizationId = "org_attempt_id_only_collision";
    try {
      await persistence.observationProfiles.establish(profile({ organizationId }));
      await persistence.callAttempts.establish({
        idempotencyKey: "idempotency_id_only_established",
        attempt: callAttempt({
          id: "operation_id_only_collision",
          organizationId,
          semanticFingerprint: "semantic_id_only_collision",
          providerDispatchIdentity: "provider_dispatch_id_only_established",
          acceptedAt: "2026-08-05T20:00:00.000Z",
        }),
      });

      await expectRepositoryConflict(
        persistence.callAttempts.establish({
          idempotencyKey: "idempotency_id_only_retry",
          attempt: callAttempt({
            id: "operation_id_only_collision",
            organizationId,
            semanticFingerprint: "semantic_id_only_collision",
            providerDispatchIdentity: "provider_dispatch_id_only_retry",
            acceptedAt: "2026-08-05T20:05:00.000Z",
          }),
        }),
        "call_attempt_idempotency_conflict",
      );
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("rejects a provider-dispatch-only collision under a different idempotency key", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const organizationId = "org_attempt_dispatch_only_collision";
    try {
      await persistence.observationProfiles.establish(profile({ organizationId }));
      await persistence.callAttempts.establish({
        idempotencyKey: "idempotency_dispatch_only_established",
        attempt: callAttempt({
          id: "operation_dispatch_only_established",
          organizationId,
          semanticFingerprint: "semantic_dispatch_only_collision",
          providerDispatchIdentity: "provider_dispatch_only_collision",
          acceptedAt: "2026-08-05T20:00:00.000Z",
        }),
      });

      await expectRepositoryConflict(
        persistence.callAttempts.establish({
          idempotencyKey: "idempotency_dispatch_only_retry",
          attempt: callAttempt({
            id: "operation_dispatch_only_retry",
            organizationId,
            semanticFingerprint: "semantic_dispatch_only_collision",
            providerDispatchIdentity: "provider_dispatch_only_collision",
            acceptedAt: "2026-08-05T20:05:00.000Z",
          }),
        }),
        "call_attempt_idempotency_conflict",
      );
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("replays the same idempotency key with database-established generated values", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const organizationId = "org_attempt_same_key_replay";
    const idempotencyKey = "idempotency_same_key_replay";
    try {
      await persistence.observationProfiles.establish(profile({ organizationId }));
      const established = await persistence.callAttempts.establish({
        idempotencyKey,
        attempt: callAttempt({
          id: "operation_same_key_established",
          organizationId,
          semanticFingerprint: "semantic_same_key_replay",
          providerDispatchIdentity: "provider_dispatch_same_key_established",
          acceptedAt: "2026-08-05T20:00:00.000Z",
        }),
      });
      const replayed = await persistence.callAttempts.establish({
        idempotencyKey,
        attempt: callAttempt({
          id: "operation_same_key_retry",
          organizationId,
          semanticFingerprint: "semantic_same_key_replay",
          providerDispatchIdentity: "provider_dispatch_same_key_retry",
          acceptedAt: "2026-08-05T20:05:00.000Z",
        }),
      });

      expect(replayed.outcome).toBe("replayed");
      expect(replayed.value.toValue()).toEqual(established.value.toValue());
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("returns one database-established attempt identity and sanitizes semantic conflicts", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    try {
      await persistence.observationProfiles.establish(
        profile({ organizationId: "org_concurrent_001" }),
      );
      const candidates = [
        callAttempt({
          id: "operation_concurrent_a",
          organizationId: "org_concurrent_001",
          semanticFingerprint: "semantic_fingerprint_shared",
          acceptedAt: "2026-08-05T20:00:00.000Z",
        }),
        callAttempt({
          id: "operation_concurrent_b",
          organizationId: "org_concurrent_001",
          semanticFingerprint: "semantic_fingerprint_shared",
          acceptedAt: "2026-08-05T20:01:00.000Z",
        }),
      ];

      const results = await Promise.all(
        candidates.map(
          async (attempt) =>
            await persistence.callAttempts.establish({
              idempotencyKey: "idempotency_concurrent_001",
              attempt,
            }),
        ),
      );

      expect(results.map(({ outcome }) => outcome).sort()).toEqual(["established", "replayed"]);
      expect(new Set(results.map(({ value }) => value.id)).size).toBe(1);
      expect(new Set(results.map(({ value }) => value.acceptedAt)).size).toBe(1);
      expect(new Set(results.map(({ value }) => value.providerDispatchIdentity)).size).toBe(1);

      const conflict = persistence.callAttempts.establish({
        idempotencyKey: "idempotency_concurrent_001",
        attempt: callAttempt({
          id: "operation_conflict_candidate",
          organizationId: "org_concurrent_001",
          semanticFingerprint: "semantic_fingerprint_mismatch",
          acceptedAt: "2026-08-05T20:02:00.000Z",
        }),
      });

      await expect(conflict).rejects.toBeInstanceOf(ApplicationError);
      await expect(conflict).rejects.toMatchObject({
        kind: "idempotency_conflict",
        code: "call_attempt_idempotency_conflict",
        retryable: false,
      });
      await expect(conflict).rejects.not.toThrow(
        /org_concurrent_001|semantic_fingerprint|idempotency_concurrent_001/u,
      );
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("records terminal failures with compare-and-swap idempotency under duplicate callbacks", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const infrastructure = await loadPostgresInfrastructure();
    const concurrentPersistence = infrastructure.createPostgresPersistence(pool);
    const organizationId = OrganizationId.create("org_terminal_callback");
    const callback = {
      organizationId,
      operationId: "operation_terminal_callback",
      outcome: "provider_failed" as const,
      retryable: true,
      transitionedAt: "2026-08-05T20:00:05.000Z",
    };
    try {
      await persistence.observationProfiles.establish(
        profile({ organizationId: organizationId.value }),
      );
      await persistence.callAttempts.establish({
        idempotencyKey: "idempotency_terminal_callback",
        attempt: callAttempt({
          id: callback.operationId,
          organizationId: organizationId.value,
          semanticFingerprint: "semantic_terminal_callback",
          acceptedAt: "2026-08-05T20:00:00.000Z",
        }),
      });

      const concurrentResults = await Promise.all([
        persistence.callAttempts.recordTerminalFailure(callback),
        concurrentPersistence.callAttempts.recordTerminalFailure(callback),
      ]);
      const replay = await persistence.callAttempts.recordTerminalFailure(callback);

      expect(
        new Set([...concurrentResults, replay].map(({ lastTransitionAt }) => lastTransitionAt)),
      ).toEqual(new Set([callback.transitionedAt]));
      expect(
        new Set([...concurrentResults, replay].map(({ terminalOutcome }) => terminalOutcome)),
      ).toEqual(new Set([callback.outcome]));
      await expectRepositoryConflict(
        concurrentPersistence.callAttempts.recordTerminalFailure({
          ...callback,
          outcome: "busy",
          retryable: false,
          transitionedAt: "2026-08-05T20:00:06.000Z",
        }),
        "call_attempt_idempotency_conflict",
      );

      await expect(
        persistence.observations.findOperation(organizationId, callback.operationId),
      ).resolves.toMatchObject({
        resourceVersion: 2,
        terminalOutcome: callback.outcome,
        lastTransitionAt: callback.transitionedAt,
      });

      const contradictoryOperationId = "operation_terminal_contradictory_race";
      await persistence.callAttempts.establish({
        idempotencyKey: "idempotency_terminal_contradictory_race",
        attempt: callAttempt({
          id: contradictoryOperationId,
          organizationId: organizationId.value,
          semanticFingerprint: "semantic_terminal_contradictory_race",
          acceptedAt: "2026-08-05T20:01:00.000Z",
        }),
      });
      const contradictoryCallbacks = [
        {
          organizationId,
          operationId: contradictoryOperationId,
          outcome: "provider_failed" as const,
          retryable: true,
          transitionedAt: "2026-08-05T20:01:05.000Z",
        },
        {
          organizationId,
          operationId: contradictoryOperationId,
          outcome: "busy" as const,
          retryable: false,
          transitionedAt: "2026-08-05T20:01:06.000Z",
        },
      ] as const;
      const contradictoryResults = await Promise.allSettled([
        persistence.callAttempts.recordTerminalFailure(contradictoryCallbacks[0]),
        concurrentPersistence.callAttempts.recordTerminalFailure(contradictoryCallbacks[1]),
      ]);
      expect(contradictoryResults.map(({ status }) => status).sort()).toEqual([
        "fulfilled",
        "rejected",
      ]);
      const rejectedContradiction = contradictoryResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      expect(rejectedContradiction?.reason).toMatchObject({
        kind: "idempotency_conflict",
        code: "call_attempt_idempotency_conflict",
        retryable: false,
      });
      const winner = contradictoryResults.find(
        (result): result is PromiseFulfilledResult<CallAttempt> => result.status === "fulfilled",
      )?.value;
      expect(winner).toBeDefined();
      if (winner !== undefined) {
        const replayedWinner = await persistence.callAttempts.recordTerminalFailure(
          contradictoryCallbacks.find(
            ({ outcome, retryable, transitionedAt }) =>
              outcome === winner.terminalOutcome &&
              retryable === winner.retryable &&
              transitionedAt === winner.lastTransitionAt,
          ) ?? contradictoryCallbacks[0],
        );
        expect(replayedWinner.toValue()).toEqual(winner.toValue());
      }
      await expect(
        persistence.observations.findOperation(organizationId, contradictoryOperationId),
      ).resolves.toMatchObject({ resourceVersion: 2 });
    } finally {
      await concurrentPersistence.disconnect();
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("keeps a provider-failure winner authoritative over a concurrent observation append", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const infrastructure = await loadPostgresInfrastructure();
    const concurrentPersistence = infrastructure.createPostgresPersistence(pool);
    const organizationId = OrganizationId.create("org_failure_observation_race");
    const operationId = "operation_failure_observation_race";
    const sourceEvidence = evidence({
      id: "evidence_failure_observation_race",
      revision: 1,
      predecessorEvidenceId: null,
      providerRevisionId: "provider_revision_failure_observation_race",
      retainedAt: "2026-08-06T16:20:02.000Z",
      organizationId: organizationId.value,
      callAttemptId: operationId,
      providerRunId: "provider_run_failure_observation_race",
    });
    const candidateObservation = observation({
      id: "observation_failure_observation_race",
      version: 1,
      predecessorObservationId: null,
      evidence: sourceEvidence,
      value: "72.4",
      createdAt: "2026-08-06T16:20:03.000Z",
    });
    try {
      await persistence.observationProfiles.establish(
        profile({ organizationId: organizationId.value }),
      );
      await persistence.callAttempts.establish({
        idempotencyKey: "idempotency_failure_observation_race",
        attempt: callAttempt({
          id: operationId,
          organizationId: organizationId.value,
          semanticFingerprint: "semantic_failure_observation_race",
          acceptedAt: "2026-08-06T16:20:00.000Z",
        }),
      });
      await persistence.callAttempts.recordCalling({
        organizationId,
        operationId,
        transitionedAt: "2026-08-06T16:20:01.000Z",
      });
      await persistence.evidence.append(sourceEvidence);

      const failureWinner = await persistence.callAttempts.recordTerminalFailure({
        organizationId,
        operationId,
        outcome: "provider_failed",
        retryable: false,
        transitionedAt: "2026-08-06T16:20:04.000Z",
      });
      const [observationResult] = await Promise.allSettled([
        concurrentPersistence.observations.append({
          organizationId,
          observation: candidateObservation,
        }),
      ]);

      expect(failureWinner).toMatchObject({
        stage: "terminal",
        terminalOutcome: "provider_failed",
      });
      expect(observationResult).toMatchObject({
        status: "rejected",
        reason: {
          kind: "idempotency_conflict",
          code: "observation_version_conflict",
          retryable: false,
        },
      });
      await expect(
        persistence.observations.findById(organizationId, candidateObservation.id),
      ).resolves.toBeUndefined();
      await expect(
        persistence.observations.findOperation(organizationId, operationId),
      ).resolves.toMatchObject({
        stage: "terminal",
        terminalOutcome: "provider_failed",
        observation: null,
      });
    } finally {
      await concurrentPersistence.disconnect();
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("replays matching terminal facts with the database-established transition timestamp", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const organizationId = OrganizationId.create("org_terminal_changed_clock");
    const operationId = "operation_terminal_changed_clock";
    try {
      await persistence.observationProfiles.establish(
        profile({ organizationId: organizationId.value }),
      );
      await persistence.callAttempts.establish({
        idempotencyKey: "idempotency_terminal_changed_clock",
        attempt: callAttempt({
          id: operationId,
          organizationId: organizationId.value,
          semanticFingerprint: "semantic_terminal_changed_clock",
          acceptedAt: "2026-08-05T20:00:00.000Z",
        }),
      });
      const established = await persistence.callAttempts.recordTerminalFailure({
        organizationId,
        operationId,
        outcome: "provider_failed",
        retryable: true,
        transitionedAt: "2026-08-05T20:00:05.000Z",
      });
      const replayed = await persistence.callAttempts.recordTerminalFailure({
        organizationId,
        operationId,
        outcome: "provider_failed",
        retryable: true,
        transitionedAt: "2026-08-05T20:05:05.000Z",
      });

      expect(replayed.toValue()).toEqual(established.toValue());
      await expect(
        persistence.observations.findOperation(organizationId, operationId),
      ).resolves.toMatchObject({
        resourceVersion: 2,
        lastTransitionAt: "2026-08-05T20:00:05.000Z",
        terminalOutcome: "provider_failed",
      });
      await expectRepositoryConflict(
        persistence.callAttempts.recordTerminalFailure({
          organizationId,
          operationId,
          outcome: "busy",
          retryable: false,
          transitionedAt: "2026-08-05T20:05:05.000Z",
        }),
        "call_attempt_idempotency_conflict",
      );
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("replays provider evidence identity with database-established local ID and retention time", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const organizationId = "org_evidence_changed_local_values";
    const operationId = "operation_evidence_changed_local_values";
    const establishedEvidence = evidence({
      id: "evidence_local_values_established",
      revision: 1,
      predecessorEvidenceId: null,
      providerRevisionId: "provider_revision_local_values",
      retainedAt: "2026-08-05T20:00:03.000Z",
      organizationId,
      callAttemptId: operationId,
      providerRunId: "provider_run_local_values",
    });
    try {
      await persistence.observationProfiles.establish(profile({ organizationId }));
      await persistence.callAttempts.establish({
        idempotencyKey: "idempotency_evidence_changed_local_values",
        attempt: callAttempt({
          id: operationId,
          organizationId,
          semanticFingerprint: "semantic_evidence_changed_local_values",
          acceptedAt: "2026-08-05T20:00:00.000Z",
        }),
      });
      await persistence.evidence.append(establishedEvidence);

      const replayed = await persistence.evidence.append(
        evidence({
          id: "evidence_local_values_retry",
          revision: 1,
          predecessorEvidenceId: null,
          providerRevisionId: establishedEvidence.providerRevisionId,
          retainedAt: "2026-08-05T20:05:03.000Z",
          organizationId,
          callAttemptId: operationId,
          providerRunId: establishedEvidence.providerRunId,
        }),
      );
      expect(replayed).toMatchObject({ outcome: "replayed" });
      expect(replayed.value.toValue()).toEqual(establishedEvidence.toValue());

      await expectRepositoryConflict(
        persistence.evidence.append(
          evidence({
            id: "evidence_local_values_changed_source",
            revision: 1,
            predecessorEvidenceId: null,
            providerRevisionId: establishedEvidence.providerRevisionId,
            retainedAt: "2026-08-05T20:06:03.000Z",
            organizationId,
            callAttemptId: operationId,
            providerRunId: establishedEvidence.providerRunId,
            capturedAt: "2026-08-05T19:59:59.000Z",
          }),
        ),
        "evidence_revision_conflict",
      );
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("replays derivation identity with database-established observation ID and local clocks", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const organizationId = "org_observation_changed_local_values";
    const operationId = "operation_observation_changed_local_values";
    const sourceEvidence = evidence({
      id: "evidence_observation_local_values",
      revision: 1,
      predecessorEvidenceId: null,
      providerRevisionId: "provider_revision_observation_local_values",
      retainedAt: "2026-08-05T20:00:03.000Z",
      organizationId,
      callAttemptId: operationId,
      providerRunId: "provider_run_observation_local_values",
    });
    const establishedObservation = observation({
      id: "observation_local_values_established",
      version: 1,
      predecessorObservationId: null,
      evidence: sourceEvidence,
      value: "72.4",
      createdAt: "2026-08-05T20:00:04.000Z",
    });
    const domainOrganizationId = OrganizationId.create(organizationId);
    try {
      await persistence.observationProfiles.establish(profile({ organizationId }));
      await persistence.callAttempts.establish({
        idempotencyKey: "idempotency_observation_changed_local_values",
        attempt: callAttempt({
          id: operationId,
          organizationId,
          semanticFingerprint: "semantic_observation_changed_local_values",
          acceptedAt: "2026-08-05T20:00:00.000Z",
        }),
      });
      await persistence.callAttempts.recordCalling({
        organizationId: domainOrganizationId,
        operationId,
        transitionedAt: "2026-08-05T20:00:01.000Z",
      });
      await persistence.evidence.append(sourceEvidence);
      await persistence.callAttempts.recordExtracting({
        organizationId: domainOrganizationId,
        operationId,
        evidenceId: sourceEvidence.id,
        transitionedAt: "2026-08-05T20:00:03.500Z",
      });
      await persistence.observations.append({
        organizationId: domainOrganizationId,
        observation: establishedObservation,
      });

      const replayed = await persistence.observations.append({
        organizationId: domainOrganizationId,
        observation: observation({
          id: "observation_local_values_retry",
          version: 1,
          predecessorObservationId: null,
          evidence: sourceEvidence,
          value: "72.4",
          createdAt: "2026-08-05T20:05:04.000Z",
        }),
      });
      expect(replayed).toMatchObject({ outcome: "replayed" });
      expect(replayed.value.toValue()).toEqual(establishedObservation.toValue());

      await expectRepositoryConflict(
        persistence.observations.append({
          organizationId: domainOrganizationId,
          observation: observation({
            id: "observation_local_values_changed_fact",
            version: 1,
            predecessorObservationId: null,
            evidence: sourceEvidence,
            value: "99.9",
            createdAt: "2026-08-05T20:06:04.000Z",
          }),
        }),
        "observation_version_conflict",
      );
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("serializes concurrent distinct evidence corrections without branching", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const infrastructure = await loadPostgresInfrastructure();
    const concurrentPersistence = infrastructure.createPostgresPersistence(pool);
    const organizationId = "org_evidence_chain";
    const operationId = "operation_evidence_chain";
    const evidenceV1 = evidence({
      id: "evidence_chain_001",
      revision: 1,
      predecessorEvidenceId: null,
      providerRevisionId: "provider_revision_chain_001",
      retainedAt: "2026-08-05T20:00:03.000Z",
      organizationId,
      callAttemptId: operationId,
      providerRunId: "provider_run_chain",
    });
    const skipped = evidence({
      id: "evidence_chain_skipped",
      revision: 2,
      predecessorEvidenceId: "evidence_chain_absent",
      providerRevisionId: "provider_revision_chain_skipped",
      retainedAt: "2026-08-05T20:00:04.000Z",
      organizationId,
      callAttemptId: operationId,
      providerRunId: "provider_run_chain",
    });
    const branches = [
      evidence({
        id: "evidence_chain_002_a",
        revision: 2,
        predecessorEvidenceId: evidenceV1.id,
        providerRevisionId: "provider_revision_chain_002_a",
        retainedAt: "2026-08-05T20:01:03.000Z",
        organizationId,
        callAttemptId: operationId,
        providerRunId: "provider_run_chain",
      }),
      evidence({
        id: "evidence_chain_002_b",
        revision: 2,
        predecessorEvidenceId: evidenceV1.id,
        providerRevisionId: "provider_revision_chain_002_b",
        retainedAt: "2026-08-05T20:01:04.000Z",
        organizationId,
        callAttemptId: operationId,
        providerRunId: "provider_run_chain",
      }),
    ] as const;
    try {
      await persistence.observationProfiles.establish(profile({ organizationId }));
      await persistence.callAttempts.establish({
        idempotencyKey: "idempotency_evidence_chain",
        attempt: callAttempt({
          id: operationId,
          organizationId,
          semanticFingerprint: "semantic_evidence_chain",
          acceptedAt: "2026-08-05T20:00:00.000Z",
        }),
      });

      await expectRepositoryConflict(
        persistence.evidence.append(skipped),
        "evidence_revision_conflict",
      );
      expect((await persistence.evidence.append(evidenceV1)).outcome).toBe("appended");
      const results = await Promise.allSettled([
        persistence.evidence.append(branches[0]),
        concurrentPersistence.evidence.append(branches[1]),
      ]);

      expect(results.map(({ status }) => status)).toEqual(["fulfilled", "fulfilled"]);
      const established = results
        .filter(
          (result): result is PromiseFulfilledResult<AppendResult<EvidenceRecord>> =>
            result.status === "fulfilled",
        )
        .map(({ value }) => value.value)
        .sort((left, right) => left.revision - right.revision);
      expect(established.map(({ revision }) => revision)).toEqual([2, 3]);
      expect(established[0]?.predecessorEvidenceId).toBe(evidenceV1.id);
      expect(established[1]?.predecessorEvidenceId).toBe(established[0]?.id);
      const operation = await persistence.observations.findOperation(
        OrganizationId.create(organizationId),
        operationId,
      );
      expect(operation?.evidence).toMatchObject({ revision: 3 });
      expect(operation?.evidence?.evidenceId).toBe(established[1]?.id);
    } finally {
      await concurrentPersistence.disconnect();
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("keeps observation corrections unbranched without regressing newer evidence", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const infrastructure = await loadPostgresInfrastructure();
    const concurrentPersistence = infrastructure.createPostgresPersistence(pool);
    const organizationId = "org_observation_chain";
    const operationId = "operation_observation_chain";
    const evidenceV1 = evidence({
      id: "evidence_observation_chain_001",
      revision: 1,
      predecessorEvidenceId: null,
      providerRevisionId: "provider_revision_observation_chain_001",
      retainedAt: "2026-08-05T20:00:03.000Z",
      organizationId,
      callAttemptId: operationId,
      providerRunId: "provider_run_observation_chain",
    });
    const evidenceV2 = evidence({
      id: "evidence_observation_chain_002",
      revision: 2,
      predecessorEvidenceId: evidenceV1.id,
      providerRevisionId: "provider_revision_observation_chain_002",
      retainedAt: "2026-08-05T20:01:03.000Z",
      organizationId,
      callAttemptId: operationId,
      providerRunId: "provider_run_observation_chain",
    });
    const observationV1 = observation({
      id: "observation_chain_001",
      version: 1,
      predecessorObservationId: null,
      evidence: evidenceV1,
      value: "72.4",
      createdAt: "2026-08-05T20:02:04.000Z",
    });
    const skipped = observation({
      id: "observation_chain_skipped",
      version: 2,
      predecessorObservationId: "observation_chain_absent",
      evidence: evidenceV2,
      value: "72.8",
      createdAt: "2026-08-05T20:01:04.000Z",
    });
    try {
      await persistence.observationProfiles.establish(profile({ organizationId }));
      await persistence.callAttempts.establish({
        idempotencyKey: "idempotency_observation_chain",
        attempt: callAttempt({
          id: operationId,
          organizationId,
          semanticFingerprint: "semantic_observation_chain",
          acceptedAt: "2026-08-05T20:00:00.000Z",
        }),
      });
      const domainOrganizationId = OrganizationId.create(organizationId);
      await persistence.callAttempts.recordCalling({
        organizationId: domainOrganizationId,
        operationId,
        transitionedAt: "2026-08-05T20:00:01.000Z",
      });
      await persistence.evidence.append(evidenceV1);
      await persistence.callAttempts.recordExtracting({
        organizationId: domainOrganizationId,
        operationId,
        evidenceId: evidenceV1.id,
        transitionedAt: "2026-08-05T20:00:03.500Z",
      });

      await expectRepositoryConflict(
        persistence.observations.append({
          organizationId: domainOrganizationId,
          observation: skipped,
        }),
        "observation_version_conflict",
      );
      expect(
        (
          await persistence.observations.append({
            organizationId: domainOrganizationId,
            observation: observationV1,
          })
        ).outcome,
      ).toBe("appended");
      expect(
        (
          await persistence.observations.append({
            organizationId: OrganizationId.create(organizationId),
            observation: observationV1,
          })
        ).outcome,
      ).toBe("replayed");
      await persistence.callAttempts.recordTerminalObservation({
        organizationId: domainOrganizationId,
        operationId,
        observationId: observationV1.id,
        transitionedAt: "2026-08-05T20:02:05.000Z",
      });
      await persistence.evidence.append(evidenceV2);
      expect(
        (await persistence.observations.findOperation(domainOrganizationId, operationId))?.evidence,
      ).toMatchObject({ evidenceId: evidenceV2.id, revision: 2 });

      await expectRepositoryConflict(
        persistence.observations.append({
          organizationId: domainOrganizationId,
          observation: observation({
            id: "observation_chain_false_replay",
            version: 2,
            predecessorObservationId: observationV1.id,
            evidence: evidenceV1,
            value: "99.9",
            createdAt: "2026-08-05T20:03:04.000Z",
            inputFingerprint: observationV1.inputFingerprint,
          }),
        }),
        "observation_version_conflict",
      );

      const branches = [
        observation({
          id: "observation_chain_002_a",
          version: 2,
          predecessorObservationId: observationV1.id,
          evidence: evidenceV2,
          value: "73.0",
          createdAt: "2026-08-05T20:04:04.000Z",
          reconciliationPolicyVersion: "reconciliation_branch_a",
        }),
        observation({
          id: "observation_chain_002_b",
          version: 2,
          predecessorObservationId: observationV1.id,
          evidence: evidenceV2,
          value: "73.1",
          createdAt: "2026-08-05T20:04:05.000Z",
          reconciliationPolicyVersion: "reconciliation_branch_b",
        }),
      ] as const;
      const results = await Promise.allSettled([
        persistence.observations.append({
          organizationId: domainOrganizationId,
          observation: branches[0],
        }),
        concurrentPersistence.observations.append({
          organizationId: domainOrganizationId,
          observation: branches[1],
        }),
      ]);
      expect(results.map(({ status }) => status)).toEqual(["fulfilled", "fulfilled"]);
      const established = results
        .filter(
          (result): result is PromiseFulfilledResult<AppendResult<Observation>> =>
            result.status === "fulfilled",
        )
        .map(({ value }) => value.value)
        .sort((left, right) => left.version - right.version);
      expect(established.map(({ version }) => version)).toEqual([2, 3]);
      expect(established[0]?.predecessorObservationId).toBe(observationV1.id);
      expect(established[1]?.predecessorObservationId).toBe(established[0]?.id);
    } finally {
      await concurrentPersistence.disconnect();
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("serializes two-client distinct revisions into immutable evidence and observation lineage", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const infrastructure = await loadPostgresInfrastructure();
    const concurrentPersistence = infrastructure.createPostgresPersistence(pool);
    const organizationId = OrganizationId.create("org_distinct_revision_race");
    const operationId = "operation_distinct_revision_race";
    const evidenceV1 = evidence({
      id: "evidence_distinct_revision_001",
      revision: 1,
      predecessorEvidenceId: null,
      providerRevisionId: "provider_revision_distinct_001",
      retainedAt: "2026-08-06T16:30:02.000Z",
      organizationId: organizationId.value,
      callAttemptId: operationId,
      providerRunId: "provider_run_distinct_revision",
    });
    const observationV1 = observation({
      id: "observation_distinct_revision_001",
      version: 1,
      predecessorObservationId: null,
      evidence: evidenceV1,
      value: "71.0",
      createdAt: "2026-08-06T16:30:03.000Z",
    });
    const evidenceCandidates = [
      evidence({
        id: "evidence_distinct_revision_002_a",
        revision: 2,
        predecessorEvidenceId: evidenceV1.id,
        providerRevisionId: "provider_revision_distinct_002_a",
        retainedAt: "2026-08-06T16:31:02.000Z",
        organizationId: organizationId.value,
        callAttemptId: operationId,
        providerRunId: "provider_run_distinct_revision",
      }),
      evidence({
        id: "evidence_distinct_revision_002_b",
        revision: 2,
        predecessorEvidenceId: evidenceV1.id,
        providerRevisionId: "provider_revision_distinct_002_b",
        retainedAt: "2026-08-06T16:31:03.000Z",
        organizationId: organizationId.value,
        callAttemptId: operationId,
        providerRunId: "provider_run_distinct_revision",
      }),
    ] as const;
    try {
      await persistence.observationProfiles.establish(
        profile({ organizationId: organizationId.value }),
      );
      await persistence.callAttempts.establish({
        idempotencyKey: "idempotency_distinct_revision_race",
        attempt: callAttempt({
          id: operationId,
          organizationId: organizationId.value,
          semanticFingerprint: "semantic_distinct_revision_race",
          acceptedAt: "2026-08-06T16:30:00.000Z",
        }),
      });
      await persistence.callAttempts.recordCalling({
        organizationId,
        operationId,
        transitionedAt: "2026-08-06T16:30:01.000Z",
      });
      await persistence.evidence.append(evidenceV1);
      await persistence.callAttempts.recordExtracting({
        organizationId,
        operationId,
        evidenceId: evidenceV1.id,
        transitionedAt: "2026-08-06T16:30:02.500Z",
      });
      await persistence.observations.append({ organizationId, observation: observationV1 });
      await persistence.callAttempts.recordTerminalObservation({
        organizationId,
        operationId,
        observationId: observationV1.id,
        transitionedAt: "2026-08-06T16:30:04.000Z",
      });

      const evidenceResults = await Promise.all([
        persistence.evidence.append(evidenceCandidates[0]),
        concurrentPersistence.evidence.append(evidenceCandidates[1]),
      ]);
      const orderedEvidence = evidenceResults
        .map(({ value }) => value)
        .sort((left, right) => left.revision - right.revision);
      expect(orderedEvidence.map(({ revision }) => revision)).toEqual([2, 3]);
      expect(orderedEvidence[0]?.predecessorEvidenceId).toBe(evidenceV1.id);
      expect(orderedEvidence[1]?.predecessorEvidenceId).toBe(orderedEvidence[0]?.id);

      const observationCandidates = orderedEvidence.map((sourceEvidence, index) =>
        observation({
          id: `observation_distinct_revision_00${String(index + 2)}`,
          version: 2,
          predecessorObservationId: observationV1.id,
          evidence: sourceEvidence,
          value: index === 0 ? "72.0" : "73.0",
          createdAt: index === 0 ? "2026-08-06T16:32:02.000Z" : "2026-08-06T16:32:03.000Z",
        }),
      );
      const observationResults = await Promise.all([
        persistence.observations.append({
          organizationId,
          observation: observationCandidates[0]!,
        }),
        concurrentPersistence.observations.append({
          organizationId,
          observation: observationCandidates[1]!,
        }),
      ]);
      const orderedObservations = observationResults
        .map(({ value }) => value)
        .sort((left, right) => left.version - right.version);
      expect(orderedObservations.map(({ version }) => version)).toEqual([2, 3]);
      expect(orderedObservations[0]?.predecessorObservationId).toBe(observationV1.id);
      expect(orderedObservations[1]?.predecessorObservationId).toBe(orderedObservations[0]?.id);
      for (const established of [...orderedEvidence, ...orderedObservations]) {
        const found =
          established instanceof EvidenceRecord
            ? await persistence.evidence.findById(organizationId, established.id)
            : await persistence.observations.findById(organizationId, established.id);
        expect(found?.toValue()).toEqual(established.toValue());
      }
      await expect(
        persistence.observations.findOperation(organizationId, operationId),
      ).resolves.toMatchObject({
        evidence: { revision: 3 },
        observation: { version: 3 },
      });
    } finally {
      await concurrentPersistence.disconnect();
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("rejects provenance laundering and mismatched reading correlation", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const organizationId = "org_provenance_guard";
    const domainOrganizationId = OrganizationId.create(organizationId);
    const operationId = "operation_provenance_guard";
    try {
      await persistence.observationProfiles.establish(profile({ organizationId }));
      await expectRepositoryConflict(
        persistence.callAttempts.establish({
          idempotencyKey: "idempotency_provider_against_simulator",
          attempt: callAttempt({
            id: "operation_provider_against_simulator",
            organizationId,
            semanticFingerprint: "semantic_provider_against_simulator",
            provenance: "PROVIDER_OBSERVED",
            acceptedAt: "2026-08-05T20:00:00.000Z",
          }),
        }),
        "call_attempt_idempotency_conflict",
      );
      await persistence.callAttempts.establish({
        idempotencyKey: "idempotency_provenance_guard",
        attempt: callAttempt({
          id: operationId,
          organizationId,
          semanticFingerprint: "semantic_provenance_guard",
          acceptedAt: "2026-08-05T20:00:00.000Z",
        }),
      });
      const launderedEvidence = evidence({
        id: "evidence_laundered",
        revision: 1,
        predecessorEvidenceId: null,
        providerRevisionId: "provider_revision_laundered",
        retainedAt: "2026-08-05T20:00:03.000Z",
        organizationId,
        callAttemptId: operationId,
        providerRunId: "provider_run_laundered",
        provenance: "PROVIDER_OBSERVED",
      });
      await expectRepositoryConflict(
        persistence.evidence.append(launderedEvidence),
        "evidence_revision_conflict",
      );

      const validEvidence = evidence({
        id: "evidence_provenance_guard",
        revision: 1,
        predecessorEvidenceId: null,
        providerRevisionId: "provider_revision_provenance_guard",
        retainedAt: "2026-08-05T20:00:03.000Z",
        organizationId,
        callAttemptId: operationId,
        providerRunId: "provider_run_provenance_guard",
      });
      await persistence.evidence.append(validEvidence);
      await expectRepositoryConflict(
        persistence.observations.append({
          organizationId: domainOrganizationId,
          observation: observation({
            id: "observation_laundered",
            version: 1,
            predecessorObservationId: null,
            evidence: validEvidence,
            value: "72.4",
            createdAt: "2026-08-05T20:00:04.000Z",
            provenance: "PROVIDER_OBSERVED",
          }),
        }),
        "observation_version_conflict",
      );
      await expectRepositoryConflict(
        persistence.observations.append({
          organizationId: domainOrganizationId,
          observation: observation({
            id: "observation_wrong_run",
            version: 1,
            predecessorObservationId: null,
            evidence: validEvidence,
            value: "72.4",
            createdAt: "2026-08-05T20:00:04.000Z",
            readingProviderRunId: "provider_run_wrong",
          }),
        }),
        "observation_version_conflict",
      );
      await expectRepositoryConflict(
        persistence.observations.append({
          organizationId: domainOrganizationId,
          observation: observation({
            id: "observation_wrong_capture",
            version: 1,
            predecessorObservationId: null,
            evidence: validEvidence,
            value: "72.4",
            createdAt: "2026-08-05T20:00:04.000Z",
            readingSourceCapturedAt: "2026-08-05T19:59:59.000Z",
          }),
        }),
        "observation_version_conflict",
      );
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("rejects provider run and revision reuse across operations", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const organizationId = "org_provider_identity_scope";
    const providerRunId = "provider_run_operation_scoped_attack";
    const providerRevisionId = "provider_revision_operation_scoped_attack";
    try {
      await persistence.observationProfiles.establish(profile({ organizationId }));
      for (const operationId of [
        "operation_provider_identity_a",
        "operation_provider_identity_b",
      ]) {
        await persistence.callAttempts.establish({
          idempotencyKey: `idempotency_${operationId}`,
          attempt: callAttempt({
            id: operationId,
            organizationId,
            semanticFingerprint: `semantic_${operationId}`,
            acceptedAt: "2026-08-05T20:00:00.000Z",
          }),
        });
      }
      await persistence.evidence.append(
        evidence({
          id: "evidence_provider_identity_a",
          revision: 1,
          predecessorEvidenceId: null,
          providerRevisionId,
          retainedAt: "2026-08-05T20:00:03.000Z",
          organizationId,
          callAttemptId: "operation_provider_identity_a",
          providerRunId,
        }),
      );
      await expectRepositoryConflict(
        persistence.evidence.append(
          evidence({
            id: "evidence_provider_identity_b",
            revision: 1,
            predecessorEvidenceId: null,
            providerRevisionId,
            retainedAt: "2026-08-05T20:00:04.000Z",
            organizationId,
            callAttemptId: "operation_provider_identity_b",
            providerRunId,
          }),
        ),
        "evidence_revision_conflict",
      );
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("appends evidence and observation corrections without overwriting prior versions", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const infrastructure = await loadPostgresInfrastructure();
    const secondPersistence = infrastructure.createPostgresPersistence(pool);
    try {
      await persistence.observationProfiles.establish(
        profile({ organizationId: "org_corrections_001" }),
      );
      await persistence.callAttempts.establish({
        idempotencyKey: "idempotency_corrections_001",
        attempt: callAttempt({
          id: "operation_corrections_001",
          organizationId: "org_corrections_001",
          semanticFingerprint: "semantic_fingerprint_corrections",
          acceptedAt: "2026-08-05T20:00:00.000Z",
        }),
      });
      const organizationId = OrganizationId.create("org_corrections_001");
      await persistence.callAttempts.recordCalling({
        organizationId,
        operationId: "operation_corrections_001",
        transitionedAt: "2026-08-05T20:00:01.000Z",
      });
      const evidenceV1 = evidence({
        id: "evidence_corrections_001",
        revision: 1,
        predecessorEvidenceId: null,
        providerRevisionId: "provider_revision_001",
        retainedAt: "2026-08-05T20:00:03.000Z",
      });
      const evidenceV2 = evidence({
        id: "evidence_corrections_002",
        revision: 2,
        predecessorEvidenceId: evidenceV1.id,
        providerRevisionId: "provider_revision_002",
        retainedAt: "2026-08-05T20:01:03.000Z",
      });
      const observationV1 = observation({
        id: "observation_corrections_001",
        version: 1,
        predecessorObservationId: null,
        evidence: evidenceV1,
        value: "72.4",
        createdAt: "2026-08-05T20:00:04.000Z",
      });
      const observationV2 = observation({
        id: "observation_corrections_002",
        version: 2,
        predecessorObservationId: observationV1.id,
        evidence: evidenceV2,
        value: "73.1",
        createdAt: "2026-08-05T20:01:04.000Z",
      });

      expect((await persistence.evidence.append(evidenceV1)).outcome).toBe("appended");
      expect((await persistence.evidence.append(evidenceV1)).outcome).toBe("replayed");
      await persistence.callAttempts.recordExtracting({
        organizationId,
        operationId: "operation_corrections_001",
        evidenceId: evidenceV1.id,
        transitionedAt: "2026-08-05T20:00:03.500Z",
      });
      expect(
        (
          await persistence.observations.append({
            organizationId,
            observation: observationV1,
          })
        ).outcome,
      ).toBe("appended");
      await persistence.callAttempts.recordTerminalObservation({
        organizationId,
        operationId: "operation_corrections_001",
        observationId: observationV1.id,
        transitionedAt: "2026-08-05T20:00:05.000Z",
      });
      expect((await secondPersistence.evidence.append(evidenceV2)).outcome).toBe("appended");
      expect(
        (
          await secondPersistence.observations.append({
            organizationId,
            observation: observationV2,
          })
        ).outcome,
      ).toBe("appended");

      expect(
        (await secondPersistence.evidence.findById(organizationId, evidenceV1.id))?.toValue(),
      ).toEqual(evidenceV1.toValue());
      expect(
        (
          await secondPersistence.observations.findById(organizationId, observationV1.id)
        )?.toValue(),
      ).toEqual(observationV1.toValue());
      const latest = await secondPersistence.observations.findOperation(
        organizationId,
        "operation_corrections_001",
      );
      expect(latest?.evidence).toMatchObject({ evidenceId: evidenceV2.id, revision: 2 });
      expect(latest?.observation).toMatchObject({
        observationId: observationV2.id,
        version: 2,
        predecessorObservationId: observationV1.id,
        readings: [{ value: "73.1", evidenceId: evidenceV2.id }],
      });
    } finally {
      await secondPersistence.disconnect();
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("persists a terminal provider failure with a nullable observation projection", async () => {
    const { persistence, pool } = await createPostgresPersistence();
    const organizationId = OrganizationId.create("org_failure_001");
    try {
      await persistence.observationProfiles.establish(
        profile({ organizationId: organizationId.value }),
      );
      await persistence.callAttempts.establish({
        idempotencyKey: "idempotency_failure_001",
        attempt: callAttempt({
          id: "operation_failure_001",
          organizationId: organizationId.value,
          semanticFingerprint: "semantic_fingerprint_failure",
          acceptedAt: "2026-08-05T20:00:00.000Z",
        }),
      });
      await persistence.callAttempts.recordTerminalFailure({
        organizationId,
        operationId: "operation_failure_001",
        outcome: "provider_failed",
        retryable: true,
        transitionedAt: "2026-08-05T20:00:05.000Z",
      });

      const operation = await persistence.observations.findOperation(
        organizationId,
        "operation_failure_001",
      );

      expect(operation).toMatchObject({
        operationId: "operation_failure_001",
        resourceVersion: 2,
        stage: "terminal",
        terminal: true,
        terminalOutcome: "provider_failed",
        evidence: null,
        observation: null,
        recommendedAction: "create_new_request_after_remediation",
      });
      await expect(
        persistence.observations.findById(organizationId, "observation_failure_absent"),
      ).resolves.toBeUndefined();
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });
});
