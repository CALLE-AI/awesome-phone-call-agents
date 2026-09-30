import { PgBoss, type JobWithMetadata } from "pg-boss";

import type {
  JobBackendHealthPort,
  JobSchedulerPort,
  ObservationJobSchedulerPort,
} from "@muster/application";
import {
  FOUNDATION_HEALTH_JOB_NAME,
  FOUNDATION_HEALTH_JOB_VERSION,
  OBSERVATION_JOB_NAME,
  OBSERVATION_JOB_VERSION,
  type FoundationHealthJobPayload,
  type FoundationHealthSchedulingOutcome,
  type ObservationJobPayload,
  type ObservationSchedulingOutcome,
} from "@muster/contracts";
import type { LiveSimulatorJobPayload } from "./live-simulator-job.handler.js";

const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/u;
const TRACESTATE = /^[\x20-\x7e]{1,512}$/u;
const LIVE_SIMULATOR_JOB_NAME = "muster.simulator.live-observation.v1";

export interface FoundationJobExecutionContext {
  readonly retryCount: number;
  readonly retryLimit: number;
  readonly queueDelaySeconds: number;
}

interface PgBossClient {
  start(): Promise<unknown>;
  createQueue(name: string, options: Record<string, unknown>): Promise<unknown>;
  getQueue(
    name: string,
  ): Promise<{ readonly readyCount: number; readonly activeCount: number } | null>;
  send(name: string, data: object, options: Record<string, unknown>): Promise<string | null>;
  work(
    name: string,
    options: Record<string, unknown>,
    handler: (
      jobs: JobWithMetadata<
        FoundationHealthJobPayload | ObservationJobPayload | LiveSimulatorJobPayload
      >[],
    ) => Promise<void>,
  ): Promise<unknown>;
  stop(options: {
    readonly graceful: boolean;
    readonly timeout: number;
    readonly close: boolean;
  }): Promise<unknown>;
}

export interface PgBossJobInfrastructureOptions {
  readonly connectionString: string;
  readonly schema?: string;
  readonly poolMax?: number;
  readonly concurrency?: number;
  readonly observationConcurrency?: number;
  readonly backlogLimit?: number;
  readonly retryLimit?: number;
  readonly retryDelaySeconds?: number;
  readonly workTimeoutSeconds?: number;
  readonly enqueueTimeoutMs?: number;
  readonly readinessTimeoutMs?: number;
  readonly maintenanceIntervalSeconds?: number;
  readonly shutdownTimeoutMs?: number;
  readonly activeTraceContext?: () =>
    Readonly<{ readonly traceparent: string; readonly tracestate?: string }> | undefined;
  readonly runProducerSpan?: <T>(operation: () => Promise<T>) => Promise<T>;
  readonly onReadiness?: (readiness: "ready" | "degraded") => void;
}

export interface PgBossJobInfrastructure {
  readonly scheduler: JobSchedulerPort & ObservationJobSchedulerPort;
  readonly health: JobBackendHealthPort;
  start(): Promise<void>;
  work(
    handler: (
      payload: FoundationHealthJobPayload,
      context: FoundationJobExecutionContext,
    ) => Promise<void>,
  ): Promise<void>;
  workObservation(
    handler: (
      payload: ObservationJobPayload,
      context: FoundationJobExecutionContext,
    ) => Promise<void>,
  ): Promise<void>;
  workLiveSimulator(
    handler: (
      payload: LiveSimulatorJobPayload,
      context: FoundationJobExecutionContext,
    ) => Promise<void>,
  ): Promise<void>;
  scheduleLiveSimulator(
    payload: LiveSimulatorJobPayload,
  ): Promise<Readonly<{ outcome: "scheduled" | "duplicate" | "rejected"; jobId?: string }>>;
  stop(options?: { readonly graceful?: boolean }): Promise<void>;
}

