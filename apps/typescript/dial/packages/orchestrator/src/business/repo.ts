import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  businesses,
  businessMembers,
  businessWorkflows,
  businessContacts,
  businessRuns,
  businessRunRecipients,
  businessCallAttempts,
  type BusinessRow,
  type BusinessWorkflowRow,
  type BusinessContactRow,
  type BusinessRunRecipientRow,
  type Db,
} from '@dial/database';
import {
  getBusinessTemplate,
  BUSINESS_INDUSTRY_LABELS,
  type BusinessIndustry,
  type BusinessStatus,
  describeAppointment,
} from '@dial/schemas';
import { newId } from '../repo.js';

/**
 * Persistence for the business mode. Every accessor that serves an API route
 * goes through a membership check here, so a businessId from the browser can
 * never address a business the user does not belong to.
 */

export type Membership = { businessId: string; userId: string; role: string };

export async function getMembership(db: Db, businessId: string, userId: string): Promise<Membership | null> {
  const rows = await db
    .select({ businessId: businessMembers.businessId, userId: businessMembers.userId, role: businessMembers.role })
    .from(businessMembers)
    .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getBusinessForUser(db: Db, businessId: string, userId: string): Promise<BusinessRow | null> {
  const member = await getMembership(db, businessId, userId);
  if (!member) return null;
  const rows = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  return rows[0] ?? null;
}

export function newBusinessId(): string {
  return newId('biz');
}
export function newWorkflowId(): string {
  return newId('bwf');
}
export function newContactId(): string {
  return newId('bc');
}
export function newRunId(): string {
  return newId('brun');
}
export function newRecipientId(): string {
  return newId('brr');
}

export function toBusinessDto(row: BusinessRow, role: string) {
  return {
    id: row.id,
    name: row.name,
    industry: row.industry as BusinessIndustry,
    customIndustry: row.customIndustry,
    // "Other" tells a person nothing, so when the owner typed their own
    // description that is what gets shown back to them everywhere.
    industryLabel:
      row.industry === 'other' && row.customIndustry?.trim()
        ? row.customIndustry.trim()
        : (BUSINESS_INDUSTRY_LABELS[row.industry as BusinessIndustry] ?? row.industry),
    timezone: row.timezone,
    country: row.country,
    locale: row.locale,
    address: row.address,
    website: row.website,
    businessPhone: row.businessPhone,
    status: row.status as BusinessStatus,
    hours: row.hours ?? null,
    role,
    createdAt: row.createdAt,
  };
}

export function toWorkflowDto(row: BusinessWorkflowRow) {
  const template = getBusinessTemplate(row.template);
  return {
    id: row.id,
    businessId: row.businessId,
    name: row.name,
    template: row.template,
    templateLabel: template?.label ?? row.template,
    // Every workflow is outbound. The inbound direction went with the
    // front-desk template, and the column is defaulted, so this is stated
    // rather than read back and cast to a type that no longer has two values.
    direction: 'outbound' as const,
    enabled: row.enabled,
    goal: row.goal,
    defaultLocale: row.defaultLocale,
    callingHours: row.callingHours as { startHour: number; endHour: number },
    retry: row.retry as { maxAttempts: number },
    createdAt: row.createdAt,
  };
}

export function toContactDto(row: BusinessContactRow) {
  return {
    id: row.id,
    name: row.name,
    phoneE164: row.phoneE164,
    email: row.email,
    externalReference: row.externalReference,
    locale: row.locale,
    doNotCall: row.doNotCall,
    optedOutAt: row.optedOutAt,
    metadata: (row.metadata as Record<string, string>) ?? {},
    createdAt: row.createdAt,
  };
}

export async function listWorkflows(db: Db, businessId: string): Promise<BusinessWorkflowRow[]> {
  return db
    .select()
    .from(businessWorkflows)
    .where(eq(businessWorkflows.businessId, businessId))
    .orderBy(desc(businessWorkflows.createdAt));
}

export async function getWorkflow(db: Db, businessId: string, workflowId: string) {
  const rows = await db
    .select()
    .from(businessWorkflows)
    .where(and(eq(businessWorkflows.id, workflowId), eq(businessWorkflows.businessId, businessId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listContacts(
  db: Db,
  businessId: string,
  query?: string,
): Promise<BusinessContactRow[]> {
  const where = query
    ? and(
        eq(businessContacts.businessId, businessId),
        sql`(${businessContacts.name} ILIKE ${'%' + query + '%'} OR ${businessContacts.phoneE164} ILIKE ${'%' + query + '%'} OR ${businessContacts.email} ILIKE ${'%' + query + '%'})`,
      )
    : eq(businessContacts.businessId, businessId);
  return db.select().from(businessContacts).where(where).orderBy(businessContacts.name);
}

export async function getRunForBusiness(db: Db, businessId: string, runId: string) {
  const rows = await db
    .select()
    .from(businessRuns)
    .where(and(eq(businessRuns.id, runId), eq(businessRuns.businessId, businessId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listRecipients(db: Db, runId: string): Promise<BusinessRunRecipientRow[]> {
  return db
    .select()
    .from(businessRunRecipients)
    .where(eq(businessRunRecipients.runId, runId))
    .orderBy(businessRunRecipients.createdAt);
}

export async function getRecipientWithRun(db: Db, recipientId: string) {
  const rows = await db
    .select({ recipient: businessRunRecipients, run: businessRuns })
    .from(businessRunRecipients)
    .innerJoin(businessRuns, eq(businessRuns.id, businessRunRecipients.runId))
    .where(eq(businessRunRecipients.id, recipientId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listTranscripts(db: Db, recipientIds: string[]) {
  if (recipientIds.length === 0) return new Map<string, Array<{ offsetSeconds: number; speaker: string; text: string }>>();
  const rows = await db
    .select()
    .from(businessCallAttempts)
    .where(inArray(businessCallAttempts.recipientId, recipientIds));
  const map = new Map<string, Array<{ offsetSeconds: number; speaker: string; text: string }>>();
  for (const row of rows) {
    const turns = (row.transcript as Array<{ offsetSeconds: number; speaker: string; text: string }>) ?? [];
    map.set(row.recipientId, [...(map.get(row.recipientId) ?? []), ...turns]);
  }
  return map;
}

/* --------------------------------------------------------------- outcomes */

/**
 * The one human-readable line per outcome. Built from the parsed result and
 * the run's own context -- never from a model -- so the dashboard cannot
 * overstate what the call established.
 */
export function recipientLine(recipient: BusinessRunRecipientRow, workflow: BusinessWorkflowRow | null): string {
  const first = recipient.recipientName.split(/\s+/)[0] ?? recipient.recipientName;
  const template = workflow ? getBusinessTemplate(workflow.template) : null;
  const result = recipient.structuredResult as Record<string, unknown> | null;
  // The parsed outcome when the provider returned one; otherwise the
  // disposition Dial itself derived (no_answer, needs_review, ...).
  const outcome =
    typeof result?.['outcome'] === 'string'
      ? (result['outcome'] as string)
      : recipient.state === 'completed'
        ? recipient.disposition
        : null;

  if (recipient.state === 'skipped') return `${recipient.recipientName}: skipped — opted out of calls.`;
  if (recipient.state === 'canceled') return `${recipient.recipientName}: canceled before Dial dialled.`;
  if (recipient.state === 'failed') {
    return `${first} could not be called: ${recipient.failureMessage ?? 'the call did not complete.'}`;
  }
  if (recipient.state !== 'completed') return `${recipient.recipientName}: call in progress.`;

  if (template && outcome && template.outcomeLabels[outcome]) {
    const context = (recipient.context ?? {}) as Record<string, string>;
    // Stored as `YYYY-MM-DDTHH:mm`; said and written as "Tuesday 25 August
    // 2026 at 10:30", so the summary a person reads matches what Dial spoke.
    const appointment =
      typeof context['appointmentAt'] === 'string' ? describeAppointment(context['appointmentAt']) : null;
    switch (outcome) {
      case 'confirmed':
        return `${first} confirmed${appointment ? ` ${appointment}` : ' the appointment'}.`;
      case 'cancel_requested':
        return `${first} asked to cancel${appointment ? ` the ${appointment} appointment` : ''}.`;
      case 'reschedule_requested':
        return `${first} requested a reschedule.`;
      case 'time_agreed': {
        const when = [result?.['preferred_date'], result?.['preferred_time_window']].filter(Boolean).join(' ');
        return `${first} is available ${when || 'at an agreed time'}.`;
      }
      case 'callback_requested':
        return `${first} asked to be called back later.`;
      case 'interested':
        return `${first} is interested — no time agreed yet.`;
      case 'not_interested':
        return `${first} is not interested.`;
      case 'no_answer':
        return `No answer from ${first}.`;
      case 'wrong_number':
        return `Wrong number for ${first}.`;
      case 'completed':
        return `${first}: done. ${result?.['note'] ?? ''}`.trim();
      default:
        break;
    }
  }
  if (recipient.summary) return `${recipient.recipientName}: ${recipient.summary}`;
  return `${recipient.recipientName}: ${outcome ?? 'call finished'}.`;
}

/* ------------------------------------------------------------- dashboard */

export async function businessDashboard(db: Db, businessId: string) {
  const workflows = await listWorkflows(db, businessId);
  const workflowById = new Map(workflows.map((w) => [w.id, w]));

  // Timestamps come back from the driver in the session timezone format
  // ("2026-08-26 14:52:53.871+02"), not ISO -- so "today" is compared as
  // parsed time, never as a string.
  const now = new Date();
  const dayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const isToday = (value: string | null): boolean =>
    value !== null && Number.isFinite(new Date(value).getTime()) && new Date(value).getTime() >= dayStartMs;

  const runs = await db.select().from(businessRuns).where(eq(businessRuns.businessId, businessId));
  const runIds = runs.map((r) => r.id);
  const recipients = runIds.length
    ? await db.select().from(businessRunRecipients).where(inArray(businessRunRecipients.runId, runIds))
    : [];

  const completedToday = recipients.filter((r) => r.state === 'completed' && isToday(r.completedAt)).length;
  const callsToday = recipients.filter((r) => isToday(r.dispatchedAt)).length;
  const scheduled = recipients.filter((r) => r.state === 'pending').length;
  const needsAttention = recipients.filter(
    (r) => r.state === 'failed' || r.disposition === 'cancel_requested' || r.disposition === 'reschedule_requested',
  ).length;

  const tally: Record<string, number> = {};
  for (const r of recipients) {
    if (r.state !== 'completed' || !r.disposition) continue;
    tally[r.disposition] = (tally[r.disposition] ?? 0) + 1;
  }

  const upcoming = recipients
    .filter((r) => r.state === 'pending')
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, 10)
    .map((r) => ({
      recipientId: r.id,
      recipientName: r.recipientName,
      workflowName: workflowById.get(runs.find((run) => run.id === r.runId)?.workflowId ?? '')?.name ?? null,
      scheduledAt: r.scheduledAt,
    }));

  const recent = recipients
    .filter((r) => r.state === 'completed' || r.state === 'failed')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, 10)
    .map((r) => {
      const run = runs.find((run) => run.id === r.runId);
      const workflow = run ? workflowById.get(run.workflowId) ?? null : null;
      const template = workflow ? getBusinessTemplate(workflow.template) : null;
      const result = r.structuredResult as Record<string, unknown> | null;
      const parsedOutcome = typeof result?.['outcome'] === 'string' ? (result['outcome'] as string) : null;
      // A call that connected but produced no structured result still has a
      // disposition (no_answer, needs_review...) -- label it from that.
      const outcome = parsedOutcome ?? (r.state === 'completed' ? r.disposition : null);
      return {
        recipientId: r.id,
        recipientName: r.recipientName,
        workflowName: workflow?.name ?? null,
        completedAt: r.completedAt,
        line: recipientLine(r, workflow),
        outcomeLabel: outcome && template ? template.outcomeLabels[outcome] ?? outcome : outcome,
      };
    });

  return {
    callsToday,
    scheduled,
    completedToday,
    needsAttention,
    outcomeTally: tally,
    upcoming,
    recent,
  };
}
