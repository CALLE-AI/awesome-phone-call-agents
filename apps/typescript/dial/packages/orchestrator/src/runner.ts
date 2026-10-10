import { claimJobs, completeJob, failJob, reclaimStaleJobs, type JobKind } from '@dial/database';
import { logger, timed } from '@dial/observability';
import type { OrchestratorContext } from './context.js';
import {
  handleInterpret,
  handleResearch,
  handlePlanCalls,
  handleDispatchWave,
  handlePollCall,
  handleCompare,
  handleTimeout,
} from './pipeline.js';
import { handleDeliverPush } from './push.js';
import { handleBizDispatchRun, handleBizPollRecipient } from './business/run.js';
import { purgeExpiredTranscripts } from './repo.js';
import { failTask } from './pipeline.js';

type Handler = (ctx: OrchestratorContext, payload: any) => Promise<void>;

export const HANDLERS: Record<JobKind, Handler> = {
  'task.interpret': handleInterpret,
  'task.research': handleResearch,
  'task.plan_calls': handlePlanCalls,
  'task.dispatch_wave': handleDispatchWave,
  'task.poll_call': handlePollCall,
  'task.collect': handleCompare,
  'task.compare': handleCompare,
  'task.timeout': handleTimeout,
  'push.deliver': handleDeliverPush,
  'biz.dispatch_run': handleBizDispatchRun,
  'biz.poll_recipient': handleBizPollRecipient,
};

export interface RunnerOptions {
  workerId?: string;
  /** How many jobs to claim per tick. */
  batchSize?: number;
  pollIntervalMs?: number;
}

/**
 * The worker loop. Claims due jobs, runs them, and records the outcome.
 *
 * A handler that throws is retried with backoff by the queue; a handler that
 * exhausts its retries is parked. Neither can dial twice, because dispatch is
 * keyed on a unique idempotency key in the database.
 */
export class Runner {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly workerId: string;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private housekeepingCounter = 0;

  constructor(
    private readonly ctx: OrchestratorContext,
    options: RunnerOptions = {},
  ) {
    this.workerId = options.workerId ?? `worker_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    this.batchSize = options.batchSize ?? 5;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info('worker started', { workerId: this.workerId });
    void this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      let processed = 0;
      try {
        processed = await this.tick();
      } catch (error) {
        logger.error('worker tick failed', { error: (error as Error).message });
      }
      // Back off only when there was nothing to do, so a busy queue drains fast.
      if (processed === 0) {
        await new Promise((resolve) => {
          this.timer = setTimeout(resolve, this.pollIntervalMs);
        });
      }
    }
  }

  /** Runs one batch. Exposed so tests can drain the queue deterministically. */
  async tick(): Promise<number> {
    this.housekeepingCounter += 1;
    if (this.housekeepingCounter % 60 === 0) {
      await reclaimStaleJobs(this.ctx.db);
      await purgeExpiredTranscripts(this.ctx.db);
    }

    const jobs = await claimJobs(this.ctx.db, this.workerId, this.batchSize);
    if (jobs.length === 0) return 0;

    for (const job of jobs) {
      const handler = HANDLERS[job.kind];
      if (!handler) {
        logger.error('no handler for job kind', { kind: job.kind, jobId: job.id });
        await failJob(this.ctx.db, job, new Error(`No handler for ${job.kind}`));
        continue;
      }
      try {
        await timed('worker.job', { kind: job.kind }, () => handler(this.ctx, job.payload));
        await completeJob(this.ctx.db, job.id);
      } catch (error) {
        const outcome = await failJob(this.ctx.db, job, error);
        // A job that has exhausted its retries must not leave its task stranded
        // in a non-terminal state forever, spinning in the UI with no result.
        if (outcome === 'dead') await this.failStrandedTask(job, error);
      }
    }
    return jobs.length;
  }

  /**
   * Turns an exhausted job into an honest terminal state on its task.
   *
   * The wording is deliberately about what happened rather than which component
   * broke — the user does not need to know which stage of the pipeline gave up,
   * only that Dial stopped and why in plain terms. Nothing from the underlying
   * exception is shown.
   */
  private async failStrandedTask(
    job: { kind: JobKind; payload: Record<string, unknown> },
    error: unknown,
  ): Promise<void> {
    const taskId = typeof job.payload['taskId'] === 'string' ? job.payload['taskId'] : null;
    if (!taskId) return;

    const busy = (error as { retryable?: boolean })?.retryable === true;
    const message = busy
      ? 'Dial could not reach a service it depends on, even after retrying. Please try again in a few minutes.'
      : 'Dial ran into a problem it could not recover from. Nothing was charged and no calls were placed beyond any already shown.';

    try {
      await failTask(this.ctx, taskId, busy ? 'service_unavailable' : 'internal_error', message);
    } catch (failure) {
      logger.error('could not mark stranded task as failed', {
        taskId,
        kind: job.kind,
        error: (failure as Error).message,
      });
    }
  }

  /** Drains until the queue is empty or `maxTicks` is reached (tests). */
  async drain(maxTicks = 200): Promise<void> {
    for (let i = 0; i < maxTicks; i += 1) {
      const processed = await this.tick();
      if (processed === 0) return;
    }
  }
}
