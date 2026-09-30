import {
  CallAttempt,
  EndpointObservationProfile,
  EvidenceRecord,
  Observation,
  OrganizationId,
  Reading,
} from "@muster/domain";
import { deployMigrations, getPostgresTestConnectionUrls } from "@muster/testing";
import { describe, expect, it } from "vitest";

interface AuthorizationRepository {
  issue(
    input: Record<string, unknown>,
  ): Promise<Readonly<{ outcome: string; operationId: string }>>;
  reserve(
    input: Record<string, unknown>,
  ): Promise<Readonly<{ outcome: string; operationId?: string }>>;
  bind(
    input: Record<string, unknown>,
  ): Promise<Readonly<{ outcome: string; operationId?: string }>>;
  findByOperationId(
    organizationId: OrganizationId,
    operationId: string,
  ): Promise<Record<string, unknown> | undefined>;
  claimInitialCallback(input: Record<string, unknown>): Promise<
    Readonly<{
      outcome: string;
      authorization?: Record<string, unknown>;
    }>
  >;
  authenticateBoundCallback(input: Record<string, unknown>): Promise<
    Readonly<{
      outcome: string;
      authorization?: Record<string, unknown>;
    }>
  >;
  claimDispatch(input: Record<string, unknown>): Promise<Readonly<{ outcome: string }>>;
  recordDispatchDisposition(input: Record<string, unknown>): Promise<Readonly<{ outcome: string }>>;
  closeDispatchAndBeginCleanup(
    input: Record<string, unknown>,
  ): Promise<Readonly<{ outcome: string; authorization?: Record<string, unknown> }>>;
  transitionCleanup(
    input: Record<string, unknown>,
  ): Promise<Readonly<{ outcome: string; authorization?: Record<string, unknown> }>>;
  takeOverCleanup(
    input: Record<string, unknown>,
  ): Promise<Readonly<{ outcome: string; authorization?: Record<string, unknown> }>>;
  establishReviewLease(
    input: Record<string, unknown>,
  ): Promise<Readonly<{ outcome: string; authorization?: Record<string, unknown> }>>;
  transitionReviewCleanup(
    input: Record<string, unknown>,
  ): Promise<Readonly<{ outcome: string; authorization?: Record<string, unknown> }>>;
}

interface Persistence {
  readonly liveSimulatorAuthorizations?: AuthorizationRepository;
  readonly liveSimulatorProviderFacts?: {
    append(input: Record<string, unknown>): Promise<unknown>;
    listForOperation(
      organizationId: OrganizationId,
      operationId: string,
    ): Promise<readonly Record<string, unknown>[]>;
  };
  readonly observationProfiles: {
    establish(value: EndpointObservationProfile): Promise<unknown>;
  };
  readonly callAttempts: {
    establish(input: {
      readonly idempotencyKey: string;
      readonly attempt: CallAttempt;
    }): Promise<unknown>;
    recordCalling(input: Record<string, unknown>): Promise<unknown>;
    recordExtracting(input: Record<string, unknown>): Promise<unknown>;
    recordTerminalObservation(input: Record<string, unknown>): Promise<unknown>;
    recordTerminalFailure(input: Record<string, unknown>): Promise<unknown>;
  };
  readonly evidence: { append(value: EvidenceRecord): Promise<unknown> };
  readonly observations: {
    append(input: {
      readonly organizationId: OrganizationId;
      readonly observation: Observation;
    }): Promise<unknown>;
  };
  disconnect(): Promise<void>;
}

interface TestPool {
  readonly options: { readonly max: number };
  query<T>(text: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly T[] }>;
  end(): Promise<void>;
}

const organizationId = OrganizationId.create("org-live-authorization");
const endpointId = "endpoint-live-recovery";
const adapterVersionId = "adapter-live-recovery-v2";

function issueInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    organizationId,
    operationId: "operation-normal-001",
    nonceDigest: "a".repeat(64),
    semanticDigest: "b".repeat(64),
    scenarioId: "synthetic-normal",
    scenarioRevision: 2,
    audience: "muster-simulator-host",
    endpointAlias: "synthetic-demo-endpoint",
    authorizedTargetDigest: "d".repeat(64),
    publicOrigin: "https://synthetic.invalid",
    purpose: "non-production-synthetic-live-smoke",
    callBudget: 1,
    concurrency: 1,
    retryBudget: 0,
    dtmfPolicy: "forbidden",
    terminalDeadlineSeconds: 120,
    predecessorOperationId: null,
    issuedAt: "2026-08-10T01:00:00.000Z",
    expiresAt: "2026-08-10T01:01:00.000Z",
    ...overrides,
  };
}

function reserveInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    organizationId,
    operationId: "operation-normal-001",
    nonceDigest: "a".repeat(64),
    semanticDigest: "b".repeat(64),
    scenarioId: "synthetic-normal",
    scenarioRevision: 2,
    audience: "muster-simulator-host",
    endpointAlias: "synthetic-demo-endpoint",
    authorizedTargetDigest: "d".repeat(64),
    publicOrigin: "https://synthetic.invalid",
    purpose: "non-production-synthetic-live-smoke",
    callBudget: 1,
    concurrency: 1,
    retryBudget: 0,
    dtmfPolicy: "forbidden",
    terminalDeadlineSeconds: 120,
    predecessorOperationId: null,
    now: "2026-08-10T01:00:01.000Z",
    ...overrides,
  };
}

