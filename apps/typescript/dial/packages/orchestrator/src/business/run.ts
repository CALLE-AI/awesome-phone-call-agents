import { and, eq, sql } from 'drizzle-orm';
import {
  businesses,
  businessWorkflows,
  businessContacts,
  businessRuns,
  businessRunRecipients,
  businessCallAttempts,
  userSettings,
  enqueueJob,
  type BusinessRunRow,
  type BusinessRunRecipientRow,
  type BusinessWorkflowRow,
} from '@dial/database';
import { getBusinessTemplate, describeCalleError, type CallingHours } from '@dial/schemas';
import { isTerminal, ProviderError } from '@dial/calle';
import { logger, incrementCounter } from '@dial/observability';
import type { OrchestratorContext } from '../context.js';
import { audit, notify } from '../repo.js';
import { buildBusinessBrief } from './brief.js';
import { getRecipientWithRun, listRecipients, recipientLine } from './repo.js';

/**
 * Durable execution for business runs.
 *
 * A run's dispatch is a queue job like any other: claimed with SKIP LOCKED,
 * retried with backoff, and safe to redeliver because every provider call
 * carries a deterministic idempotency key (`biz:<recipientId>:a<attempt>`)
 * and only recipients still in `pending` are dispatched. A worker that dies
 * mid-run loses nothing; a retried job cannot ring anyone twice.
 */

const RETRY_BACKOFF_MS = 60_000;

/* ------------------------------------------------------------ dispatch */

export async function handleBizDispatchRun(ctx: OrchestratorContext, payload: { runId: string }): Promise<void> {
  const runRows = await ctx.db.select().from(businessRuns).where(eq(businessRuns.id, payload.runId)).limit(1);
  const run = runRows[0];
  if (!run) return;
  // A canceled or finished run must not dial anyone, however the job got here.
  if (run.state === 'canceled' || run.state === 'completed' || run.state === 'failed') return;

  const workflowRows = await ctx.db
    .select()
    .from(businessWorkflows)
    .where(eq(businessWorkflows.id, run.workflowId))
    .limit(1);
  const workflow = workflowRows[0];
  if (!workflow) return;
  if (!workflow.enabled) {
    await failRun(ctx, run, 'workflow_disabled', 'The workflow was turned off before this run started.');
    return;
  }

  const businessRows = await ctx.db.select().from(businesses).where(eq(businesses.id, run.businessId)).limit(1);
  const business = businessRows[0];
  if (!business) return;

  const recipients = await listRecipients(ctx.db, run.id);
  if (recipients.length === 0) return;

  // Respect the business's own calling window, in the business's timezone.
  // Outside the window the job simply reschedules itself; nothing is lost.
  const hours = workflow.callingHours as CallingHours;
  const now = new Date();
  if (!withinCallingHours(hours, business.timezone, now)) {
    const next = nextWindowStart(hours, business.timezone, now);
    await enqueueJob(
      ctx.db,
      'biz.dispatch_run',
      { runId: run.id },
      { runAt: next, dedupeKey: `birun:${run.id}:${now.getTime()}` },
    );
    logger.info('business run moved to the next calling window', { runId: run.id, next: next.toISOString() });
    return;
  }

  await ctx.db
    .update(businessRuns)
    .set({ state: 'running', startedAt: run.startedAt ?? now.toISOString(), updatedAt: now.toISOString() })
    .where(and(eq(businessRuns.id, run.id), eq(businessRuns.state, 'queued')));

  const template = getBusinessTemplate(workflow.template);

  for (const recipient of recipients) {
    if (recipient.state !== 'pending') continue;
    await dispatchRecipient(ctx, run, workflow, business.name, recipient, template?.resultJsonSchema ?? null);
  }

  await maybeCompleteBizRun(ctx, run.id);
}