function safePayload(payload: FoundationHealthJobPayload): FoundationHealthJobPayload {
  const validOpaque = (value: string, maximum: number) =>
    value.length > 0 && value.length <= maximum && /^[\x21-\x7e]+$/u.test(value);
  if (
    payload.version !== FOUNDATION_HEALTH_JOB_VERSION ||
    !validOpaque(payload.organizationId, 128) ||
    !validOpaque(payload.correlationId, 256) ||
    !validOpaque(payload.idempotencyKey, 256)
  ) {
    throw new Error("Invalid foundation health job payload");
  }
  const traceparent = payload.traceContext?.traceparent.trim().toLowerCase();
  const validTraceparent = traceparent !== undefined && TRACEPARENT.test(traceparent);
  const tracestate = payload.traceContext?.tracestate?.trim();
  return Object.freeze({
    version: FOUNDATION_HEALTH_JOB_VERSION,
    organizationId: payload.organizationId,
    correlationId: payload.correlationId,
    idempotencyKey: payload.idempotencyKey,
    ...(validTraceparent
      ? {
          traceContext: Object.freeze({
            traceparent,
            ...(tracestate === undefined || !TRACESTATE.test(tracestate) ? {} : { tracestate }),
          }),
        }
      : {}),
  });
}

function safeObservationPayload(payload: ObservationJobPayload): ObservationJobPayload {
  const validOpaque = (value: string, maximum: number) =>
    value.length > 0 && value.length <= maximum && /^[\x21-\x7e]+$/u.test(value);
  if (
    payload.version !== OBSERVATION_JOB_VERSION ||
    !validOpaque(payload.organizationId, 128) ||
    !validOpaque(payload.operationId, 128) ||
    !validOpaque(payload.correlationId, 256)
  ) {
    throw new Error("Invalid observation job payload");
  }
  const traceparent = payload.traceContext?.traceparent.trim().toLowerCase();
  const validTraceparent = traceparent !== undefined && TRACEPARENT.test(traceparent);
  const tracestate = payload.traceContext?.tracestate?.trim();
  return Object.freeze({
    version: OBSERVATION_JOB_VERSION,
    organizationId: payload.organizationId,
    operationId: payload.operationId,
    correlationId: payload.correlationId,
    ...(validTraceparent
      ? {
          traceContext: Object.freeze({
            traceparent,
            ...(tracestate === undefined || !TRACESTATE.test(tracestate) ? {} : { tracestate }),
          }),
        }
      : {}),
  });
}

function safeLiveSimulatorPayload(payload: LiveSimulatorJobPayload): LiveSimulatorJobPayload {
  const validOpaque = (value: string, maximum: number) =>
    value.length > 0 && value.length <= maximum && /^[\x21-\x7e]+$/u.test(value);
  if (
    payload.version !== "1" ||
    !validOpaque(payload.operationId, 128) ||
    !validOpaque(payload.scenarioId, 128) ||
    !Number.isSafeInteger(payload.scenarioRevision) ||
    payload.scenarioRevision < 1 ||
    !validOpaque(payload.runAuthorization, 4096) ||
    (payload.predecessorOperationId !== undefined &&
      !validOpaque(payload.predecessorOperationId, 128))
  ) {
    throw new Error("Invalid live simulator job payload");
  }
  return Object.freeze({ ...payload });
}

async function withDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    handle = setTimeout(() => reject(new Error("Job operation deadline exceeded")), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (handle !== undefined) clearTimeout(handle);
  }
}