async function createPersistence(): Promise<{
  readonly persistence: Persistence;
  readonly repository: AuthorizationRepository;
  readonly pool: TestPool;
}> {
  const connectionString = getPostgresTestConnectionUrls().repository;
  await deployMigrations(connectionString);
  const pg = await import("pg");
  const pool = new pg.Pool({ connectionString, max: 8, connectionTimeoutMillis: 1_000 });
  await pool.query(
    `TRUNCATE TABLE "live_simulator_provider_facts", "live_simulator_authorizations"`,
  );
  const infrastructure = (await import("./index.js")) as {
    createPostgresPersistence(pool: TestPool): Persistence;
  };
  const persistence = infrastructure.createPostgresPersistence(pool);
  const repository = persistence.liveSimulatorAuthorizations;
  if (repository === undefined) {
    await persistence.disconnect();
    await pool.end();
    throw new Error("Phase 2 live simulator authorization repository is not implemented");
  }
  return { persistence, repository, pool };
}

async function seedAttempt(
  persistence: Persistence,
  input: {
    readonly operationId: string;
    readonly state: "scheduled" | "failed" | "evidence-free" | "complete";
  },
): Promise<void> {
  await persistence.observationProfiles.establish(
    EndpointObservationProfile.create({
      endpointId,
      organizationId,
      adapterVersionId,
      expectedZones: [
        {
          zoneId: "zone-01",
          ordinal: 0,
          applicability: "required",
          requiredFacet: "measurement",
          allowedUnitMappings: [
            { ruleId: "fahrenheit-v1", spokenUnit: "degrees", normalizedUnit: "F" },
          ],
        },
      ],
      dtmfPolicy: { kind: "forbidden" },
      compatibility: "simulator-tested",
      provenance: "SIMULATED",
      authorizationReferenceId: "live-recovery-authorization",
    }),
  );
  await persistence.callAttempts.establish({
    idempotencyKey: `idempotency-${input.operationId}`,
    attempt: CallAttempt.establish({
      id: input.operationId,
      organizationId,
      endpointId,
      adapterVersionId,
      trigger: "manual",
      provenance: "SIMULATED",
      semanticFingerprint: `semantic-${input.operationId}`,
      providerDispatchIdentity: `dispatch-${input.operationId}`,
      acceptedAt: "2026-08-10T01:00:00.000Z",
    }),
  });
  if (input.state === "scheduled") return;
  await persistence.callAttempts.recordCalling({
    organizationId,
    operationId: input.operationId,
    transitionedAt: "2026-08-10T01:00:01.000Z",
  });
  if (input.state === "evidence-free") {
    await persistence.callAttempts.recordTerminalFailure({
      organizationId,
      operationId: input.operationId,
      outcome: "blocked",
      retryable: false,
      transitionedAt: "2026-08-10T01:00:02.000Z",
    });
    return;
  }
  const evidence = EvidenceRecord.create({
    id: `evidence-${input.operationId}`,
    revision: 1,
    predecessorEvidenceId: null,
    organizationId,
    callAttemptId: input.operationId,
    adapterVersionId,
    providerRunId: `provider-${input.operationId}`,
    providerRevisionId: `provider-revision-${input.operationId}`,
    capturedAt: "2026-08-10T01:00:02.000Z",
    retainedAt: "2026-08-10T01:00:03.000Z",
    opaqueCustodyRef: `custody://${input.operationId}`,
    provenance: "SIMULATED",
    sourceCompleteness: "complete",
  });
  await persistence.evidence.append(evidence);
  if (input.state === "failed") {
    await persistence.callAttempts.recordTerminalFailure({
      organizationId,
      operationId: input.operationId,
      outcome: "provider_failed",
      retryable: false,
      transitionedAt: "2026-08-10T01:00:04.000Z",
    });
    return;
  }
  await persistence.callAttempts.recordExtracting({
    organizationId,
    operationId: input.operationId,
    evidenceId: evidence.id,
    transitionedAt: "2026-08-10T01:00:04.000Z",
  });
  const reading = Reading.create({
    zoneId: "zone-01",
    ordinal: 0,
    disposition: "grounded",
    value: "95.0",
    spokenUnit: "degrees",
    normalizedUnit: "F",
    confidenceToken: "reviewed-simulated",
    confidenceSemanticsVersion: "simulated-confidence-v1",
    candidateIds: ["candidate-zone-01"],
    evidenceAnchorIds: ["anchor-zone-01"],
    reasonCodes: [],
    evidenceId: evidence.id,
    evidenceRevisionId: evidence.providerRevisionId,
    providerRunId: evidence.providerRunId,
    adapterVersionId,
    extractorVersionId: "extractor-live-v1",
    sourceCapturedAt: evidence.capturedAt,
    derivedAt: "2026-08-10T01:00:05.000Z",
  });
  const observation = Observation.create({
    id: `observation-${input.operationId}`,
    operationId: input.operationId,
    version: 1,
    predecessorObservationId: null,
    createdAt: "2026-08-10T01:00:05.000Z",
    evidenceId: evidence.id,
    evidenceRevisionId: evidence.providerRevisionId,
    adapterVersionId,
    extractorVersionId: "extractor-live-v1",
    reconciliationPolicyVersion: "reconciliation-live-v1",
    provenance: "SIMULATED",
    quality: "complete",
    inputFingerprint: `input-${input.operationId}`,
    readings: [reading],
  });
  await persistence.observations.append({ organizationId, observation });
  await persistence.callAttempts.recordTerminalObservation({
    organizationId,
    operationId: input.operationId,
    observationId: observation.id,
    transitionedAt: "2026-08-10T01:00:06.000Z",
  });
}

