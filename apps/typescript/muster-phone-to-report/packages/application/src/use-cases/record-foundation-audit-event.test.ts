import { describe, expect, it } from "vitest";

import type {
  AuditEventRepository,
  Clock,
  IdentifierGenerator,
  JobSchedulerPort,
  LoggerPort,
  SafeLogEvent,
} from "../index.js";
import type { FoundationHealthJobPayload } from "@muster/contracts";

function createCapturingLogger(logEvents: SafeLogEvent[]): LoggerPort {
  const logger: LoggerPort = {
    debug: (event) => logEvents.push(event),
    info: (event) => logEvents.push(event),
    warn: (event) => logEvents.push(event),
    error: (event) => logEvents.push(event),
    child: () => logger,
  };
  return logger;
}

describe("foundation application ports and intentions", () => {
  // Test strategy: prove deterministic capabilities and structural port substitution using
  // public package exports. Real databases, pg-boss delivery, framework DI, and external
  // providers are deliberately not tested in Phase 2.
  it("uses injected clock and identifier capabilities when appending an audit event", async () => {
    const { RecordFoundationAuditEvent } = await import("../index.js");
    const { OrganizationId } = await import("@muster/domain");
    const { FakeAuditEventRepository, FakeClock, FakeIdentifierGenerator } =
      await import("@muster/testing");
    const clock: Clock = new FakeClock("2026-08-04T16:15:00.000Z");
    const identifiers: IdentifierGenerator = new FakeIdentifierGenerator(["audit_generated_001"]);
    const auditEvents = new FakeAuditEventRepository();
    const auditEventRepository: AuditEventRepository = auditEvents;

    const event = await new RecordFoundationAuditEvent({
      clock,
      identifiers,
      auditEvents: auditEventRepository,
    }).execute({
      organizationId: OrganizationId.create("org_test_001"),
      correlationId: "correlation_test_002",
      idempotencyKey: "idempotency_test_002",
      outcome: "degraded",
    });

    expect(event).toMatchObject({
      id: "audit_generated_001",
      occurredAt: "2026-08-04T16:15:00.000Z",
      correlationId: "correlation_test_002",
      idempotencyKey: "idempotency_test_002",
      outcome: "degraded",
    });
    expect(auditEvents.events).toEqual([event]);
  });

  it("returns the established audit event when the same scoped idempotency key is replayed", async () => {
    const { RecordFoundationAuditEvent } = await import("../index.js");
    const { OrganizationId } = await import("@muster/domain");
    const { FakeAuditEventRepository, FakeClock, FakeIdentifierGenerator } =
      await import("@muster/testing");
    const clock = new FakeClock("2026-08-04T16:45:00.000Z");
    const auditEvents = new FakeAuditEventRepository();
    const useCase = new RecordFoundationAuditEvent({
      clock,
      identifiers: new FakeIdentifierGenerator(["audit_original", "audit_retry_candidate"]),
      auditEvents,
    });
    const input = {
      organizationId: OrganizationId.create("org_replay_001"),
      correlationId: "correlation_replay_001",
      idempotencyKey: "idempotency_replay_001",
      outcome: "ready" as const,
    };

    const original = await useCase.execute(input);
    clock.set("2026-08-04T16:46:00.000Z");
    const replay = await useCase.execute(input);

    expect(auditEvents.events).toEqual([original]);
    expect(replay).toBe(original);
    expect(replay.id).toBe("audit_original");
    expect(replay.occurredAt).toBe("2026-08-04T16:45:00.000Z");
  });

  it("rejects a semantic mismatch for the same scoped idempotency key with a stable safe conflict", async () => {
    const { ApplicationError, RecordFoundationAuditEvent } = await import("../index.js");
    const { OrganizationId } = await import("@muster/domain");
    const { FakeAuditEventRepository, FakeClock, FakeIdentifierGenerator } =
      await import("@muster/testing");
    const clock = new FakeClock("2026-08-04T16:50:00.000Z");
    const auditEvents = new FakeAuditEventRepository();
    const useCase = new RecordFoundationAuditEvent({
      clock,
      identifiers: new FakeIdentifierGenerator(["audit_original", "audit_conflicting_candidate"]),
      auditEvents,
    });
    const organizationId = OrganizationId.create("org_conflict_secret_001");
    const scopedInput = {
      organizationId,
      idempotencyKey: "idempotency_conflict_secret_001",
      outcome: "ready" as const,
    };
    await useCase.execute({
      ...scopedInput,
      correlationId: "correlation_original_secret_001",
    });
    clock.set("2026-08-04T16:51:00.000Z");

    let thrown: unknown;
    try {
      await useCase.execute({
        ...scopedInput,
        correlationId: "correlation_conflicting_secret_001",
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApplicationError);
    expect(thrown).toMatchObject({
      kind: "idempotency_conflict",
      code: "audit_event_idempotency_conflict",
      retryable: false,
    });
    expect(String(thrown)).not.toContain("org_conflict_secret_001");
    expect(String(thrown)).not.toContain("idempotency_conflict_secret_001");
    expect(String(thrown)).not.toContain("correlation_conflicting_secret_001");
    expect(auditEvents.events).toHaveLength(1);
  });

  it("replays the established job result when readiness changes before redelivery", async () => {
    const { GetSystemHealth, RecordFoundationAuditEvent, RunFoundationHealthCheck } =
      await import("../index.js");
    const { FakeAuditEventRepository, FakeClock, FakeIdentifierGenerator } =
      await import("@muster/testing");
    let readiness: "ready" | "degraded" = "ready";
    const clock = new FakeClock("2026-08-04T17:00:00.000Z");
    const auditEvents = new FakeAuditEventRepository();
    const logEvents: SafeLogEvent[] = [];
    const run = new RunFoundationHealthCheck({
      getSystemHealth: new GetSystemHealth({
        databaseHealth: { getReadiness: async () => readiness },
        jobBackendHealth: { getReadiness: async () => readiness },
      }),
      recordAuditEvent: new RecordFoundationAuditEvent({
        clock,
        identifiers: new FakeIdentifierGenerator([
          "audit_delivery_original",
          "audit_delivery_retry_candidate",
        ]),
        auditEvents,
      }),
      logger: createCapturingLogger(logEvents),
    });
    const payload: FoundationHealthJobPayload = {
      version: "1",
      organizationId: "org_redelivery_001",
      correlationId: "correlation_redelivery_001",
      idempotencyKey: "idempotency_redelivery_001",
    };

    const original = await run.execute(payload);
    readiness = "degraded";
    clock.set("2026-08-04T17:01:00.000Z");
    const replay = await run.execute(payload);

    expect(auditEvents.events).toHaveLength(1);
    expect(original).toEqual({
      version: "1",
      correlationId: "correlation_redelivery_001",
      status: "ready",
      auditEventId: "audit_delivery_original",
      completedAt: "2026-08-04T17:00:00.000Z",
    });
    expect(replay).toEqual(original);
  });

  it("classifies safe worker failures without logging raw details or retrying validation and conflicts", async () => {
    const {
      ApplicationError,
      GetSystemHealth,
      RecordFoundationAuditEvent,
      RunFoundationHealthCheck,
    } = await import("../index.js");
    const { FakeClock, FakeIdentifierGenerator } = await import("@muster/testing");
    const cases = [
      {
        organizationId: " invalid-organization ",
        repositoryError: undefined,
        expected: { kind: "validation", code: "invalid_organization_id", retryable: false },
      },
      {
        organizationId: "org_test_conflict",
        repositoryError: ApplicationError.idempotencyConflict("audit_event_idempotency_conflict"),
        expected: {
          kind: "idempotency_conflict",
          code: "audit_event_idempotency_conflict",
          retryable: false,
        },
      },
      {
        organizationId: "org_test_dependency",
        repositoryError: ApplicationError.dependencyUnavailable("audit_repository_unavailable"),
        expected: {
          kind: "dependency_unavailable",
          code: "audit_repository_unavailable",
          retryable: true,
        },
      },
      {
        organizationId: "org_test_unexpected",
        repositoryError: new Error("protected-sentinel-raw-error-detail"),
        expected: { kind: "unexpected", code: "unexpected_error", retryable: false },
      },
    ] as const;

    for (const [index, scenario] of cases.entries()) {
      const logEvents: SafeLogEvent[] = [];
      const logger = createCapturingLogger(logEvents);
      const recordAuditEvent = new RecordFoundationAuditEvent({
        clock: new FakeClock("2026-08-04T16:55:00.000Z"),
        identifiers: new FakeIdentifierGenerator([`audit_failure_${String(index)}`]),
        auditEvents: {
          append: async () => {
            if (scenario.repositoryError !== undefined) {
              throw scenario.repositoryError;
            }
            throw new Error("repository must not be reached for invalid input");
          },
        },
      });
      const run = new RunFoundationHealthCheck({
        getSystemHealth: new GetSystemHealth({
          databaseHealth: { getReadiness: async () => "ready" },
          jobBackendHealth: { getReadiness: async () => "ready" },
        }),
        recordAuditEvent,
        logger,
      });

      await expect(
        run.execute({
          version: "1",
          organizationId: scenario.organizationId,
          correlationId: `correlation_failure_${String(index)}`,
          idempotencyKey: `idempotency_failure_${String(index)}`,
        }),
      ).rejects.toBeInstanceOf(Error);

      expect(logEvents.at(-1)).toMatchObject({
        event: "job.failed",
        outcome: "failed",
        error: scenario.expected,
      });
      expect(JSON.stringify(logEvents)).not.toContain("protected-sentinel-raw-error-detail");
      expect(JSON.stringify(logEvents)).not.toContain(`idempotency_failure_${String(index)}`);
      expect(JSON.stringify(logEvents)).not.toContain(scenario.organizationId);
    }
  });

  it("substitutes a job scheduler port with a deterministic fake using only the versioned client-safe contract", async () => {
    const { GetSystemHealth, RecordFoundationAuditEvent, RunFoundationHealthCheck } =
      await import("../index.js");
    const { FOUNDATION_HEALTH_JOB_VERSION } = await import("@muster/contracts");
    const { FakeAuditEventRepository, FakeClock, FakeIdentifierGenerator, FakeJobScheduler } =
      await import("@muster/testing");
    const fakeScheduler = new FakeJobScheduler({
      outcome: "scheduled",
      jobId: "opaque_job_001",
    });
    const scheduler: JobSchedulerPort = fakeScheduler;
    const payload: FoundationHealthJobPayload = {
      version: FOUNDATION_HEALTH_JOB_VERSION,
      organizationId: "org_test_001",
      correlationId: "correlation_test_003",
      idempotencyKey: "idempotency_test_003",
      traceContext: {
        traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
      },
    };

    const result = await scheduler.scheduleFoundationHealthCheck(payload);

    const auditEvents = new FakeAuditEventRepository();
    const logEvents: SafeLogEvent[] = [];
    const logger = createCapturingLogger(logEvents);
    const health = new GetSystemHealth({
      databaseHealth: { getReadiness: async () => "ready" },
      jobBackendHealth: { getReadiness: async () => "ready" },
    });
    const recordAuditEvent = new RecordFoundationAuditEvent({
      clock: new FakeClock("2026-08-04T16:30:00.000Z"),
      identifiers: new FakeIdentifierGenerator(["audit_generated_002"]),
      auditEvents,
    });
    const workerResult = await new RunFoundationHealthCheck({
      getSystemHealth: health,
      recordAuditEvent,
      logger,
    }).execute(payload);

    expect(result).toEqual({ outcome: "scheduled", jobId: "opaque_job_001" });
    expect(fakeScheduler.scheduledPayloads).toEqual([payload]);
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
    expect(workerResult).toEqual({
      version: FOUNDATION_HEALTH_JOB_VERSION,
      correlationId: "correlation_test_003",
      status: "ready",
      auditEventId: "audit_generated_002",
      completedAt: "2026-08-04T16:30:00.000Z",
    });
    expect(auditEvents.events).toHaveLength(1);
    expect(logEvents.map(({ event }) => event)).toEqual(["job.started", "job.completed"]);
  });
});
