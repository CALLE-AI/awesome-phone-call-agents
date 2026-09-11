import type { FoundationHealthJobPayload } from "@muster/contracts";
import type {
  FoundationJobExecutionContext,
  PgBossJobInfrastructure,
} from "@muster/infrastructure-jobs";
import type { TelemetryLifecycle } from "@muster/observability";

export interface FoundationWorkerRuntimeDependencies {
  readonly telemetry: TelemetryLifecycle;
  readonly jobs: Pick<PgBossJobInfrastructure, "start" | "work" | "stop">;
  readonly handler: (
    payload: FoundationHealthJobPayload,
    context: FoundationJobExecutionContext,
  ) => Promise<unknown>;
  readonly closeDatabase: () => Promise<void>;
  readonly closeLogger: () => Promise<void>;
}

export interface FoundationWorkerRuntime {
  readonly ready: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createFoundationWorkerRuntime(
  dependencies: FoundationWorkerRuntimeDependencies,
): FoundationWorkerRuntime {
  let ready = false;
  let state: "created" | "starting" | "started" | "stopping" | "stopped" = "created";
  let stopPromise: Promise<void> | undefined;

  async function closeOwnedResources(message: string): Promise<void> {
    const errors: unknown[] = [];
    for (const close of [
      async () => await dependencies.jobs.stop({ graceful: true }),
      dependencies.closeDatabase,
      async () => await dependencies.telemetry.shutdown(),
      dependencies.closeLogger,
    ]) {
      try {
        await close();
      } catch (error) {
        errors.push(error);
      }
    }
    state = "stopped";
    if (errors.length > 0) {
      throw new AggregateError(errors, message);
    }
  }

  return {
    get ready() {
      return ready;
    },
    async start() {
      if (state === "started") return;
      if (state !== "created") throw new Error("Worker runtime cannot be restarted");
      state = "starting";
      try {
        dependencies.telemetry.start();
        await dependencies.jobs.start();
        await dependencies.jobs.work(async (payload, context) => {
          await dependencies.handler(payload, context);
        });
        ready = true;
        state = "started";
      } catch (startupError) {
        ready = false;
        try {
          await closeOwnedResources("Worker startup cleanup failed");
        } catch (cleanupError) {
          const cleanupErrors =
            cleanupError instanceof AggregateError ? cleanupError.errors : [cleanupError];
          throw new AggregateError(
            [startupError, ...cleanupErrors],
            "Worker startup and cleanup failed",
            { cause: cleanupError },
          );
        }
        throw startupError;
      }
    },
    async stop() {
      if (state === "created" || state === "stopped") return;
      if (stopPromise !== undefined) return await stopPromise;
      ready = false;
      state = "stopping";
      stopPromise = closeOwnedResources("Worker shutdown failed");
      return await stopPromise;
    },
  };
}