async function issueAndBindAbnormal(
  repository: AuthorizationRepository,
  input: {
    readonly operationId: string;
    readonly nonce: string;
    readonly endpointAlias?: string;
    readonly scenarioRevision?: number;
  },
): Promise<void> {
  const scenarioRevision = input.scenarioRevision ?? 2;
  await repository.issue(
    issueInput({
      operationId: input.operationId,
      scenarioId: "synthetic-abnormal",
      scenarioRevision,
      endpointAlias: input.endpointAlias ?? "synthetic-demo-endpoint",
      nonceDigest: input.nonce.repeat(64).slice(0, 64),
      semanticDigest: input.nonce.repeat(64).slice(0, 64),
    }),
  );
  await repository.reserve(
    reserveInput({
      operationId: input.operationId,
      scenarioId: "synthetic-abnormal",
      scenarioRevision,
      endpointAlias: input.endpointAlias ?? "synthetic-demo-endpoint",
      nonceDigest: input.nonce.repeat(64).slice(0, 64),
      semanticDigest: input.nonce.repeat(64).slice(0, 64),
    }),
  );
  await repository.bind({
    organizationId,
    operationId: input.operationId,
    nonceDigest: input.nonce.repeat(64).slice(0, 64),
    providerDispatchIdentity: `provider-${input.operationId}`,
    boundAt: "2026-08-10T01:00:02.000Z",
  });
}

