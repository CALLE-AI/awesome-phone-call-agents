import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  businesses,
  businessMembers,
  businessWorkflows,
  businessContacts,
  businessRuns,
  businessRunRecipients,
  enqueueJob,
  type Db,
} from '@dial/database';
import {
  createBusinessRequestSchema,
  updateBusinessRequestSchema,
  createWorkflowRequestSchema,
  updateWorkflowRequestSchema,
  createBusinessContactRequestSchema,
  updateBusinessContactRequestSchema,
  createRunRequestSchema,
  importBusinessContactsRequestSchema,
  mapImportColumns,
  getBusinessTemplate,
  listCreatableTemplates,
  type BusinessRunSummaryDto,
} from '@dial/schemas';
import {
  isValidE164,
  isBlockedNumber,
  normalizePhone,
  parseSpreadsheet,
  SpreadsheetError,
} from '@dial/domain';
import { audit, newId } from '@dial/orchestrator';
import type { OrchestratorContext } from '@dial/orchestrator';
import {
  getBusinessForUser,
  getMembership,
  getWorkflow,
  getRunForBusiness,
  listContacts,
  listRecipients,
  listTranscripts,
  listWorkflows,
  toBusinessDto,
  toContactDto,
  toWorkflowDto,
  businessDashboard,
  newBusinessId,
  newWorkflowId,
  newContactId,
  newRunId,
  newRecipientId,
} from '@dial/orchestrator';
import type { SessionUser } from '@dial/schemas';
import { describeValidationIssue } from './user-message.js';

/**
 * Business automation routes. Every handler resolves the business through the
 * caller's membership row -- a businessId from the browser is never trusted
 * on its own. The browser never sees provider credentials or raw phones of
 * recipients (masked), and all dispatch happens on the worker.
 */

export interface BusinessRouteDeps {
  db: Db;
  ctx: OrchestratorContext;
}

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

/** The same wording the rest of the API uses. */
function firstIssue(error: { issues: Array<{ path: (string | number)[]; message: string }> }): string {
  return describeValidationIssue(error);
}