async function dispatchRecipient(
  ctx: OrchestratorContext,
  run: BusinessRunRow,
  workflow: BusinessWorkflowRow,
  businessName: string,
  recipient: BusinessRunRecipientRow,
  resultJsonSchema: Record<string, unknown> | null,
): Promise<void> {
  // Opt-out wins over everything, including a run the owner already started.
  if (recipient.contactId) {
    const contactRows = await ctx.db
      .select({ doNotCall: businessContacts.doNotCall, optedOutAt: businessContacts.optedOutAt })
      .from(businessContacts)
      .where(eq(businessContacts.id, recipient.contactId))
      .limit(1);
    const contact = contactRows[0];
    if (contact && (contact.doNotCall || contact.optedOutAt)) {
      await ctx.db
        .update(businessRunRecipients)
        .set({
          state: 'skipped',
          failureCode: 'opted_out',
          failureMessage: 'Opted out of calls — not dialled.',
          completedAt: new Date().toISOString(),
        })
        .where(eq(businessRunRecipients.id, recipient.id));
      incrementCounter('biz.recipients_skipped', { reason: 'opted_out' });
      return;
    }
  }

  const attempt = recipient.attemptCount + 1;
  const idempotencyKey = `biz:${recipient.id}:a${attempt}`;
  const brief = buildBusinessBrief({
    businessName,
    workflowName: workflow.name,
    template: workflow.template,
    goal: workflow.goal,
    recipientName: recipient.recipientName,
    context: (recipient.context as Record<string, string>) ?? {},
    locale: recipient.locale ?? workflow.defaultLocale,
    callingHours: workflow.callingHours as CallingHours,
  });

  try {
    const snapshot = await ctx.provider.create({
      task: brief,
      phone: recipient.phoneE164,
      resultSchema: resultJsonSchema ?? { type: 'object', properties: {} },
      metadata: { dial_business_run_id: run.id, dial_recipient_id: recipient.id },
      idempotencyKey,
      locale: recipient.locale ?? workflow.defaultLocale,
    });

    await ctx.db
      .update(businessRunRecipients)
      .set({
        provider: ctx.provider.name,
        simulated: ctx.provider.name === 'fake',
        providerCallId: snapshot.providerCallId,
        providerStatus: snapshot.status,
        attemptCount: attempt,
        state: 'calling',
        dispatchedAt: new Date().toISOString(),
        waitingSince: new Date().toISOString(),
      })
      .where(and(eq(businessRunRecipients.id, recipient.id), eq(businessRunRecipients.state, 'pending')));

    incrementCounter('biz.calls_dispatched', { provider: ctx.provider.name });

    if (isTerminal(snapshot.status)) {
      await applyBizTerminalSnapshot(ctx, recipient.id, snapshot);
    } else {
      await enqueueJob(
        ctx.db,
        'biz.poll_recipient',
        { recipientId: recipient.id },
        {
          runAt: new Date(Date.now() + ctx.config.limits.pollDelayMs),
          dedupeKey: `bipoll:${recipient.id}:a${attempt}`,
        },
      );
    }
  } catch (error) {
    const providerError = error instanceof ProviderError ? error : null;
    if (providerError?.retryable) throw error;
    const code = providerError?.code ?? 'provider_unavailable';
    await ctx.db
      .update(businessRunRecipients)
      .set({
        state: 'failed',
        failureCode: code,
        failureMessage: describeCalleError(code),
        completedAt: new Date().toISOString(),
      })
      .where(eq(businessRunRecipients.id, recipient.id));
    logger.warn('business call dispatch failed', { runId: run.id, recipientId: recipient.id, code });
  }
}

/* --------------------------------------------------------------- polling */