describe.sequential("PrismaLiveSimulatorAuthorizationRepository", () => {
  it("issues an exact authorization idempotently and persists no permit, nonce, target value, or transcript", async () => {
    const { persistence, repository, pool } = await createPersistence();
    try {
      await expect(repository.issue(issueInput())).resolves.toMatchObject({
        outcome: "issued",
        operationId: "operation-normal-001",
      });
      await expect(repository.issue(issueInput())).resolves.toMatchObject({
        outcome: "replayed",
        operationId: "operation-normal-001",
      });
      await expect(
        repository.issue(issueInput({ scenarioId: "synthetic-abnormal" })),
      ).rejects.toMatchObject({
        kind: "idempotency_conflict",
        code: "live_authorization_conflict",
      });

      const columns = await pool.query<{ readonly column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'live_simulator_authorizations'
          ORDER BY column_name`,
      );
      expect(columns.rows.map(({ column_name }) => column_name)).toEqual(
        expect.arrayContaining([
          "nonce_digest",
          "semantic_digest",
          "endpoint_alias",
          "predecessor_operation_id",
        ]),
      );
      expect(columns.rows.map(({ column_name }) => column_name)).not.toEqual(
        expect.arrayContaining(["permit", "nonce", "phone_number", "transcript"]),
      );
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("atomically reserves one use under concurrency and replays only the matching operation", async () => {
    const { persistence, repository, pool } = await createPersistence();
    try {
      await repository.issue(issueInput({ operationId: "operation-concurrent-001" }));
      const request = reserveInput({ operationId: "operation-concurrent-001" });
      const results = await Promise.all(
        Array.from({ length: 8 }, () => repository.reserve(request)),
      );

      expect(results.filter(({ outcome }) => outcome === "reserved")).toHaveLength(1);
      expect(results.filter(({ outcome }) => outcome === "replayed")).toHaveLength(7);
      expect(new Set(results.map(({ operationId }) => operationId))).toEqual(
        new Set(["operation-concurrent-001"]),
      );
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("atomically learns the rotating caller with the first signed CallSid and rejects later caller drift", async () => {
    const { persistence, repository, pool } = await createPersistence();
    try {
      const issued = issueInput({ operationId: "operation-callback-bind-001" });
      const reserved = reserveInput({ operationId: "operation-callback-bind-001" });
      await repository.issue(issued);
      await repository.reserve(reserved);
      await repository.claimDispatch({
        organizationId,
        operationId: "operation-callback-bind-001",
        claimedAt: "2026-08-10T01:00:01.500Z",
      });

      const callerA = "1".repeat(64);
      const callerB = "2".repeat(64);
      const target = "d".repeat(64);
      const attempts = await Promise.all(
        [
          { providerCallDigest: "3".repeat(64), callerDigest: callerA },
          { providerCallDigest: "4".repeat(64), callerDigest: callerB },
        ].map(
          async (identity) =>
            await repository.claimInitialCallback({
              organizationId,
              endpointAlias: "synthetic-demo-endpoint",
              audience: "muster-simulator-host",
              ...identity,
              authorizedTargetDigest: target,
              boundAt: "2026-08-10T01:00:02.000Z",
            }),
        ),
      );

      expect(attempts.filter(({ outcome }) => outcome === "bound")).toHaveLength(1);
      const authorization = await repository.findByOperationId(
        organizationId,
        "operation-callback-bind-001",
      );
      const winner = [
        { providerCallDigest: "3".repeat(64), callerDigest: callerA },
        { providerCallDigest: "4".repeat(64), callerDigest: callerB },
      ].find(
        ({ providerCallDigest }) =>
          providerCallDigest === authorization?.["providerDispatchIdentity"],
      );
      expect(winner).toBeDefined();
      expect(authorization).toMatchObject({
        state: "bound",
        callerDigest: winner?.callerDigest,
        authorizedTargetDigest: target,
      });
      await expect(
        repository.authenticateBoundCallback({
          organizationId,
          operationId: "operation-callback-bind-001",
          endpointAlias: "synthetic-demo-endpoint",
          audience: "muster-simulator-host",
          providerCallDigest: winner?.providerCallDigest,
          callerDigest: winner?.callerDigest,
          authorizedTargetDigest: target,
        }),
      ).resolves.toMatchObject({ outcome: "replayed" });
      await expect(
        repository.authenticateBoundCallback({
          organizationId,
          operationId: "operation-callback-bind-001",
          endpointAlias: "synthetic-demo-endpoint",
          audience: "muster-simulator-host",
          providerCallDigest: winner?.providerCallDigest,
          callerDigest: winner?.callerDigest === callerA ? callerB : callerA,
          authorizedTargetDigest: target,
        }),
      ).resolves.toEqual({ outcome: "unmatched" });
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("fails closed on expiry and semantic conflict without consuming the authorization", async () => {
    const { persistence, repository, pool } = await createPersistence();
    try {
      await repository.issue(issueInput({ operationId: "operation-expiry-001" }));
      await expect(
        repository.reserve(
          reserveInput({ operationId: "operation-expiry-001", now: "2026-08-10T01:01:00.000Z" }),
        ),
      ).resolves.toEqual({ outcome: "expired" });
      await expect(
        repository.reserve(
          reserveInput({ operationId: "operation-expiry-001", semanticDigest: "c".repeat(64) }),
        ),
      ).resolves.toEqual({ outcome: "conflict" });
      await expect(
        repository.reserve(reserveInput({ operationId: "operation-expiry-001" })),
      ).resolves.toEqual({ outcome: "reserved", operationId: "operation-expiry-001" });
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("rejects altered audience and endpoint authority without consuming the authorization", async () => {
    const { persistence, repository, pool } = await createPersistence();
    try {
      for (const [suffix, override, digest] of [
        ["audience", { audience: "different-simulator-audience" }, "d"],
        ["endpoint", { endpointAlias: "different-simulator-endpoint" }, "e"],
      ] as const) {
        const operationId = `operation-authority-${suffix}`;
        await repository.issue(
          issueInput({
            operationId,
            nonceDigest: digest.repeat(64),
            semanticDigest: digest.repeat(64),
          }),
        );

        await expect(
          repository.reserve(
            reserveInput({
              operationId,
              nonceDigest: digest.repeat(64),
              semanticDigest: digest.repeat(64),
              ...override,
            }),
          ),
        ).resolves.toEqual({ outcome: "conflict" });
        await expect(
          repository.findByOperationId(organizationId, operationId),
        ).resolves.toMatchObject({ state: "issued", reservedAt: null });
      }
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("mints, reserves, and binds through application-owned authorization capabilities", async () => {
    const { persistence, repository, pool } = await createPersistence();
    try {
      const authorizationApi = (await import("@muster/infrastructure-twilio-simulator")) as Record<
        string,
        CallableFunction
      >;
      const issue = authorizationApi["issueRunAuthorization"]!;
      const createBoundary = authorizationApi["createRunAuthorizationReservationBoundary"]!;
      const verify = authorizationApi["verifyRunAuthorization"]!;
      const bind = authorizationApi["bindRunAuthorization"]!;
      const signingKey = "test-only-run-authorization-signing-key-32-bytes";
      const issued = (await issue({
        organizationId,
        runId: "operation-contract-001",
        scenarioId: "synthetic-normal",
        scenarioRevision: 2,
        endpointAlias: "synthetic-demo-endpoint",
        audience: "muster-simulator-host",
        signingKey,
        nonce: "nonce-contract-001",
        nowEpochSeconds: 1_786_000_000,
        ttlSeconds: 30,
        authorizationIssuer: repository,
        authorizedTargetDigest: "d".repeat(64),
        publicOrigin: "https://synthetic.invalid",
        purpose: "non-production-synthetic-live-smoke",
        callBudget: 1,
        concurrency: 1,
        retryBudget: 0,
        dtmfPolicy: "forbidden",
        terminalDeadlineSeconds: 120,
      })) as { readonly token: string };
      const boundary = createBoundary({
        organizationId,
        signingKey,
        audience: "muster-simulator-host",
        endpointAlias: "synthetic-demo-endpoint",
        authorizationReservations: repository,
        authorizedTargetDigest: "d".repeat(64),
        publicOrigin: "https://synthetic.invalid",
        nowEpochSeconds: () => 1_786_000_001,
      }) as { reserve(input: Record<string, unknown>): Promise<string> };
      await expect(
        boundary.reserve({
          token: issued.token,
          runId: "operation-contract-001",
          scenarioId: "synthetic-normal",
          scenarioRevision: 2,
          audience: "muster-simulator-host",
          endpointAlias: "synthetic-demo-endpoint",
        }),
      ).resolves.toBe("reserved");
      const claims = verify({
        token: issued.token,
        signingKey,
        audience: "muster-simulator-host",
        endpointAlias: "synthetic-demo-endpoint",
        nowEpochSeconds: 1_786_000_001,
        authorizedTargetDigest: "d".repeat(64),
        publicOrigin: "https://synthetic.invalid",
      });
      await expect(
        bind({
          organizationId,
          claims,
          providerCallId: "provider-contract-001",
          nowEpochSeconds: 1_786_000_002,
          authorizationBindings: repository,
        }),
      ).resolves.toBe("bound");
      await expect(
        repository.findByOperationId(organizationId, "operation-contract-001"),
      ).resolves.toMatchObject({
        state: "bound",
        providerDispatchIdentity: "provider-contract-001",
      });
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("requires an exact completed SIMULATED abnormal predecessor with durable evidence", async () => {
    const { persistence, repository, pool } = await createPersistence();
    try {
      const cases = [
        { operationId: "predecessor-nonterminal", state: "scheduled" as const },
        { operationId: "predecessor-failed", state: "failed" as const },
        { operationId: "predecessor-evidence-free", state: "evidence-free" as const },
      ];
      for (const [index, candidate] of cases.entries()) {
        await issueAndBindAbnormal(repository, {
          operationId: candidate.operationId,
          nonce: String(index + 1),
        });
        await seedAttempt(persistence, candidate);
        const recoveryId = `recovery-negative-${String(index + 1)}`;
        await repository.issue(
          issueInput({
            operationId: recoveryId,
            scenarioId: "synthetic-recovery",
            nonceDigest: String(index + 4).repeat(64),
            semanticDigest: String(index + 7).repeat(64),
            predecessorOperationId: candidate.operationId,
          }),
        );
        await expect(
          repository.reserve(
            reserveInput({
              operationId: recoveryId,
              scenarioId: "synthetic-recovery",
              nonceDigest: String(index + 4).repeat(64),
              semanticDigest: String(index + 7).repeat(64),
              predecessorOperationId: candidate.operationId,
            }),
          ),
        ).resolves.toEqual({ outcome: "invalid_predecessor" });
      }

      await issueAndBindAbnormal(repository, {
        operationId: "predecessor-wrong-target",
        nonce: "a",
        endpointAlias: "different-target",
      });
      await seedAttempt(persistence, {
        operationId: "predecessor-wrong-target",
        state: "complete",
      });
      await issueAndBindAbnormal(repository, {
        operationId: "predecessor-wrong-revision",
        nonce: "b",
        scenarioRevision: 1,
      });
      await seedAttempt(persistence, {
        operationId: "predecessor-wrong-revision",
        state: "complete",
      });
      await issueAndBindAbnormal(repository, {
        operationId: "predecessor-complete",
        nonce: "c",
      });
      await seedAttempt(persistence, { operationId: "predecessor-complete", state: "complete" });

      for (const [suffix, predecessorOperationId, digestDigit] of [
        ["wrong-target", "predecessor-wrong-target", "d"],
        ["wrong-revision", "predecessor-wrong-revision", "e"],
        ["unrelated", "predecessor-absent", "9"],
      ] as const) {
        await repository.issue(
          issueInput({
            operationId: `recovery-${suffix}`,
            scenarioId: "synthetic-recovery",
            nonceDigest: digestDigit.repeat(64),
            semanticDigest: digestDigit.repeat(64),
            predecessorOperationId,
          }),
        );
        await expect(
          repository.reserve(
            reserveInput({
              operationId: `recovery-${suffix}`,
              scenarioId: "synthetic-recovery",
              nonceDigest: digestDigit.repeat(64),
              semanticDigest: digestDigit.repeat(64),
              predecessorOperationId,
            }),
          ),
        ).resolves.toEqual({ outcome: "invalid_predecessor" });
      }

      await repository.issue(
        issueInput({
          operationId: "recovery-complete",
          scenarioId: "synthetic-recovery",
          nonceDigest: "f".repeat(64),
          semanticDigest: "0".repeat(64),
          predecessorOperationId: "predecessor-complete",
        }),
      );
      await expect(
        repository.reserve(
          reserveInput({
            operationId: "recovery-complete",
            scenarioId: "synthetic-recovery",
            nonceDigest: "f".repeat(64),
            semanticDigest: "0".repeat(64),
            predecessorOperationId: "predecessor-complete",
          }),
        ),
      ).resolves.toEqual({ outcome: "reserved", operationId: "recovery-complete" });
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("maps a binding database outage to a safe dependency-unavailable error", async () => {
    const { persistence, repository, pool } = await createPersistence();
    await repository.issue(issueInput({ operationId: "operation-outage-001" }));
    await repository.reserve(reserveInput({ operationId: "operation-outage-001" }));
    await persistence.disconnect();
    await pool.end();

    await expect(
      repository.bind({
        organizationId,
        operationId: "operation-outage-001",
        nonceDigest: "a".repeat(64),
        providerDispatchIdentity: "provider-outage-001",
        boundAt: "2026-08-10T01:00:02.000Z",
      }),
    ).rejects.toMatchObject({
      name: "ApplicationError",
      kind: "dependency_unavailable",
      code: "live_authorization_repository_unavailable",
      retryable: true,
    });
  });

  it("atomically grants one durable provider-create transition and makes restart replay reconciliation-only", async () => {
    const { persistence, repository, pool } = await createPersistence();
    try {
      await repository.issue(issueInput({ operationId: "operation-dispatch-claim" }));
      await repository.reserve(reserveInput({ operationId: "operation-dispatch-claim" }));
      const claims = await Promise.all(
        Array.from(
          { length: 8 },
          async () =>
            await repository.claimDispatch({
              organizationId,
              operationId: "operation-dispatch-claim",
              claimedAt: "2026-08-10T01:00:02.000Z",
            }),
        ),
      );
      expect(claims.filter(({ outcome }) => outcome === "claimed")).toHaveLength(1);
      expect(claims.filter(({ outcome }) => outcome === "reconcile")).toHaveLength(7);
      await expect(
        repository.recordDispatchDisposition({
          organizationId,
          operationId: "operation-dispatch-claim",
          outcome: "provider_returned",
        }),
      ).resolves.toEqual({ outcome: "recorded" });
      await expect(
        repository.recordDispatchDisposition({
          organizationId,
          operationId: "operation-dispatch-claim",
          outcome: "provider_returned",
        }),
      ).resolves.toEqual({ outcome: "replayed" });
      await expect(
        repository.claimDispatch({
          organizationId,
          operationId: "operation-dispatch-claim",
          claimedAt: "2026-08-10T01:00:03.000Z",
        }),
      ).resolves.toMatchObject({ outcome: "reconcile" });
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("serializes the durable dispatch-close fence against a concurrent dispatch claim", async () => {
    const { persistence, repository, pool } = await createPersistence();
    try {
      await repository.issue(issueInput({ operationId: "operation-fence-race" }));
      await repository.reserve(reserveInput({ operationId: "operation-fence-race" }));
      const [cleanup, dispatch] = await Promise.all([
        repository.closeDispatchAndBeginCleanup({
          organizationId,
          operationId: "operation-fence-race",
          ownerDigest: "1".repeat(64),
          startedAt: "2026-08-10T01:00:02.000Z",
          deadlineAt: "2026-08-10T01:01:02.000Z",
        }),
        repository.claimDispatch({
          organizationId,
          operationId: "operation-fence-race",
          claimedAt: "2026-08-10T01:00:02.000Z",
        }),
      ]);

      expect(cleanup).toMatchObject({ outcome: "acquired" });
      expect(["claimed", "closed"]).toContain(dispatch.outcome);
      const durable = await repository.findByOperationId(organizationId, "operation-fence-race");
      expect(durable).toMatchObject({
        dispatchClosedAt: "2026-08-10T01:00:02.000Z",
        cleanupState: "barrier_pending",
        cleanupDeadlineAt: "2026-08-10T01:01:02.000Z",
      });
      expect(dispatch.outcome === "claimed").toBe(durable?.["dispatchClaimedAt"] !== null);
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("returns durable zero-dispatch proof separately from a claimed callback-bound identity", async () => {
    const { persistence, repository, pool } = await createPersistence();
    try {
      for (const [operationId, nonceDigest] of [
        ["operation-zero-dispatch", "a".repeat(64)],
        ["operation-with-dispatch", "b".repeat(64)],
      ] as const) {
        await repository.issue(issueInput({ operationId, nonceDigest }));
        await repository.reserve(reserveInput({ operationId, nonceDigest }));
      }
      await repository.claimDispatch({
        organizationId,
        operationId: "operation-with-dispatch",
        claimedAt: "2026-08-10T01:00:02.000Z",
      });
      await repository.bind({
        organizationId,
        operationId: "operation-with-dispatch",
        nonceDigest: "b".repeat(64),
        providerDispatchIdentity: "2".repeat(64),
        boundAt: "2026-08-10T01:00:03.000Z",
      });

      const zero = await repository.closeDispatchAndBeginCleanup({
        organizationId,
        operationId: "operation-zero-dispatch",
        ownerDigest: "3".repeat(64),
        startedAt: "2026-08-10T01:00:04.000Z",
        deadlineAt: "2026-08-10T01:01:04.000Z",
      });
      const dispatched = await repository.closeDispatchAndBeginCleanup({
        organizationId,
        operationId: "operation-with-dispatch",
        ownerDigest: "4".repeat(64),
        startedAt: "2026-08-10T01:00:04.000Z",
        deadlineAt: "2026-08-10T01:01:04.000Z",
      });

      expect(zero.authorization).toMatchObject({
        dispatchClaimedAt: null,
        providerDispatchIdentity: null,
      });
      expect(dispatched.authorization).toMatchObject({
        dispatchClaimedAt: "2026-08-10T01:00:02.000Z",
        providerDispatchIdentity: "2".repeat(64),
      });
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("allows only legal monotonic cleanup transitions with immutable deadline and grace", async () => {
    const { persistence, repository, pool } = await createPersistence();
    try {
      await repository.issue(issueInput({ operationId: "operation-cleanup-monotonic" }));
      await repository.reserve(reserveInput({ operationId: "operation-cleanup-monotonic" }));
      const ownerDigest = "5".repeat(64);
      await repository.closeDispatchAndBeginCleanup({
        organizationId,
        operationId: "operation-cleanup-monotonic",
        ownerDigest,
        startedAt: "2026-08-10T01:00:02.000Z",
        deadlineAt: "2026-08-10T01:01:02.000Z",
      });
      await expect(
        repository.transitionCleanup({
          organizationId,
          operationId: "operation-cleanup-monotonic",
          ownerDigest,
          from: "barrier_pending",
          to: "awaiting_arrival",
          changedAt: "2026-08-10T01:00:03.000Z",
        }),
      ).resolves.toMatchObject({ outcome: "advanced" });
      await expect(
        repository.transitionCleanup({
          organizationId,
          operationId: "operation-cleanup-monotonic",
          ownerDigest,
          from: "awaiting_arrival",
          to: "awaiting_grace",
          changedAt: "2026-08-10T01:00:04.000Z",
          graceUntilAt: "2026-08-10T01:00:09.000Z",
          terminalStatus: "completed",
        }),
      ).resolves.toMatchObject({ outcome: "advanced" });
      await expect(
        repository.transitionCleanup({
          organizationId,
          operationId: "operation-cleanup-monotonic",
          ownerDigest,
          from: "awaiting_grace",
          to: "awaiting_grace",
          changedAt: "2026-08-10T01:00:05.000Z",
          graceUntilAt: "2026-08-10T01:00:10.000Z",
          terminalStatus: "busy",
        }),
      ).resolves.toMatchObject({ outcome: "conflict" });
      const durable = await repository.findByOperationId(
        organizationId,
        "operation-cleanup-monotonic",
      );
      expect(durable).toMatchObject({
        cleanupDeadlineAt: "2026-08-10T01:01:02.000Z",
        cleanupGraceUntilAt: "2026-08-10T01:00:09.000Z",
        cleanupTerminalStatus: "completed",
      });
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("retains a terminal blocked row and rejects illegal regression or owner mismatch", async () => {
    const { persistence, repository, pool } = await createPersistence();
    try {
      await repository.issue(issueInput({ operationId: "operation-cleanup-blocked" }));
      await repository.reserve(reserveInput({ operationId: "operation-cleanup-blocked" }));
      const ownerDigest = "6".repeat(64);
      await repository.closeDispatchAndBeginCleanup({
        organizationId,
        operationId: "operation-cleanup-blocked",
        ownerDigest,
        startedAt: "2026-08-10T01:00:02.000Z",
        deadlineAt: "2026-08-10T01:01:02.000Z",
      });
      await expect(
        repository.transitionCleanup({
          organizationId,
          operationId: "operation-cleanup-blocked",
          ownerDigest,
          from: "barrier_pending",
          to: "blocked",
          changedAt: "2026-08-10T01:00:03.000Z",
          blockedReason: "dispatch_ambiguous",
        }),
      ).resolves.toMatchObject({ outcome: "advanced" });
      await expect(
        repository.transitionCleanup({
          organizationId,
          operationId: "operation-cleanup-blocked",
          ownerDigest: "7".repeat(64),
          from: "blocked",
          to: "restoration_ready",
          changedAt: "2026-08-10T01:00:04.000Z",
        }),
      ).resolves.toMatchObject({ outcome: "conflict" });
      expect(
        await repository.findByOperationId(organizationId, "operation-cleanup-blocked"),
      ).toMatchObject({ cleanupState: "blocked", cleanupBlockedReason: "dispatch_ambiguous" });
      await expect(
        repository.takeOverCleanup({
          organizationId,
          operationId: "operation-cleanup-blocked",
          ownerDigest: "8".repeat(64),
          previousOwnerStopped: true,
          changedAt: "2026-08-10T01:00:05.000Z",
        }),
      ).resolves.toMatchObject({
        outcome: "terminal",
        authorization: {
          cleanupState: "blocked",
          cleanupDeadlineAt: "2026-08-10T01:01:02.000Z",
        },
      });
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("permits cleanup owner takeover only after explicit stopped-owner confirmation", async () => {
    const { persistence, repository, pool } = await createPersistence();
    try {
      await repository.issue(issueInput({ operationId: "operation-cleanup-takeover" }));
      await repository.reserve(reserveInput({ operationId: "operation-cleanup-takeover" }));
      const firstOwner = "8".repeat(64);
      const nextOwner = "9".repeat(64);
      await repository.closeDispatchAndBeginCleanup({
        organizationId,
        operationId: "operation-cleanup-takeover",
        ownerDigest: firstOwner,
        startedAt: "2026-08-10T01:00:02.000Z",
        deadlineAt: "2026-08-10T01:01:02.000Z",
      });
      await expect(
        repository.takeOverCleanup({
          organizationId,
          operationId: "operation-cleanup-takeover",
          ownerDigest: nextOwner,
          previousOwnerStopped: false,
          changedAt: "2026-08-10T01:00:03.000Z",
        }),
      ).rejects.toMatchObject({ code: "live_authorization_invalid" });
      const takeover = await repository.takeOverCleanup({
        organizationId,
        operationId: "operation-cleanup-takeover",
        ownerDigest: nextOwner,
        previousOwnerStopped: true,
        changedAt: "2026-08-10T01:00:03.000Z",
      });
      expect(takeover).toMatchObject({ outcome: "acquired" });
      expect(takeover.authorization).toMatchObject({
        cleanupDeadlineAt: "2026-08-10T01:01:02.000Z",
        cleanupState: "barrier_pending",
      });
      await expect(
        repository.transitionCleanup({
          organizationId,
          operationId: "operation-cleanup-takeover",
          ownerDigest: firstOwner,
          from: "barrier_pending",
          to: "restoration_ready",
          changedAt: "2026-08-10T01:00:04.000Z",
        }),
      ).resolves.toMatchObject({ outcome: "conflict" });
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("establishes one atomic review lease and enforces real migrated monotonic cleanup transitions", async () => {
    const { persistence, repository, pool } = await createPersistence();
    const operationId = "operation-review-lifecycle";
    const sessionId = "review-session-lifecycle";
    const ownerDigest = "5".repeat(64);
    try {
      await repository.issue(issueInput({ operationId }));
      await repository.reserve(reserveInput({ operationId }));
      await pool.query(
        `UPDATE live_simulator_authorizations
            SET dispatch_closed_at = $1,
                cleanup_state = 'complete',
                cleanup_deadline_at = $2,
                cleanup_owner_digest = $3,
                cleanup_state_changed_at = $1
          WHERE organization_id = $4 AND operation_id = $5`,
        [
          "2026-08-10T01:00:02.000Z",
          "2026-08-10T01:01:02.000Z",
          ownerDigest,
          organizationId.value,
          operationId,
        ],
      );

      const established = await repository.establishReviewLease({
        organizationId,
        operationId,
        sessionId,
        reviewReadyAt: "2026-08-10T01:00:03.000Z",
        reviewExpiresAt: "2026-08-10T01:30:03.000Z",
        custodyOwnershipDigest: "a".repeat(64),
        databaseOwnershipDigest: "b".repeat(64),
        databaseProvisioningOwnershipDigest: "c".repeat(64),
      });
      expect(established).toMatchObject({
        outcome: "established",
        authorization: {
          reviewSessionId: sessionId,
          reviewCleanupState: "ready",
          reviewReadyAt: "2026-08-10T01:00:03.000Z",
          reviewExpiresAt: "2026-08-10T01:30:03.000Z",
        },
      });
      await expect(
        pool.query<{
          session_id: string;
          ownership_digest: string;
          provisioning_ownership_digest: string;
        }>(
          `SELECT session_id, ownership_digest, provisioning_ownership_digest
             FROM live_demo_review_database_ownership`,
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            session_id: sessionId,
            ownership_digest: "b".repeat(64),
            provisioning_ownership_digest: "c".repeat(64),
          },
        ],
      });
      await expect(
        repository.attestReviewDatabaseOwnership({
          organizationId,
          operationId,
          sessionId,
          databaseOwnershipDigest: "b".repeat(64),
          databaseProvisioningOwnershipDigest: "d".repeat(64),
        }),
      ).resolves.toEqual({ outcome: "mismatch" });
      await expect(
        repository.attestReviewDatabaseOwnership({
          organizationId,
          operationId,
          sessionId,
          databaseOwnershipDigest: "b".repeat(64),
          databaseProvisioningOwnershipDigest: "c".repeat(64),
        }),
      ).resolves.toEqual({ outcome: "owned", exclusive: true });

      await expect(
        repository.transitionReviewCleanup({
          organizationId,
          operationId,
          sessionId,
          from: "ready",
          to: "cleanup_pending",
          changedAt: "2026-08-10T01:00:04.000Z",
        }),
      ).resolves.toMatchObject({ outcome: "advanced" });
      await expect(
        repository.transitionReviewCleanup({
          organizationId,
          operationId,
          sessionId,
          from: "cleanup_pending",
          to: "ready",
          changedAt: "2026-08-10T01:00:05.000Z",
        }),
      ).resolves.toEqual({ outcome: "conflict" });
      await expect(
        repository.transitionReviewCleanup({
          organizationId,
          operationId,
          sessionId,
          from: "cleanup_pending",
          to: "cleanup_blocked",
          changedAt: "2026-08-10T01:00:03.000Z",
        }),
      ).resolves.toEqual({ outcome: "conflict" });
      await expect(
        repository.transitionReviewCleanup({
          organizationId,
          operationId,
          sessionId,
          from: "cleanup_pending",
          to: "cleanup_blocked",
          changedAt: "2026-08-10T01:00:05.000Z",
        }),
      ).resolves.toMatchObject({ outcome: "advanced" });
      await expect(
        repository.transitionReviewCleanup({
          organizationId,
          operationId,
          sessionId,
          from: "cleanup_blocked",
          to: "cleanup_pending",
          changedAt: "2026-08-10T01:00:06.000Z",
        }),
      ).resolves.toMatchObject({ outcome: "advanced" });
      await expect(
        repository.transitionReviewCleanup({
          organizationId,
          operationId,
          sessionId,
          from: "cleanup_pending",
          to: "deleted",
          changedAt: "2026-08-10T01:00:07.000Z",
        }),
      ).resolves.toMatchObject({ outcome: "advanced" });
      await expect(
        pool.query(
          `UPDATE live_simulator_authorizations
              SET review_cleanup_state = 'cleanup_pending',
                  review_cleanup_state_changed_at = $1
            WHERE organization_id = $2 AND operation_id = $3`,
          ["2026-08-10T01:00:08.000Z", organizationId.value, operationId],
        ),
      ).rejects.toThrow();
    } finally {
      await pool.query(`DELETE FROM live_demo_review_database_ownership`).catch(() => undefined);
      await persistence.disconnect();
      await pool.end();
    }
  });

  it("establishes provider-fact order durably when TIMESTAMPTZ(3) values are equal", async () => {
    const { persistence, pool } = await createPersistence();
    try {
      const facts = persistence.liveSimulatorProviderFacts;
      expect(facts).toBeDefined();
      const occurredAt = "2026-08-10T01:00:00.000Z";
      for (const [phase, outcome] of [
        ["voice", "accepted"],
        ["reconciliation", "one_matching_call"],
      ] as const) {
        await facts!.append({
          organizationId,
          operationId: "operation-equal-millisecond",
          phase,
          providerCallDigest: "a".repeat(64),
          semanticDigest: phase === "voice" ? "b".repeat(64) : "c".repeat(64),
          outcome,
          occurredAt,
          traceId: "d".repeat(32),
          signatureValidated: phase === "voice",
          actionsObserved: null,
          inboundCallCount: phase === "reconciliation" ? 1 : null,
        });
      }
      const established = await facts!.listForOperation(
        organizationId,
        "operation-equal-millisecond",
      );
      expect(established.map(({ phase }) => phase)).toEqual(["voice", "reconciliation"]);
      expect(established.map(({ appendOrdinal }) => appendOrdinal)).toEqual([
        expect.any(Number),
        expect.any(Number),
      ]);
      expect(Number(established[0]!["appendOrdinal"])).toBeLessThan(
        Number(established[1]!["appendOrdinal"]),
      );
    } finally {
      await persistence.disconnect();
      await pool.end();
    }
  });
});