export async function registerBusinessRoutes(app: FastifyInstance, deps: BusinessRouteDeps): Promise<void> {
  const { db } = deps;

  function requireUser(request: FastifyRequest, reply: FastifyReply): SessionUser | null {
    if (!request.user) {
      void reply.code(401).send({ error: { code: 'unauthorized', message: 'Sign in to continue.' } });
      return null;
    }
    return request.user;
  }

  async function requireBusiness(request: FastifyRequest, reply: FastifyReply, userId: string) {
    const { businessId } = request.params as { businessId: string };
    const business = await getBusinessForUser(db, businessId, userId);
    if (!business) {
      fail(reply, 404, 'not_found', 'That business does not exist.');
      return null;
    }
    return business;
  }

  /* ------------------------------------------------------------ businesses */

  app.get('/api/businesses', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const rows = await db
      .select({ business: businesses, role: businessMembers.role })
      .from(businessMembers)
      .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
      .where(eq(businessMembers.userId, user.id))
      .orderBy(desc(businesses.createdAt));

    const entries = [];
    for (const { business, role } of rows) {
      const workflows = await db
        .select({ enabled: businessWorkflows.enabled })
        .from(businessWorkflows)
        .where(eq(businessWorkflows.businessId, business.id));
      const dashboard = await businessDashboard(db, business.id);
      entries.push({
        id: business.id,
        name: business.name,
        industryLabel: toBusinessDto(business, role).industryLabel,
        status: business.status,
        activeWorkflows: workflows.filter((w) => w.enabled).length,
        callsToday: dashboard.callsToday,
      });
    }
    return { businesses: entries, templates: listCreatableTemplates().map(({ id, label, description }) => ({ id, label, description })) };
  });

  app.post('/api/businesses', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = createBusinessRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));

    let businessPhone: string | null = null;
    if (parsed.data.businessPhone) {
      const normalized = normalizePhone(parsed.data.businessPhone, parsed.data.country ?? null);
      if (!normalized || !isValidE164(normalized.e164)) {
        return fail(reply, 400, 'invalid_request', 'The business phone number is not valid.');
      }
      businessPhone = normalized.e164;
    }

    const id = newBusinessId();
    await db.insert(businesses).values({
      id,
      ownerUserId: user.id,
      name: parsed.data.name,
      industry: parsed.data.industry,
      // Only meaningful alongside 'other'; storing it for a named industry
      // would leave a stale label behind if the owner switched back.
      customIndustry: parsed.data.industry === 'other' ? parsed.data.customIndustry : null,
      timezone: parsed.data.timezone,
      country: parsed.data.country,
      locale: parsed.data.locale,
      address: parsed.data.address,
      website: parsed.data.website,
      businessPhone,
      hours: parsed.data.hours ?? null,
    });
    await db.insert(businessMembers).values({ id: newId('bm'), businessId: id, userId: user.id, role: 'owner' });
    await audit(db, user.id, null, 'business_created', { businessId: id });
    const rows = await db.select().from(businesses).where(eq(businesses.id, id)).limit(1);
    return toBusinessDto(rows[0]!, 'owner');
  });

  app.get('/api/businesses/:businessId', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const business = await requireBusiness(request, reply, user.id);
    if (!business) return;
    const member = await getMembership(db, business.id, user.id);
    return toBusinessDto(business, member!.role);
  });

  app.patch('/api/businesses/:businessId', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const business = await requireBusiness(request, reply, user.id);
    if (!business) return;
    const parsed = updateBusinessRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));
    const body = parsed.data;

    let businessPhone: string | null | undefined;
    if (body.businessPhone !== undefined && body.businessPhone !== null) {
      const normalized = normalizePhone(body.businessPhone, body.country ?? business.country);
      if (!normalized || !isValidE164(normalized.e164)) {
        return fail(reply, 400, 'invalid_request', 'The business phone number is not valid.');
      }
      businessPhone = normalized.e164;
    }

    // Switching to a named industry clears the free-text label rather than
    // leaving "Bakery" attached to a business now marked Retail.
    const effectiveIndustry = body.industry ?? business.industry;
    let customIndustry: string | null | undefined;
    if (effectiveIndustry !== 'other') {
      customIndustry = business.customIndustry === null ? undefined : null;
    } else if (body.customIndustry !== undefined) {
      customIndustry = body.customIndustry;
    }

    await db
      .update(businesses)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.industry !== undefined ? { industry: body.industry } : {}),
        ...(customIndustry !== undefined ? { customIndustry } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.country !== undefined ? { country: body.country } : {}),
        ...(body.locale !== undefined ? { locale: body.locale } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.website !== undefined ? { website: body.website } : {}),
        ...(businessPhone !== undefined ? { businessPhone } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.hours !== undefined ? { hours: body.hours } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(businesses.id, business.id));
    await audit(db, user.id, null, 'business_updated', { businessId: business.id });
    const member = await getMembership(db, business.id, user.id);
    return toBusinessDto((await db.select().from(businesses).where(eq(businesses.id, business.id)).limit(1))[0]!, member!.role);
  });

  app.delete('/api/businesses/:businessId', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const business = await requireBusiness(request, reply, user.id);
    if (!business) return;
    if (business.ownerUserId !== user.id) {
      return fail(reply, 403, 'forbidden', 'Only the owner can delete a business.');
    }
    await db.delete(businesses).where(eq(businesses.id, business.id));
    await audit(db, user.id, null, 'business_deleted', { businessId: business.id });
    return { ok: true };
  });

  /* ------------------------------------------------------------- workflows */

  app.get('/api/businesses/:businessId/workflows', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const business = await requireBusiness(request, reply, user.id);
    if (!business) return;
    const rows = await listWorkflows(db, business.id);
    return {
      workflows: rows.map(toWorkflowDto),
      templates: listCreatableTemplates().map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        direction: t.direction,
        contextFields: t.contextFields,
      })),
    };
  });

  app.post('/api/businesses/:businessId/workflows', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const business = await requireBusiness(request, reply, user.id);
    if (!business) return;
    const parsed = createWorkflowRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));
    const body = parsed.data;
    const template = getBusinessTemplate(body.template);
    if (!template) {
      return fail(reply, 400, 'unknown_template', 'That workflow template is not available.');
    }
    if (template.id === 'general_followup' && (!body.goal || body.goal.trim().length < 3)) {
      return fail(reply, 400, 'invalid_request', 'A custom phone job needs a goal describing what the call should achieve.');
    }

    const id = newWorkflowId();
    await db.insert(businessWorkflows).values({
      id,
      businessId: business.id,
      name: body.name,
      template: body.template,
      direction: template.direction,
      enabled: true,
      goal: body.goal,
      defaultLocale: body.defaultLocale,
      callingHours: { startHour: 9, endHour: 19, ...(body.callingHours ?? {}) },
      retry: { maxAttempts: 2, ...(body.retry ?? {}) },
    });
    await audit(db, user.id, null, 'business_workflow_created', { businessId: business.id, workflowId: id });
    return toWorkflowDto((await db.select().from(businessWorkflows).where(eq(businessWorkflows.id, id)).limit(1))[0]!);
  });

  app.get('/api/businesses/:businessId/workflows/:workflowId', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const business = await requireBusiness(request, reply, user.id);
    if (!business) return;
    const { workflowId } = request.params as { workflowId: string };
    const workflow = await getWorkflow(db, business.id, workflowId);
    if (!workflow) return fail(reply, 404, 'not_found', 'That workflow does not exist.');
    return toWorkflowDto(workflow);
  });

  app.patch('/api/businesses/:businessId/workflows/:workflowId', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const business = await requireBusiness(request, reply, user.id);
    if (!business) return;
    const { workflowId } = request.params as { workflowId: string };
    const workflow = await getWorkflow(db, business.id, workflowId);
    if (!workflow) return fail(reply, 404, 'not_found', 'That workflow does not exist.');
    const parsed = updateWorkflowRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));
    const body = parsed.data;

    await db
      .update(businessWorkflows)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.goal !== undefined ? { goal: body.goal } : {}),
        ...(body.defaultLocale !== undefined ? { defaultLocale: body.defaultLocale } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.callingHours !== undefined
          ? { callingHours: { ...(workflow.callingHours as object), ...body.callingHours } }
          : {}),
        ...(body.retry !== undefined ? { retry: { ...(workflow.retry as object), ...body.retry } } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(businessWorkflows.id, workflow.id));
    return toWorkflowDto((await db.select().from(businessWorkflows).where(eq(businessWorkflows.id, workflow.id)).limit(1))[0]!);
  });

  app.delete('/api/businesses/:businessId/workflows/:workflowId', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const business = await requireBusiness(request, reply, user.id);
    if (!business) return;
    const { workflowId } = request.params as { workflowId: string };
    const workflow = await getWorkflow(db, business.id, workflowId);
    if (!workflow) return fail(reply, 404, 'not_found', 'That workflow does not exist.');
    await db.delete(businessWorkflows).where(eq(businessWorkflows.id, workflow.id));
    await audit(db, user.id, null, 'business_workflow_deleted', { businessId: business.id, workflowId });
    return { ok: true };
  });

  /* -------------------------------------------------------------- contacts */

  app.get('/api/businesses/:businessId/contacts', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const business = await requireBusiness(request, reply, user.id);
    if (!business) return;
    const { q } = request.query as { q?: string };
    const rows = await listContacts(db, business.id, q?.trim() || undefined);
    return { contacts: rows.map(toContactDto) };
  });

  app.post('/api/businesses/:businessId/contacts', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const business = await requireBusiness(request, reply, user.id);
    if (!business) return;
    const parsed = createBusinessContactRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));
    const body = parsed.data;

    const normalized = normalizePhone(body.phone, business.country);
    if (!normalized || !isValidE164(normalized.e164)) {
      return fail(reply, 400, 'invalid_number', 'That does not look like a phone number.');
    }
    if (isBlockedNumber(normalized.e164)) {
      return fail(reply, 400, 'blocked_number', 'Dial will not store that number.');
    }

    const id = newContactId();
    const [saved] = await db
      .insert(businessContacts)
      .values({
        id,
        businessId: business.id,
        name: body.name,
        phoneE164: normalized.e164,
        email: body.email,
        externalReference: body.externalReference,
        locale: body.locale,
        metadata: body.metadata ?? {},
      })
      .onConflictDoUpdate({
        target: [businessContacts.businessId, businessContacts.phoneE164],
        set: { name: body.name, email: body.email, metadata: body.metadata ?? {}, updatedAt: new Date().toISOString() },
      })
      .returning();
    await audit(db, user.id, null, 'business_contact_saved', { businessId: business.id, contactId: saved!.id });
    return toContactDto(saved!);
  });

  /*
   * A customer list, from a spreadsheet.
   *
   * These are a BUSINESS's customers. They are written to business_contacts
   * and nowhere near the user's own address book -- separate table, separate
   * screen, separate consent. Nothing here can end up under Contacts.
   *
   * The body is bigger than the app default because it carries a file; five
   * megabytes of base64 is roughly seven of JSON, and the parser refuses
   * anything past that anyway.
   */
  app.post(
    '/api/businesses/:businessId/contacts/import',
    { bodyLimit: 8 * 1024 * 1024 },
    async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      const business = await requireBusiness(request, reply, user.id);
      if (!business) return;

      const parsed = importBusinessContactsRequestSchema.safeParse(request.body);
      if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));
      const { filename, contentBase64, dryRun } = parsed.data;

      let table;
      try {
        table = parseSpreadsheet(Buffer.from(contentBase64, 'base64'), filename);
      } catch (error) {
        // The parser's messages are already written for a person -- "That is
        // the older .xls format", not a stack trace.
        const message =
          error instanceof SpreadsheetError
            ? error.message
            : 'Dial could not read that file. Try saving it as .xlsx or .csv.';
        return fail(reply, 400, 'unreadable_file', message);
      }

      const columns = mapImportColumns(table.headers);
      const headerName = (index: number | null) =>
        index === null ? null : (table.headers[index] ?? null);

      if (columns.name === null || columns.phone === null) {
        return fail(
          reply,
          400,
          'missing_columns',
          'Dial could not find a name column and a phone column. Give the first row headings like "Name" and "Phone".',
        );
      }

      // Matched on the number, which is the only thing that identifies a
      // person here: two customers can share a name.
      const existing = await db
        .select({ phoneE164: businessContacts.phoneE164 })
        .from(businessContacts)
        .where(eq(businessContacts.businessId, business.id));
      const known = new Set(existing.map((row) => row.phoneE164));

      const skipped: Array<{ row: number; name: string | null; phone: string | null; reason: string }> = [];
      const toInsert: Array<{ name: string; phoneE164: string; email: string | null; reference: string | null }> = [];
      // A list that repeats a number inside itself must not insert it twice.
      const seenInFile = new Set<string>();
      let duplicates = 0;

      table.rows.forEach((row, index) => {
        // +2: one for the header, one because spreadsheets count from 1. This
        // is the number the user sees beside the row in Excel.
        const rowNumber = index + 2;
        const rawName = (row[columns.name!] ?? '').trim();
        const rawPhone = (row[columns.phone!] ?? '').trim();

        if (!rawName && !rawPhone) return;
        if (!rawName) {
          skipped.push({ row: rowNumber, name: null, phone: rawPhone, reason: 'No name' });
          return;
        }
        if (!rawPhone) {
          skipped.push({ row: rowNumber, name: rawName, phone: null, reason: 'No phone number' });
          return;
        }

        const normalized = normalizePhone(rawPhone, business.country);
        if (!normalized || !isValidE164(normalized.e164)) {
          skipped.push({
            row: rowNumber,
            name: rawName,
            phone: rawPhone,
            reason: business.country
              ? 'Not a phone number Dial can read'
              : 'Not a phone number Dial can read — set this business’s country to read local numbers',
          });
          return;
        }
        if (isBlockedNumber(normalized.e164)) {
          skipped.push({ row: rowNumber, name: rawName, phone: rawPhone, reason: 'Dial will not call that number' });
          return;
        }
        if (known.has(normalized.e164) || seenInFile.has(normalized.e164)) {
          duplicates += 1;
          return;
        }

        seenInFile.add(normalized.e164);
        toInsert.push({
          name: rawName.slice(0, 120),
          phoneE164: normalized.e164,
          email: columns.email === null ? null : (row[columns.email] ?? '').trim() || null,
          reference: columns.reference === null ? null : (row[columns.reference] ?? '').trim() || null,
        });
      });

      if (!dryRun && toInsert.length > 0) {
        await db.insert(businessContacts).values(
          toInsert.map((contact) => ({
            id: newContactId(),
            businessId: business.id,
            name: contact.name,
            phoneE164: contact.phoneE164,
            email: contact.email,
            externalReference: contact.reference,
          })),
        );
        await audit(db, user.id, null, 'business_contacts_imported', {
          businessId: business.id,
          imported: toInsert.length,
          skipped: skipped.length,
          duplicates,
        });
      }

      return {
        columns: {
          name: headerName(columns.name),
          phone: headerName(columns.phone),
          email: headerName(columns.email),
          reference: headerName(columns.reference),
        },
        imported: dryRun ? 0 : toInsert.length,
        duplicates,
        // Enough to see the pattern of what went wrong without a wall of rows.
        skipped: skipped.slice(0, 50),
        totalRows: table.rows.length,
        dryRun,
        sample: toInsert.slice(0, 5).map((c) => ({ name: c.name, phoneE164: c.phoneE164 })),
      };
    },
  );

  app.patch('/api/businesses/:businessId/contacts/:contactId', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const business = await requireBusiness(request, reply, user.id);
    if (!business) return;
    const { contactId } = request.params as { contactId: string };
    const rows = await db
      .select()
      .from(businessContacts)
      .where(and(eq(businessContacts.id, contactId), eq(businessContacts.businessId, business.id)))
      .limit(1);
    const contact = rows[0];
    if (!contact) return fail(reply, 404, 'not_found', 'That contact does not exist.');
    const parsed = updateBusinessContactRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));
    const body = parsed.data;

    let phoneE164: string | undefined;
    if (body.phone !== undefined) {
      const normalized = normalizePhone(body.phone, business.country);
      if (!normalized || !isValidE164(normalized.e164)) {
        return fail(reply, 400, 'invalid_number', 'That does not look like a phone number.');
      }
      phoneE164 = normalized.e164;
    }

    const [updated] = await db
      .update(businessContacts)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(phoneE164 !== undefined ? { phoneE164 } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.doNotCall !== undefined
          ? {
              doNotCall: body.doNotCall,
              optedOutAt: body.doNotCall ? new Date().toISOString() : null,
            }
          : {}),
        ...(body.metadata !== undefined ? { metadata: body.metadata ?? {} } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(businessContacts.id, contact.id))
      .returning();
    return toContactDto(updated!);
  });

  app.delete('/api/businesses/:businessId/contacts/:contactId', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const business = await requireBusiness(request, reply, user.id);
    if (!business) return;
    const { contactId } = request.params as { contactId: string };
    const removed = await db
      .delete(businessContacts)
      .where(and(eq(businessContacts.id, contactId), eq(businessContacts.businessId, business.id)))
      .returning({ id: businessContacts.id });
    if (!removed.length) return fail(reply, 404, 'not_found', 'That contact does not exist.');
    return { ok: true };
  });

  /* ------------------------------------------------------------------ runs */

  app.get('/api/businesses/:businessId/runs', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const business = await requireBusiness(request, reply, user.id);
    if (!business) return;
    const query = request.query as { limit?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 25), 1), 100);
    const rows = await db
      .select({ run: businessRuns, workflowName: businessWorkflows.name, template: businessWorkflows.template })
      .from(businessRuns)
      .leftJoin(businessWorkflows, eq(businessWorkflows.id, businessRuns.workflowId))
      .where(eq(businessRuns.businessId, business.id))
      .orderBy(desc(businessRuns.createdAt))
      .limit(limit);

    const summaries: BusinessRunSummaryDto[] = rows.map(({ run, workflowName, template }) => ({
      id: run.id,
      businessId: run.businessId,
      workflowId: run.workflowId,
      workflowName,
      workflowTemplate: template,
      state: run.state as BusinessRunSummaryDto['state'],
      scheduledAt: run.scheduledAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      stats: (run.stats as Record<string, number>) ?? {},
      failureCode: run.failureCode,
    }));
    return { runs: summaries };
  });

  app.post('/api/businesses/:businessId/workflows/:workflowId/runs', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const business = await requireBusiness(request, reply, user.id);
    if (!business) return;
    const { workflowId } = request.params as { workflowId: string };
    const workflow = await getWorkflow(db, business.id, workflowId);
    if (!workflow) return fail(reply, 404, 'not_found', 'That workflow does not exist.');
    if (!workflow.enabled) return fail(reply, 409, 'workflow_disabled', 'Turn the workflow on before running it.');

    const parsed = createRunRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', firstIssue(parsed.error));
    const body = parsed.data;
    const template = getBusinessTemplate(workflow.template);
    if (!template) return fail(reply, 409, 'unknown_template', 'This workflow has no runnable template.');

    const context = body.context ?? {};
    for (const field of template.contextFields) {
      if (!field.required) continue;
      const value = context[field.id];
      if (!value || !value.trim()) {
        return fail(reply, 400, 'missing_context', `${field.label} is required for this workflow.`);
      }
      if (field.type === 'datetime' && Number.isNaN(new Date(value).getTime())) {
        return fail(reply, 400, 'invalid_context', `${field.label} is not a valid date and time.`);
      }
    }

    if (body.scheduledAt && new Date(body.scheduledAt).getTime() < Date.now() - 60_000) {
      return fail(reply, 400, 'invalid_schedule', 'Pick a time in the future, or leave it empty to run now.');
    }

    const contacts = await db
      .select()
      .from(businessContacts)
      .where(and(eq(businessContacts.businessId, business.id), inArray(businessContacts.id, body.contactIds)));
    if (contacts.length === 0) {
      return fail(reply, 404, 'not_found', 'None of those contacts belong to this business.');
    }

    const scheduledAt = (body.scheduledAt ? new Date(body.scheduledAt) : new Date()).toISOString();
    const idempotencyKey = `birun:${workflow.id}:${scheduledAt}:${[...body.contactIds].sort().join(',')}`;
    const existing = await db
      .select({ id: businessRuns.id })
      .from(businessRuns)
      .where(eq(businessRuns.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing[0]) {
      return fail(reply, 409, 'duplicate_run', 'This exact run is already scheduled.');
    }

    const runId = newRunId();
    await db.insert(businessRuns).values({
      id: runId,
      businessId: business.id,
      workflowId: workflow.id,
      state: 'queued',
      scheduledAt,
      idempotencyKey,
      context,
      createdByUserId: user.id,
    });

    for (const contact of contacts) {
      await db.insert(businessRunRecipients).values({
        id: newRecipientId(),
        runId,
        contactId: contact.id,
        recipientName: contact.name,
        phoneE164: contact.phoneE164,
        locale: contact.locale ?? workflow.defaultLocale,
        context,
        scheduledAt,
      });
    }

    await enqueueJob(db, 'biz.dispatch_run', { runId }, { runAt: new Date(scheduledAt), dedupeKey: `birun:${runId}`, maxAttempts: 8 });
    await audit(db, user.id, null, 'business_run_created', { businessId: business.id, runId, recipients: contacts.length });
    const run = await getRunForBusiness(db, business.id, runId);
    const recipients = await listRecipients(db, runId);
    return { run: { ...run!, recipients }, workflowName: workflow.name };
  });

  app.get('/api/businesses/:businessId/runs/:runId', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const business = await requireBusiness(request, reply, user.id);
    if (!business) return;
    const { runId } = request.params as { runId: string };
    const run = await getRunForBusiness(db, business.id, runId);
    if (!run) return fail(reply, 404, 'not_found', 'That run does not exist.');
    const workflow = await getWorkflow(db, business.id, run.workflowId);
    const recipients = await listRecipients(db, runId);
    const transcripts = await listTranscripts(
      db,
      recipients.filter((r) => r.state === 'completed').map((r) => r.id),
    );

    return {
      run: {
        ...run,
        workflowName: workflow?.name ?? null,
        workflowTemplate: workflow?.template ?? null,
        recipients: recipients.map((r) => ({
          ...r,
          phoneMasked: r.phoneE164.replace(/(\+?\d{3})\d+(?=\d{2})/, '$1•••••'),
          transcript: transcripts.get(r.id) ?? [],
        })),
      },
    };
  });

  app.post('/api/businesses/:businessId/runs/:runId/cancel', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const business = await requireBusiness(request, reply, user.id);
    if (!business) return;
    const { runId } = request.params as { runId: string };
    const run = await getRunForBusiness(db, business.id, runId);
    if (!run) return fail(reply, 404, 'not_found', 'That run does not exist.');
    if (['completed', 'failed', 'canceled'].includes(run.state)) {
      return fail(reply, 409, 'already_finished', 'That run has already finished.');
    }

    // Durable-safe cancellation: the dispatch job still fires, sees the
    // canceled state, and does nothing. Calls already connecting cannot be
    // pulled back -- the same honesty as the consumer cancel.
    await db
      .update(businessRuns)
      .set({ state: 'canceled', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(businessRuns.id, run.id));
    await db
      .update(businessRunRecipients)
      .set({ state: 'canceled', failureMessage: 'Canceled before Dial dialled.', completedAt: new Date().toISOString() })
      .where(and(eq(businessRunRecipients.runId, run.id), eq(businessRunRecipients.state, 'pending')));
    await audit(db, user.id, null, 'business_run_canceled', { businessId: business.id, runId });

    const recipients = await listRecipients(db, runId);
    return { ok: true, run: { ...run, state: 'canceled' }, recipients };
  });

  /* ------------------------------------------------------------- dashboard */

  app.get('/api/businesses/:businessId/dashboard', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const business = await requireBusiness(request, reply, user.id);
    if (!business) return;
    return businessDashboard(db, business.id);
  });
}
