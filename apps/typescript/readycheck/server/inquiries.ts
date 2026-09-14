import { randomUUID } from 'node:crypto';
import type { CaseRecord, Inquiry, Plan } from '../src/domain/model';
import { nextUsefulQuestion } from '../src/domain/decisions';
import {
  CONVERSATION_POLICY_VERSION,
  buildConversationPolicy,
  conversationInstructions,
  contactBoundary,
  opening,
  spokenQuestion,
} from '../src/domain/conversation';
import { evaluateCandidate } from '../src/domain/evaluator';
import type { Store } from './store';
import { sha256, type User } from './auth';
import { connection, publicRecipient, type Config } from './config';
import { disabledRepairs, learningInstructions, learningSummary } from './learning';
import {
  callPayload,
  CreateRejected,
  mergeResults,
  parseCallResult,
  providerStatus,
  providerPhase,
  type CallTransport,
} from './calle';

export class ServiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new ServiceError(status, message);
}
export function readPlan(store: Store, id: string, owner: string): Plan | null {
  const row = store.db
    .prepare('SELECT data,status FROM plans WHERE id=? AND owner_id=?')
    .get(id, owner);
  if (!row) return null;
  const plan = JSON.parse(row.data as string) as Plan;
  plan.status = row.status as Plan['status'];
  plan.inquiries = store.db
    .prepare('SELECT * FROM inquiries WHERE plan_id=? ORDER BY rowid')
    .all(id)
    .map((r) => ({
      id: String(r.id),
      candidateId: String(r.candidate_id),
      state: r.state as Inquiry['state'],
      vendorId: r.vendor_id as string | null,
      error: r.error as string | null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      providerPhase: store.db
        .prepare(
          "SELECT detail FROM events WHERE inquiry_id=? AND type='provider_phase' ORDER BY rowid DESC LIMIT 1",
        )
        .get(String(r.id))?.detail as Inquiry['providerPhase'],
      recoveryAttempted: !!store.db
        .prepare("SELECT 1 FROM events WHERE inquiry_id=? AND type='recovery_started' LIMIT 1")
        .get(String(r.id)),
      recoveredVendorId: store.db
        .prepare(
          "SELECT detail FROM events WHERE inquiry_id=? AND type='recovery_id' ORDER BY rowid DESC LIMIT 1",
        )
        .get(String(r.id))?.detail as string | undefined,
    }));
  return plan;
}
export function casePlans(store: Store, id: string, owner: string): Plan[] {
  return store.db
    .prepare('SELECT id FROM plans WHERE case_id=? AND owner_id=? ORDER BY rowid DESC')
    .all(id, owner)
    .map((r) => readPlan(store, String(r.id), owner)!);
}
export function preparePlan(
  store: Store,
  config: Config,
  user: User,
  record: CaseRecord,
  recipientIds: string[],
  followupFor?: string,
  focusField?: string,
): Plan {
  const conn = connection(config, user);
  assert(conn.configured && conn.authorized, 403, conn.reasons.join(' '));
  assert(record.mode === 'live', 400, 'Create a live case to prepare a real inquiry.');
  assert(!record.stopped, 409, 'This search is stopped. Create a new case for a new search.');
  const revision = record.revisions.find((r) => r.version === record.currentVersion)!;
  assert(
    recipientIds.length > 0 &&
      recipientIds.length <= 3 &&
      new Set(recipientIds).size === recipientIds.length,
    400,
    'Select one to three unique test recipients.',
  );
  const recipients = recipientIds.map((id) => config.recipients.find((r) => r.id === id));
  assert(recipients.every(Boolean), 403, 'Recipient is not in the configured test allowlist.');
  assert(
    !focusField || followupFor,
    400,
    'A focused question requires an existing recipient result.',
  );
  for (const id of recipientIds) {
    const existing = revision.results.find((r) => r.id === id);
    if (existing) {
      const boundary = contactBoundary(existing);
      assert(!boundary, 409, boundary || 'Contact is blocked.');
      assert(
        followupFor === id,
        409,
        'An existing recipient needs an explicitly scoped follow-up, not a repeated initial inquiry.',
      );
    }
  }
  let requirements = revision.task.requirements;
  if (followupFor) {
    const result = revision.results.find((r) => r.id === followupFor);
    assert(
      result && recipientIds.length === 1 && recipientIds[0] === followupFor,
      400,
      'A follow-up must target one existing recipient.',
    );
    requirements = evaluateCandidate(revision.task, result!)
      .checks.filter((c) => c.verdict !== 'pass')
      .map((c) => c.requirement);
    assert(requirements.length, 400, 'There are no unresolved questions.');
    if (focusField) {
      const advice = nextUsefulQuestion(revision.task, result!);
      assert(
        advice.kind === 'ask' && advice.field === focusField,
        409,
        'This is no longer the recommended question. Refresh the evidence before preparing another call.',
      );
      requirements = requirements.filter((r) => r.id === focusField);
    }
  }
  const id = randomUUID(),
    now = new Date();
  const policy = buildConversationPolicy(
    revision.task,
    followupFor ? requirements.map((r) => r.id) : undefined,
  );
  assert(
    policy.fields.length > 0,
    400,
    'No independently answerable question remains in this scope.',
  );
  requirements = policy.fields.map((id) => requirements.find((r) => r.id === id)!);
  const questions = requirements.map((r) => spokenQuestion(policy, r));
  const disclosure = opening;
  const learning = learningSummary(store, user.id);
  const taskText = [conversationInstructions(policy), learningInstructions(learning)]
    .filter(Boolean)
    .join('\n\n');
  const content = {
    id,
    caseId: record.id,
    version: record.currentVersion,
    mode: 'live' as const,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 60000).toISOString(),
    recipients: recipients.map((r) => publicRecipient(r!)),
    questions,
    disclosure,
    taskText,
    policyVersion: policy.version,
    learningVersion: learning.version,
    followupFor,
    focusField,
  };
  // Hash includes private recipient routing and consent; only the digest is sent to the browser.
  const hash = sha256(JSON.stringify({ ...content, routing: recipients }));
  const plan: Plan = { ...content, hash, status: 'prepared', inquiries: [] };
  store.transaction(() => {
    store.db
      .prepare(
        'INSERT INTO plans(id,case_id,owner_id,version,hash,data,status,expires_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        record.id,
        user.id,
        record.currentVersion,
        hash,
        JSON.stringify(plan),
        'prepared',
        plan.expiresAt,
      );
    for (const recipient of recipients) {
      const inquiryId = randomUUID();
      store.db
        .prepare(
          'INSERT INTO inquiries(id,plan_id,candidate_id,owner_id,state,idempotency_key,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .run(
          inquiryId,
          id,
          recipient!.id,
          user.id,
          'queued',
          `readycheck_${inquiryId}`,
          JSON.stringify(callPayload(taskText, recipient!, inquiryId, policy.fields)),
          now.toISOString(),
          now.toISOString(),
        );
    }
  });
  return readPlan(store, id, user.id)!;
}
export function approvePlan(
  store: Store,
  config: Config,
  user: User,
  id: string,
  hash: string,
): Plan {
  return store.transaction(() => {
    const plan = readPlan(store, id, user.id);
    assert(plan, 404, 'Plan not found.');
    const record = store.getCase(plan!.caseId, user.id);
    assert(record, 404, 'Case not found.');
    assert(
      connection(config, user).configured && connection(config, user).authorized,
      403,
      'Live testing is not configured or authorized.',
    );
    assert(plan!.hash === hash, 409, 'The approved plan does not match this preview.');
    assert(
      plan!.learningVersion === learningSummary(store, user.id).version,
      409,
      'Correction feedback changed. Preview a new plan before calling.',
    );
    assert(
      plan!.policyVersion === CONVERSATION_POLICY_VERSION,
      409,
      'The conversation policy changed. Preview a new plan before calling.',
    );
    assert(
      record!.currentVersion === plan!.version && !record!.stopped,
      409,
      'The request changed or the search stopped. Preview a new plan.',
    );
    if (plan!.focusField) {
      const revision = record!.revisions.find((r) => r.version === plan!.version)!;
      const result = revision.results.find((r) => r.id === plan!.followupFor);
      const advice = result ? nextUsefulQuestion(revision.task, result) : null;
      assert(
        advice?.kind === 'ask' && advice.field === plan!.focusField,
        409,
        'The recommended question changed. Refresh the evidence before approving.',
      );
    }
    const current = record!.revisions.find((r) => r.version === plan!.version)!;
    for (const recipient of plan!.recipients) {
      const previous = current.results.find((r) => r.id === recipient.id);
      const boundary = previous ? contactBoundary(previous) : null;
      assert(!boundary, 409, boundary || 'Contact is blocked.');
    }
    if (plan!.status === 'approved') return plan!;
    assert(
      plan!.status === 'prepared' && Date.parse(plan!.expiresAt) > Date.now(),
      409,
      'This preview expired or is no longer available.',
    );
    store.db
      .prepare("UPDATE plans SET status='approved',approved_at=? WHERE id=? AND status='prepared'")
      .run(new Date().toISOString(), id);
    return readPlan(store, id, user.id)!;
  });
}
export class InquiryService {
  busy = false;
  constructor(
    public store: Store,
    public config: Config,
    public transport: CallTransport,
  ) {}
  recoverClaims() {
    this.store.db
      .prepare(
        "UPDATE inquiries SET state='dispatch_unknown',error='The server restarted during dispatch. Operator reconciliation is required.',updated_at=? WHERE state='claimed'",
      )
      .run(new Date().toISOString());
  }
  async dispatchNext(planId: string, user: User): Promise<Plan> {
    const connectionState = connection(this.config, user);
    assert(
      connectionState.configured && connectionState.authorized,
      403,
      connectionState.reasons.join(' '),
    );
    let inquiryId: string | null = null;
    this.store.transaction(() => {
      const plan = readPlan(this.store, planId, user.id);
      assert(plan, 404, 'Plan not found.');
      const record = this.store.getCase(plan!.caseId, user.id);
      assert(record, 404, 'Case not found.');
      assert(
        plan!.learningVersion === learningSummary(this.store, user.id).version,
        409,
        'Correction feedback changed. Preview a new plan before calling.',
      );
      assert(
        plan!.policyVersion === CONVERSATION_POLICY_VERSION,
        409,
        'The conversation policy changed. Preview a new plan before calling.',
      );
      assert(
        plan!.status === 'approved' && !record!.stopped && record!.currentVersion === plan!.version,
        409,
        'The approved plan is no longer current.',
      );
      // A repeated request observes existing work; it cannot create another dispatch.
      if (
        plan!.inquiries.some((i) =>
          ['claimed', 'dispatch_unknown', 'submitted', 'observing', 'review_required'].includes(
            i.state,
          ),
        )
      )
        return;
      assert(
        Date.parse(plan!.expiresAt) > Date.now(),
        409,
        'The approved calling window expired. Preview a new plan before another call.',
      );
      const otherActive = this.store.db
        .prepare(
          "SELECT i.id FROM inquiries i JOIN plans p ON p.id=i.plan_id WHERE p.case_id=? AND p.id<>? AND i.state IN ('claimed','dispatch_unknown','submitted','observing','review_required') LIMIT 1",
        )
        .get(record!.id, planId);
      assert(
        !otherActive,
        409,
        'Another inquiry for this case needs reconciliation or review before dispatch can continue.',
      );
      const revision = record!.revisions.find((r) => r.version === plan!.version)!;
      if (revision.results.some((r) => evaluateCandidate(revision.task, r).verdict === 'pass')) {
        this.stop(planId);
        return;
      }
      const inquiry = plan!.inquiries.find((i) => i.state === 'queued');
      if (!inquiry) {
        this.store.db.prepare("UPDATE plans SET status='complete' WHERE id=?").run(planId);
        return;
      }
      const latest = record!.revisions
        .find((r) => r.version === plan!.version)!
        .results.find((r) => r.id === inquiry.candidateId);
      const boundary = latest ? contactBoundary(latest) : null;
      assert(!boundary, 409, boundary || 'Contact is blocked.');
      const recipient = this.config.recipients.find((r) => r.id === inquiry.candidateId);
      assert(recipient, 403, 'Recipient is no longer allowlisted.');
      const stored = this.store.db
        .prepare('SELECT payload FROM inquiries WHERE id=?')
        .get(inquiry.id)!;
      const payload = JSON.parse(String(stored.payload));
      assert(
        payload.recipients[0].phones[0] === recipient!.phone,
        409,
        'Recipient routing changed. Preview a new plan.',
      );
      const hour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: recipient!.timezone,
          hour: 'numeric',
          hourCycle: 'h23',
        }).format(new Date()),
      );
      assert(
        hour >= this.config.callStart && hour < this.config.callEnd,
        409,
        `Outside the test recipient’s calling window (${this.config.callStart}:00–${this.config.callEnd}:00 local).`,
      );
      const day = new Date().toISOString().slice(0, 10);
      const total = Number(
        this.store.db
          .prepare('SELECT COUNT(*) AS n FROM budgets WHERE day=? AND released=0')
          .get(day)!.n,
      );
      const own = Number(
        this.store.db
          .prepare('SELECT COUNT(*) AS n FROM budgets WHERE day=? AND owner_id=? AND released=0')
          .get(day, user.id)!.n,
      );
      assert(
        total < this.config.maxPerDay && own < this.config.maxPerUserDay,
        429,
        'The daily call budget has been reached.',
      );
      this.store.db.prepare('INSERT INTO budgets VALUES(?,?,?,0)').run(inquiry.id, user.id, day);
      this.store.db
        .prepare("UPDATE inquiries SET state='claimed',updated_at=? WHERE id=? AND state='queued'")
        .run(new Date().toISOString(), inquiry.id);
      inquiryId = inquiry.id;
    });
    if (inquiryId) {
      const row = this.store.db.prepare('SELECT * FROM inquiries WHERE id=?').get(inquiryId)!;
      try {
        const vendorId = await this.transport.create(
          JSON.parse(String(row.payload)),
          String(row.idempotency_key),
        );
        this.store.db
          .prepare(
            "UPDATE inquiries SET state='submitted',vendor_id=?,updated_at=?,next_poll=? WHERE id=?",
          )
          .run(
            vendorId,
            new Date().toISOString(),
            new Date(Date.now() + 10000).toISOString(),
            inquiryId,
          );
        this.store.event(inquiryId, 'submitted');
      } catch (e) {
        const rejected = e instanceof CreateRejected;
        this.store.db
          .prepare('UPDATE inquiries SET state=?,error=?,updated_at=? WHERE id=?')
          .run(
            rejected ? 'failed' : 'dispatch_unknown',
            e instanceof Error ? e.message : 'Dispatch outcome is uncertain.',
            new Date().toISOString(),
            inquiryId,
          );
        if (rejected)
          this.store.db.prepare('UPDATE budgets SET released=1 WHERE inquiry_id=?').run(inquiryId);
        this.store.event(inquiryId, rejected ? 'create_rejected' : 'dispatch_unknown');
      }
    }
    return readPlan(this.store, planId, user.id)!;
  }
  stop(planId: string) {
    this.store.db.prepare("UPDATE plans SET status='stopped' WHERE id=?").run(planId);
    this.store.db
      .prepare(
        "UPDATE inquiries SET state='stopped',updated_at=? WHERE plan_id=? AND state='queued'",
      )
      .run(new Date().toISOString(), planId);
  }
  async recover(inquiryId: string, user: User) {
    const replay = this.transport.recover;
    assert(replay, 503, 'Recovery is not supported by this transport. Use the original call ID.');
    const row = this.store.transaction(() => {
      const conn = connection(this.config, user);
      assert(
        conn.configured && conn.authorized,
        403,
        'Live testing must be enabled and authorized for request recovery.',
      );
      const row = this.store.db
        .prepare('SELECT * FROM inquiries WHERE id=? AND owner_id=?')
        .get(inquiryId, user.id);
      assert(row, 404, 'Inquiry not found.');
      assert(
        row.state === 'dispatch_unknown' && !row.vendor_id,
        409,
        'Only a lost create response needs request recovery.',
      );
      assert(
        !this.store.db
          .prepare("SELECT 1 FROM events WHERE inquiry_id=? AND type='recovery_started'")
          .get(inquiryId),
        409,
        'Recovery was already attempted. Reconcile with the original call ID.',
      );
      const plan = readPlan(this.store, String(row.plan_id), user.id)!;
      const record = this.store.getCase(plan.caseId, user.id);
      assert(
        record &&
          !record.stopped &&
          record.currentVersion === plan.version &&
          plan.status === 'approved',
        409,
        'This request is no longer approved. Use read-only ID reconciliation.',
      );
      assert(
        Date.parse(plan.expiresAt) > Date.now() &&
          plan.policyVersion === CONVERSATION_POLICY_VERSION &&
          plan.learningVersion === learningSummary(this.store, user.id).version,
        409,
        'The approved request expired or its policy changed. Use read-only ID reconciliation.',
      );
      const { hash, status: _status, inquiries: _inquiries, ...content } = plan;
      const routing = plan.recipients.map((r) =>
        this.config.recipients.find((current) => current.id === r.id),
      );
      assert(
        routing.every(Boolean) && sha256(JSON.stringify({ ...content, routing })) === hash,
        409,
        'Recipient routing or consent changed. Use read-only ID reconciliation.',
      );
      const recipient = routing.find((r) => r!.id === row.candidate_id)!;
      const hour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: recipient.timezone,
          hour: 'numeric',
          hourCycle: 'h23',
        }).format(new Date()),
      );
      assert(
        hour >= this.config.callStart && hour < this.config.callEnd,
        409,
        'Outside the recipient’s calling window.',
      );
      assert(
        this.store.db
          .prepare('SELECT 1 FROM budgets WHERE inquiry_id=? AND released=0')
          .get(inquiryId),
        409,
        'The original call reservation is missing.',
      );
      const payload = JSON.parse(String(row.payload));
      assert(
        payload.metadata?.readycheck_inquiry_id === inquiryId &&
          payload.recipients?.[0]?.phones?.[0] === recipient.phone,
        409,
        'Stored request does not match this inquiry.',
      );
      // Commit before network I/O: concurrent clicks and process restarts cannot replay again.
      this.store.event(inquiryId, 'recovery_started');
      return row;
    });
    try {
      const vendorId = await replay.call(
        this.transport,
        String(row.payload),
        String(row.idempotency_key),
      );
      // Keep the ID even if the following read fails; further recovery is read-only.
      this.store.event(inquiryId, 'recovery_id', vendorId);
      return await this.reconcile(inquiryId, vendorId, user);
    } catch (error) {
      this.store.db
        .prepare(
          "UPDATE inquiries SET error=?,updated_at=? WHERE id=? AND state='dispatch_unknown'",
        )
        .run(
          'Recovery could not be verified. Use the saved call reference or check CALL-E; no further request replay is allowed.',
          new Date().toISOString(),
          inquiryId,
        );
      this.store.event(inquiryId, 'recovery_unverified');
      throw error;
    }
  }
  async reconcile(inquiryId: string, vendorId: string, user: User) {
    assert(
      connection(this.config, user).authorized,
      403,
      'This account is not authorized for live reconciliation.',
    );
    const row = this.store.db
      .prepare('SELECT * FROM inquiries WHERE id=? AND owner_id=?')
      .get(inquiryId, user.id);
    assert(row, 404, 'Inquiry not found.');
    assert(
      row.state === 'dispatch_unknown',
      409,
      'Only an uncertain dispatch needs manual ID reconciliation.',
    );
    const body = (await this.transport.read(vendorId)) as Record<string, unknown>;
    const metadata = body?.metadata as Record<string, unknown> | undefined;
    assert(
      metadata?.readycheck_inquiry_id === inquiryId,
      409,
      'CALL-E did not return matching inquiry metadata. The ID cannot be safely attached; contact the provider to reconcile.',
    );
    this.store.db
      .prepare(
        "UPDATE inquiries SET vendor_id=?,state='submitted',error=NULL,next_poll=?,updated_at=? WHERE id=? AND state='dispatch_unknown'",
      )
      .run(vendorId, new Date().toISOString(), new Date().toISOString(), inquiryId);
    this.store.event(inquiryId, 'manually_reconciled');
    return readPlan(this.store, String(row.plan_id), user.id)!;
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const rows = this.store.db
        .prepare(
          "SELECT * FROM inquiries WHERE state IN ('submitted','observing') AND (next_poll IS NULL OR next_poll<=?) LIMIT 5",
        )
        .all(new Date().toISOString());
      for (const row of rows) {
        try {
          const body = await this.transport.read(String(row.vendor_id));
          const status = providerStatus(body);
          if (['completed', 'failed', 'cancelled', 'canceled'].includes(status)) {
            this.store.transaction(() => {
              const latest = this.store.db
                .prepare('SELECT state FROM inquiries WHERE id=?')
                .get(String(row.id));
              if (!latest || !['submitted', 'observing'].includes(String(latest.state))) return;
              const planRow = this.store.db
                .prepare('SELECT * FROM plans WHERE id=?')
                .get(row.plan_id as string)!;
              const record = this.store.getCase(String(planRow.case_id), String(row.owner_id));
              if (record) {
                const revision = record.revisions.find(
                  (r) => r.version === Number(planRow.version),
                );
                const recipient = this.config.recipients.find((r) => r.id === row.candidate_id);
                if (revision && recipient) {
                  const result = parseCallResult(
                    body,
                    revision.task,
                    recipient,
                    String(row.id),
                    // A delayed read must not make old call evidence look fresh.
                    // Use the persisted request time until provider completion-time semantics are verified.
                    String(row.created_at),
                    disabledRepairs(learningSummary(this.store, String(row.owner_id))),
                  );
                  const index = revision.results.findIndex((r) => r.id === result.id);
                  const merged = mergeResults(revision.results[index], result);
                  if (index < 0) revision.results.push(merged);
                  else revision.results[index] = merged;
                  record.updatedAt = new Date().toISOString();
                  this.store.saveCase(String(row.owner_id), record);
                }
                this.store.db
                  .prepare('INSERT OR REPLACE INTO provider_results VALUES(?,?,?)')
                  .run(
                    row.id as string,
                    JSON.stringify(body),
                    new Date(Date.now() + this.config.retentionDays * 86400000).toISOString(),
                  );
              }
              this.store.db
                .prepare('UPDATE inquiries SET state=?,updated_at=?,error=NULL WHERE id=?')
                .run(
                  record ? 'review_required' : 'evaluated',
                  new Date().toISOString(),
                  row.id as string,
                );
              this.store.event(String(row.id), 'result_received', status);
            });
          } else {
            this.store.transaction(() => {
              const latest = this.store.db
                .prepare('SELECT state FROM inquiries WHERE id=?')
                .get(String(row.id));
              if (!latest || !['submitted', 'observing'].includes(String(latest.state))) return;
              const phase = providerPhase(body);
              const previous = this.store.db
                .prepare(
                  "SELECT detail FROM events WHERE inquiry_id=? AND type='provider_phase' ORDER BY rowid DESC LIMIT 1",
                )
                .get(String(row.id));
              if (previous?.detail !== phase)
                this.store.event(String(row.id), 'provider_phase', phase);
              this.store.db
                .prepare(
                  "UPDATE inquiries SET state='observing',next_poll=?,attempts=attempts+1,error=?,updated_at=? WHERE id=?",
                )
                .run(
                  new Date(Date.now() + 15000).toISOString(),
                  status === 'invalid'
                    ? 'Provider status is unrecognized; read-only reconciliation continues.'
                    : null,
                  new Date().toISOString(),
                  row.id as string,
                );
            });
          }
        } catch {
          this.store.db
            .prepare('UPDATE inquiries SET error=?,next_poll=?,attempts=attempts+1 WHERE id=?')
            .run(
              'Could not read existing call status. No new call was created.',
              new Date(Date.now() + 30000).toISOString(),
              row.id as string,
            );
        }
      }
      this.cleanup();
    } finally {
      this.busy = false;
    }
  }
  cleanup() {
    const now = new Date().toISOString();
    this.store.db.prepare('DELETE FROM provider_results WHERE expires_at<=?').run(now);
    this.store.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
    const cutoff = Date.now() - this.config.retentionDays * 86400000;
    for (const row of this.store.db
      .prepare('SELECT id,owner_id,data FROM cases WHERE deleted=0')
      .all()) {
      const record = JSON.parse(String(row.data)) as CaseRecord;
      let changed = false;
      for (const rev of record.revisions)
        for (const result of rev.results)
          if (result.mode === 'live') {
            if (Date.parse(result.checkedAt) < cutoff && result.transcript.length) {
              result.transcript = [];
              changed = true;
            }
            for (const [sourceId, turns] of Object.entries(result.sources || {})) {
              const observed =
                result.sourceTimes?.[sourceId] ||
                result.facts.find((f) => f.sourceId === sourceId)?.observedAt ||
                result.checkedAt;
              if (Date.parse(observed) < cutoff && turns.length) {
                result.sources![sourceId] = [];
                changed = true;
              }
            }
            for (const fact of result.facts)
              if (
                Date.parse(fact.observedAt) < cutoff &&
                fact.raw !== '[Transcript removed under retention policy]'
              ) {
                fact.raw = '[Transcript removed under retention policy]';
                changed = true;
              }
          }
      if (changed) this.store.saveCase(String(row.owner_id), record);
    }
  }
}