function positiveInteger(value: number, key: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid job configuration: ${key}`);
  }
  return value;
}

export function createPgBossJobInfrastructure(
  options: PgBossJobInfrastructureOptions,
): PgBossJobInfrastructure {
  const schema = options.schema ?? "pgboss";
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(schema)) {
    throw new Error("Invalid job configuration: PG_BOSS_SCHEMA");
  }
  const concurrency = positiveInteger(options.concurrency ?? 2, "JOB_CONCURRENCY", 1, 32);
  const observationConcurrency = positiveInteger(
    options.observationConcurrency ?? concurrency,
    "OBSERVATION_JOB_CONCURRENCY",
    1,
    32,
  );
  const poolMax = positiveInteger(options.poolMax ?? 3, "PG_BOSS_POOL_MAX", 1, 32);
  const backlogLimit = positiveInteger(
    options.backlogLimit ?? 100,
    "JOB_BACKLOG_LIMIT",
    1,
    100_000,
  );
  const retryLimit = positiveInteger(options.retryLimit ?? 2, "JOB_RETRY_LIMIT", 0, 10);
  const retryDelay = positiveInteger(
    options.retryDelaySeconds ?? 0,
    "JOB_RETRY_DELAY_SECONDS",
    0,
    3_600,
  );
  const expireInSeconds = positiveInteger(
    options.workTimeoutSeconds ?? 30,
    "JOB_WORK_TIMEOUT_SECONDS",
    1,
    3_600,
  );
  const shutdownTimeoutMs = positiveInteger(
    options.shutdownTimeoutMs ?? 30_000,
    "JOB_SHUTDOWN_TIMEOUT_MS",
    1_000,
    120_000,
  );
  const enqueueTimeoutMs = positiveInteger(
    options.enqueueTimeoutMs ?? 2_000,
    "JOB_ENQUEUE_TIMEOUT_MS",
    100,
    30_000,
  );
  const readinessTimeoutMs = positiveInteger(
    options.readinessTimeoutMs ?? 500,
    "JOB_READINESS_TIMEOUT_MS",
    50,
    5_000,
  );
  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema,
    max: poolMax,
    application_name: "muster-jobs",
    ...(options.maintenanceIntervalSeconds === undefined
      ? {}
      : {
          maintenanceIntervalSeconds: positiveInteger(
            options.maintenanceIntervalSeconds,
            "PG_BOSS_MAINTENANCE_INTERVAL_SECONDS",
            1,
            60,
          ),
        }),
  });
  return createInfrastructure(
    {
      ...options,
      schema,
      poolMax,
      concurrency,
      observationConcurrency,
      backlogLimit,
      retryLimit,
      retryDelaySeconds: retryDelay,
      workTimeoutSeconds: expireInSeconds,
      shutdownTimeoutMs,
      enqueueTimeoutMs,
      readinessTimeoutMs,
    },
    boss as unknown as PgBossClient,
  );
}

export function createPgBossJobInfrastructureForTest(
  options: PgBossJobInfrastructureOptions,
  boss: PgBossClient,
): PgBossJobInfrastructure {
  return createInfrastructure(options, boss);
}

function validatedOptions(options: PgBossJobInfrastructureOptions) {
  const schema = options.schema ?? "pgboss";
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(schema)) {
    throw new Error("Invalid job configuration: PG_BOSS_SCHEMA");
  }
  return {
    schema,
    concurrency: positiveInteger(options.concurrency ?? 2, "JOB_CONCURRENCY", 1, 32),
    observationConcurrency: positiveInteger(
      options.observationConcurrency ?? options.concurrency ?? 2,
      "OBSERVATION_JOB_CONCURRENCY",
      1,
      32,
    ),
    backlogLimit: positiveInteger(options.backlogLimit ?? 100, "JOB_BACKLOG_LIMIT", 1, 100_000),
    retryLimit: positiveInteger(options.retryLimit ?? 2, "JOB_RETRY_LIMIT", 0, 10),
    retryDelay: positiveInteger(
      options.retryDelaySeconds ?? 0,
      "JOB_RETRY_DELAY_SECONDS",
      0,
      3_600,
    ),
    expireInSeconds: positiveInteger(
      options.workTimeoutSeconds ?? 30,
      "JOB_WORK_TIMEOUT_SECONDS",
      1,
      3_600,
    ),
    shutdownTimeoutMs: positiveInteger(
      options.shutdownTimeoutMs ?? 30_000,
      "JOB_SHUTDOWN_TIMEOUT_MS",
      1_000,
      120_000,
    ),
    enqueueTimeoutMs: positiveInteger(
      options.enqueueTimeoutMs ?? 2_000,
      "JOB_ENQUEUE_TIMEOUT_MS",
      100,
      30_000,
    ),
    readinessTimeoutMs: positiveInteger(
      options.readinessTimeoutMs ?? 500,
      "JOB_READINESS_TIMEOUT_MS",
      50,
      5_000,
    ),
  };
}

function createInfrastructure(
  options: PgBossJobInfrastructureOptions,
  boss: PgBossClient,
): PgBossJobInfrastructure {
  const {
    concurrency,
    observationConcurrency,
    backlogLimit,
    retryLimit,
    retryDelay,
    expireInSeconds,
    shutdownTimeoutMs,
    enqueueTimeoutMs,
    readinessTimeoutMs,
  } = validatedOptions(options);
  const readiness = (value: "ready" | "degraded") => {
    try {
      options.onReadiness?.(value);
    } catch {
      // Telemetry must never change a business-readiness result.
    }
    return value;
  };
  let started = false;
  let clientStarted = false;

  const scheduler: JobSchedulerPort & ObservationJobSchedulerPort = {
    async scheduleFoundationHealthCheck(rawPayload): Promise<FoundationHealthSchedulingOutcome> {
      if (!started) return { outcome: "rejected" };
      try {
        const schedule = async (): Promise<FoundationHealthSchedulingOutcome> => {
          const activeTraceContext = options.activeTraceContext?.();
          const payload = safePayload({
            ...rawPayload,
            ...(activeTraceContext === undefined ? {} : { traceContext: activeTraceContext }),
          });
          return await withDeadline(
            (async () => {
              const queue = await boss.getQueue(FOUNDATION_HEALTH_JOB_NAME);
              if (queue === null || queue.readyCount + queue.activeCount >= backlogLimit) {
                return { outcome: "rejected" } as const;
              }
              const jobId = await boss.send(FOUNDATION_HEALTH_JOB_NAME, payload, {
                singletonKey: JSON.stringify([payload.organizationId, payload.idempotencyKey]),
              });
              return jobId === null
                ? ({ outcome: "duplicate" } as const)
                : ({ outcome: "scheduled", jobId } as const);
            })(),
            enqueueTimeoutMs,
          );
        };
        return options.runProducerSpan === undefined
          ? await schedule()
          : await options.runProducerSpan(schedule);
      } catch (error: unknown) {
        if (error instanceof Error && error.message === "Invalid foundation health job payload") {
          throw error;
        }
        return { outcome: "rejected" };
      }
    },
    async scheduleObservation(rawPayload): Promise<ObservationSchedulingOutcome> {
      if (!started) return { outcome: "rejected" };
      try {
        const schedule = async (): Promise<ObservationSchedulingOutcome> => {
          const activeTraceContext = options.activeTraceContext?.();
          const payload = safeObservationPayload({
            ...rawPayload,
            ...(activeTraceContext === undefined ? {} : { traceContext: activeTraceContext }),
          });
          return await withDeadline(
            (async () => {
              const queue = await boss.getQueue(OBSERVATION_JOB_NAME);
              if (queue === null || queue.readyCount + queue.activeCount >= backlogLimit) {
                return { outcome: "rejected" } as const;
              }
              const jobId = await boss.send(OBSERVATION_JOB_NAME, payload, {
                // Queue singleton state is an admission hint; the persisted operation remains the
                // authority across queue expiry, recovery scans, and provider callbacks.
                singletonKey: JSON.stringify([payload.organizationId, payload.operationId]),
              });
              return jobId === null
                ? ({ outcome: "duplicate" } as const)
                : ({ outcome: "scheduled", jobId } as const);
            })(),
            enqueueTimeoutMs,
          );
        };
        return options.runProducerSpan === undefined
          ? await schedule()
          : await options.runProducerSpan(schedule);
      } catch (error: unknown) {
        if (error instanceof Error && error.message === "Invalid observation job payload") {
          throw error;
        }
        return { outcome: "rejected" };
      }
    },
  };

  const health: JobBackendHealthPort = {
    async getReadiness() {
      if (!started) return readiness("degraded");
      try {
        const queues = await withDeadline(
          Promise.all([
            boss.getQueue(FOUNDATION_HEALTH_JOB_NAME),
            boss.getQueue(OBSERVATION_JOB_NAME),
            boss.getQueue(LIVE_SIMULATOR_JOB_NAME),
          ]),
          readinessTimeoutMs,
        );
        return readiness(queues.some((queue) => queue === null) ? "degraded" : "ready");
      } catch {
        return readiness("degraded");
      }
    },
  };

  return {
    scheduler,
    health,
    async start() {
      if (started) return;
      if (clientStarted) {
        throw new Error("Job infrastructure requires cleanup before restart");
      }
      await boss.start();
      clientStarted = true;
      await boss.createQueue(FOUNDATION_HEALTH_JOB_NAME, {
        policy: "short",
        retryLimit,
        retryDelay,
        retryBackoff: retryDelay > 0,
        expireInSeconds,
        deleteAfterSeconds: 86_400,
        retentionSeconds: 259_200,
      });
      await boss.createQueue(OBSERVATION_JOB_NAME, {
        policy: "short",
        retryLimit,
        retryDelay,
        retryBackoff: retryDelay > 0,
        expireInSeconds,
        deleteAfterSeconds: 86_400,
        retentionSeconds: 259_200,
      });
      await boss.createQueue(LIVE_SIMULATOR_JOB_NAME, {
        policy: "short",
        retryLimit: 1,
        retryDelay: 1,
        retryBackoff: false,
        expireInSeconds: Math.min(expireInSeconds, 60),
        deleteAfterSeconds: 86_400,
        retentionSeconds: 259_200,
      });
      started = true;
    },
    async work(handler) {
      if (!started) throw new Error("Job infrastructure is not started");
      await boss.work(
        FOUNDATION_HEALTH_JOB_NAME,
        {
          localConcurrency: concurrency,
          batchSize: 1,
          pollingIntervalSeconds: 0.5,
          includeMetadata: true,
        },
        async (jobs) => {
          for (const job of jobs) {
            await handler(safePayload(job.data as FoundationHealthJobPayload), {
              retryCount: job.retryCount,
              retryLimit: job.retryLimit,
              queueDelaySeconds: Math.max(
                0,
                (job.startedOn.getTime() - job.createdOn.getTime()) / 1_000,
              ),
            });
          }
        },
      );
    },
    async workObservation(handler) {
      if (!started) throw new Error("Job infrastructure is not started");
      await boss.work(
        OBSERVATION_JOB_NAME,
        {
          localConcurrency: observationConcurrency,
          batchSize: 1,
          pollingIntervalSeconds: 0.5,
          includeMetadata: true,
        },
        async (jobs) => {
          for (const job of jobs) {
            await handler(safeObservationPayload(job.data as ObservationJobPayload), {
              retryCount: job.retryCount,
              retryLimit: job.retryLimit,
              queueDelaySeconds: Math.max(
                0,
                (job.startedOn.getTime() - job.createdOn.getTime()) / 1_000,
              ),
            });
          }
        },
      );
    },
    async workLiveSimulator(handler) {
      if (!started) throw new Error("Job infrastructure is not started");
      await boss.work(
        LIVE_SIMULATOR_JOB_NAME,
        {
          localConcurrency: 1,
          batchSize: 1,
          pollingIntervalSeconds: 0.5,
          includeMetadata: true,
        },
        async (jobs) => {
          for (const job of jobs) {
            await handler(safeLiveSimulatorPayload(job.data as LiveSimulatorJobPayload), {
              retryCount: job.retryCount,
              retryLimit: job.retryLimit,
              queueDelaySeconds: Math.max(
                0,
                (job.startedOn.getTime() - job.createdOn.getTime()) / 1_000,
              ),
            });
          }
        },
      );
    },
    async scheduleLiveSimulator(rawPayload) {
      if (!started) return { outcome: "rejected" };
      try {
        const payload = safeLiveSimulatorPayload(rawPayload);
        return await withDeadline(
          (async () => {
            const queue = await boss.getQueue(LIVE_SIMULATOR_JOB_NAME);
            if (queue === null || queue.readyCount + queue.activeCount >= backlogLimit) {
              return { outcome: "rejected" } as const;
            }
            const jobId = await boss.send(LIVE_SIMULATOR_JOB_NAME, payload, {
              singletonKey: payload.operationId,
            });
            return jobId === null
              ? ({ outcome: "duplicate" } as const)
              : ({ outcome: "scheduled", jobId } as const);
          })(),
          enqueueTimeoutMs,
        );
      } catch (error: unknown) {
        if (error instanceof Error && error.message === "Invalid live simulator job payload") {
          throw error;
        }
        return { outcome: "rejected" };
      }
    },
    async stop(stopOptions) {
      if (!clientStarted) return;
      started = false;
      await boss.stop({
        graceful: stopOptions?.graceful ?? true,
        timeout: shutdownTimeoutMs,
        close: true,
      });
      clientStarted = false;
    },
  };
}