export async function handleBizPollRecipient(
  ctx: OrchestratorContext,
  payload: { recipientId: string },
): Promise<void> {
  const found = await getRecipientWithRun(ctx.db, payload.recipientId);
  if (!found) return;
  const { recipient, run } = found;
  if (!recipient.providerCallId) return;
  if (['completed', 'failed', 'skipped', 'canceled'].includes(recipient.state)) {
    await maybeCompleteBizRun(ctx, run.id);
    return;
  }

  const snapshot = await ctx.provider.get(recipient.providerCallId);

  if (!isTerminal(snapshot.status)) {
    const since = recipient.waitingSince ?? recipient.dispatchedAt;
    const waitedMs = since ? Date.now() - new Date(since).getTime() : 0;
    const budgetMs = ctx.config.limits.answerTimeoutMs * ctx.config.limits.maxAttemptsPerBusiness;

    if (waitedMs >= budgetMs) {
      const workflow = await getWorkflowForRun(ctx, run);
      const maxAttempts = (workflow?.retry as { maxAttempts: number })?.maxAttempts ?? 2;
      if (recipient.attemptCount < maxAttempts) {
        // Back to pending: the next dispatch pass rings them once more, under
        // a fresh deterministic idempotency key. Never a double dial.
        await ctx.db
          .update(businessRunRecipients)
          .set({ state: 'pending', waitingSince: null, failureCode: 'answer_timeout' })
          .where(eq(businessRunRecipients.id, recipient.id));
        await enqueueJob(
          ctx.db,
          'biz.dispatch_run',
          { runId: run.id },
          { runAt: new Date(Date.now() + RETRY_BACKOFF_MS), dedupeKey: `birun:${run.id}:${Date.now()}` },
        );
        return;
      }
      await ctx.db
        .update(businessRunRecipients)
        .set({
          state: 'failed',
          failureCode: 'no_answer',
          failureMessage: 'No answer within the allowed calling time.',
          completedAt: new Date().toISOString(),
        })
        .where(eq(businessRunRecipients.id, recipient.id));
      incrementCounter('biz.answer_timeout');
      await maybeCompleteBizRun(ctx, run.id);
      return;
    }

    await ctx.db
      .update(businessRunRecipients)
      .set({ providerStatus: snapshot.status })
      .where(eq(businessRunRecipients.id, recipient.id));
    await enqueueJob(
      ctx.db,
      'biz.poll_recipient',
      payload,
      {
        runAt: new Date(Date.now() + ctx.config.limits.pollDelayMs),
        dedupeKey: `bipoll:${recipient.id}:a${recipient.attemptCount}:${Date.now()}`,
      },
    );
    return;
  }

  await applyBizTerminalSnapshot(ctx, recipient.id, snapshot);
  await maybeCompleteBizRun(ctx, run.id);
}

/* ------------------------------------------------------------- terminal */

interface ProviderSnapshot {
  status: string;
  structuredResult: unknown;
  summary: string | null;
  completionConfidence: unknown;
  evidence: string[];
  failureCode: string | null;
  failureMessage: string | null;
  attempts: Array<{
    id: string;
    status: string;
    phoneMasked: string | null;
    summary: string | null;
    transcript: unknown[];
    failureCode: string | null;
    failureMessage: string | null;
    startedAt: string | null;
    completedAt: string | null;
  }>;
  completedAt: string | null;
}

export async function applyBizTerminalSnapshot(
  ctx: OrchestratorContext,
  recipientId: string,
  snapshot: ProviderSnapshot,
): Promise<void> {
  const found = await getRecipientWithRun(ctx.db, recipientId);
  if (!found) return;
  const { recipient, run } = found;
  if (['completed', 'failed', 'skipped', 'canceled'].includes(recipient.state)) return;

  const workflow = await getWorkflowForRun(ctx, run);
  const template = workflow ? getBusinessTemplate(workflow.template) : null;
  // A null parse is the honest "could not produce a schema-valid result"
  // signal: recorded as completed with no claimed outcome, never guessed.
  const parsed = template?.resultParser(snapshot.structuredResult) ?? null;

  const disposition =
    parsed?.['outcome'] && typeof parsed['outcome'] === 'string'
      ? (parsed['outcome'] as string)
      : snapshot.status === 'failed'
        ? 'no_answer'
        : 'needs_review';

  // Transcript retention follows the owner's standing setting, exactly as on
  // the consumer side.
  const ownerRows = await ctx.db
    .select({ ownerUserId: businesses.ownerUserId })
    .from(businesses)
    .where(eq(businesses.id, run.businessId))
    .limit(1);
  let keepTranscripts = true;
  if (ownerRows[0]) {
    const settingsRows = await ctx.db
      .select({ retention: userSettings.transcriptRetentionDays })
      .from(userSettings)
      .where(eq(userSettings.userId, ownerRows[0].ownerUserId))
      .limit(1);
    keepTranscripts = (settingsRows[0]?.retention ?? 90) !== 0;
  }

  const updated = await ctx.db
    .update(businessRunRecipients)
    .set({
      providerStatus: snapshot.status,
      state: 'completed',
      disposition,
      structuredResult: parsed,
      summary: snapshot.summary,
      evidence: snapshot.evidence ?? [],
      completedAt: snapshot.completedAt ?? new Date().toISOString(),
    })
    .where(
      and(
        eq(businessRunRecipients.id, recipientId),
        sql`${businessRunRecipients.state} <> 'completed' AND ${businessRunRecipients.state} <> 'failed' AND ${businessRunRecipients.state} <> 'skipped' AND ${businessRunRecipients.state} <> 'canceled'`,
      ),
    )
    .returning({ id: businessRunRecipients.id });

  if (!updated.length) return;

  for (const attempt of snapshot.attempts) {
    await ctx.db
      .insert(businessCallAttempts)
      .values({
        id: `batt_${recipientId}_${attempt.id}`,
        recipientId,
        providerAttemptId: attempt.id,
        status: attempt.status,
        phoneMasked: attempt.phoneMasked,
        summary: attempt.summary,
        transcript: keepTranscripts ? attempt.transcript : [],
        failureCode: attempt.failureCode,
        failureMessage: attempt.failureMessage,
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt,
      })
      .onConflictDoNothing();
  }

  incrementCounter('biz.calls_completed', { disposition });
  logger.info('business call completed', {
    runId: run.id,
    recipientId,
    disposition,
    line: recipientLine({ ...recipient, structuredResult: parsed, state: 'completed' }, workflow),
  });
}

/* ------------------------------------------------------------ completion */

export async function maybeCompleteBizRun(ctx: OrchestratorContext, runId: string): Promise<void> {
  const runRows = await ctx.db.select().from(businessRuns).where(eq(businessRuns.id, runId)).limit(1);
  const run = runRows[0];
  if (!run || ['completed', 'partially_completed', 'failed', 'canceled'].includes(run.state)) return;

  const recipients = await listRecipients(ctx.db, runId);
  if (recipients.length === 0) return;
  if (recipients.some((r) => ['pending', 'calling'].includes(r.state))) return;

  const tally: Record<string, number> = {};
  for (const r of recipients) {
    const key = r.disposition ?? (r.state === 'skipped' ? 'skipped' : r.state);
    tally[key] = (tally[key] ?? 0) + 1;
  }
  const succeeded = recipients.filter((r) => r.state === 'completed').length;
  const state = succeeded === recipients.length ? 'completed' : succeeded > 0 ? 'partially_completed' : recipients.every((r) => r.state === 'skipped') ? 'completed' : 'failed';

  await ctx.db
    .update(businessRuns)
    .set({ state, stats: tally, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(and(eq(businessRuns.id, runId), eq(businessRuns.state, 'running')));

  const workflow = await getWorkflowForRun(ctx, run);
  const first = recipients[0];
  const headline =
    recipients.length === 1 && first
      ? recipientLine(first, workflow)
      : `Run finished: ${succeeded}/${recipients.length} completed.`;
  // The notification row carries a null task reference: business runs are not
  // consumer tasks, and the notifications table's task FK must not be faked.
  await notify(ctx, run.createdByUserId ?? '', null, 'Business run finished', headline);
  await audit(ctx.db, run.createdByUserId, null, 'biz_run_completed', { runId, state, stats: tally });
}

async function getWorkflowForRun(ctx: OrchestratorContext, run: BusinessRunRow): Promise<BusinessWorkflowRow | null> {
  const rows = await ctx.db
    .select()
    .from(businessWorkflows)
    .where(eq(businessWorkflows.id, run.workflowId))
    .limit(1);
  return rows[0] ?? null;
}

async function failRun(ctx: OrchestratorContext, run: BusinessRunRow, code: string, message: string): Promise<void> {
  await ctx.db
    .update(businessRuns)
    .set({
      state: 'failed',
      failureCode: code,
      failureMessage: message,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(businessRuns.id, run.id));
}

/* ------------------------------------------------------- calling hours */

/** Is `when` inside the business's permitted calling window, in its timezone? */
export function withinCallingHours(hours: CallingHours, timezone: string, when: Date): boolean {
  const hour = localHour(timezone, when);
  return hour >= hours.startHour && hour < hours.endHour;
}

/** The next moment the window opens, for jobs parked outside it. */
export function nextWindowStart(hours: CallingHours, timezone: string, when: Date): Date {
  const probe = new Date(when.getTime());
  for (let i = 0; i < 48; i += 1) {
    probe.setTime(probe.getTime() + 30 * 60 * 1000);
    if (withinCallingHours(hours, timezone, probe)) {
      // probe is the first instant inside the window; align it down to the
      // minute and hand it back. Returning the instant BEFORE the window
      // (as an earlier version did) made the job due immediately, outside
      // the window again, rescheduling forever.
      return new Date(Math.floor(probe.getTime() / 60000) * 60000);
    }
  }
  return new Date(when.getTime() + 60 * 60 * 1000);
}

function localHour(timezone: string, when: Date): number {
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    }).format(when);
    return Number.parseInt(formatted, 10) % 24;
  } catch {
    return when.getUTCHours();
  }
}
