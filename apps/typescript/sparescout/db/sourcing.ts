import { getD1, type D1Binding, type D1Statement } from "./index";
import { ensureSourcingStorage } from "./init";
import { approvalFingerprint } from "../lib/calle/approval";
import {
  buildAggregateResultSchema,
  buildCallTask,
  buildRecipientResultSchema,
  maskPhone,
  type SourcingCallPlan,
  type SourcingExecution,
  type SourcingRequest,
} from "../lib/calle/contracts";
import { sourcingRetentionCutoff } from "../lib/retention";

const retentionSweepTimes = new WeakMap<object, number>();
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export async function purgeExpiredSourcingData(db = getD1(), now = new Date()): Promise<void> {
  await ensureSourcingStorage(db);
  const previousSweep = retentionSweepTimes.get(db as object) ?? 0;
  if (now.getTime() - previousSweep < RETENTION_SWEEP_INTERVAL_MS) return;
  retentionSweepTimes.set(db as object, now.getTime());
  const cutoff = sourcingRetentionCutoff(now);
  try {
    await db.batch([
      db.prepare(`DELETE FROM webhook_events WHERE provider_call_id IN (
        SELECT run.provider_call_id FROM call_runs AS run
        INNER JOIN sourcing_requests AS request ON request.id = run.request_id
        WHERE request.created_at < ?
      )`).bind(cutoff),
      db.prepare("DELETE FROM supplier_quotes WHERE request_id IN (SELECT id FROM sourcing_requests WHERE created_at < ?)").bind(cutoff),
      db.prepare("DELETE FROM call_runs WHERE request_id IN (SELECT id FROM sourcing_requests WHERE created_at < ?)").bind(cutoff),
      db.prepare("DELETE FROM call_approvals WHERE request_id IN (SELECT id FROM sourcing_requests WHERE created_at < ?)").bind(cutoff),
      db.prepare("DELETE FROM request_suppliers WHERE request_id IN (SELECT id FROM sourcing_requests WHERE created_at < ?)").bind(cutoff),
      db.prepare("DELETE FROM sourcing_requests WHERE created_at < ?").bind(cutoff),
    ]);
  } catch (error) {
    retentionSweepTimes.delete(db as object);
    throw error;
  }
}

export async function deleteSourcingRequest(
  requestId: string,
  historyAccessHash: string,
  db = getD1(),
): Promise<boolean> {
  await ensureSourcingStorage(db);
  const authorized = await db.prepare(
    "SELECT id FROM sourcing_requests WHERE id = ? AND history_access_hash = ?",
  ).bind(requestId, historyAccessHash).first<{ id: string }>();
  if (!authorized) return false;

  await db.batch([
    db.prepare("DELETE FROM webhook_events WHERE provider_call_id IN (SELECT provider_call_id FROM call_runs WHERE request_id = ?)").bind(requestId),
    db.prepare("DELETE FROM supplier_quotes WHERE request_id = ?").bind(requestId),
    db.prepare("DELETE FROM call_runs WHERE request_id = ?").bind(requestId),
    db.prepare("DELETE FROM call_approvals WHERE request_id = ?").bind(requestId),
    db.prepare("DELETE FROM request_suppliers WHERE request_id = ?").bind(requestId),
    db.prepare("DELETE FROM sourcing_requests WHERE id = ? AND history_access_hash = ?").bind(requestId, historyAccessHash),
  ]);
  return true;
}

export async function savePlannedRequest(
  plan: SourcingCallPlan,
  historyAccessHash: string,
  db = getD1(),
): Promise<void> {
  await purgeExpiredSourcingData(db);
  const request = plan.request;
  const statements = [
    db.prepare(
      `INSERT INTO sourcing_requests (
        id, status, execution_mode, vehicle, part, fitment_reference, budget_amount,
        currency, delivery_location, needed_by, country_code, locale,
        recipient_consent_confirmed, authorized_call_window, history_access_hash,
        created_at, expires_at, updated_at
      ) VALUES (?, 'awaiting_approval', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
    ).bind(
      plan.id,
      request.executionMode,
      request.vehicle,
      request.part,
      request.fitmentReference,
      request.budgetAmount,
      request.currency,
      request.deliveryLocation,
      request.neededBy,
      request.countryCode,
      request.locale,
      Number(request.recipientConsentConfirmed),
      request.authorizedCallWindow,
      historyAccessHash,
      plan.createdAt,
      plan.expiresAt,
      plan.createdAt,
    ),
    ...request.suppliers.map((supplier) =>
      db.prepare(
        `INSERT INTO request_suppliers (
          request_id, supplier_id, name, phone_e164, phone_masked, area, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(request_id, supplier_id) DO NOTHING`,
      ).bind(
        plan.id,
        supplier.id,
        supplier.name,
        supplier.phone,
        maskPhone(supplier.phone),
        supplier.area ?? null,
        plan.createdAt,
      ),
    ),
  ];
  await db.batch(statements);
}

type StoredPlanRequestRow = {
  id: string;
  execution_mode: "fixture" | "live";
  vehicle: string;
  part: string;
  fitment_reference: string;
  budget_amount: number;
  currency: string;
  delivery_location: string;
  needed_by: string;
  country_code: string;
  locale: string;
  recipient_consent_confirmed: number;
  authorized_call_window: string;
  created_at: string;
  expires_at: string;
};

type StoredPlanSupplierRow = {
  supplier_id: string;
  name: string;
  phone_e164: string;
  area: string | null;
};

export async function getStoredSourcingCallPlan(
  requestId: string,
  db = getD1(),
): Promise<SourcingCallPlan | null> {
  await ensureSourcingStorage(db);
  const requestRow = await db.prepare(
    `SELECT id, execution_mode, vehicle, part, fitment_reference, budget_amount,
      currency, delivery_location, needed_by, country_code, locale,
      recipient_consent_confirmed, authorized_call_window, created_at, expires_at
     FROM sourcing_requests WHERE id = ?`,
  ).bind(requestId).first<StoredPlanRequestRow>();
  if (!requestRow) return null;

  const { results: supplierRows } = await db.prepare(
    `SELECT supplier_id, name, phone_e164, area
     FROM request_suppliers WHERE request_id = ? ORDER BY created_at, supplier_id`,
  ).bind(requestId).all<StoredPlanSupplierRow>();
  if (!supplierRows.length) return null;

  const request: SourcingRequest = {
    executionMode: requestRow.execution_mode,
    recipientConsentConfirmed: Boolean(requestRow.recipient_consent_confirmed),
    authorizedCallWindow: requestRow.authorized_call_window,
    vehicle: requestRow.vehicle,
    part: requestRow.part,
    fitmentReference: requestRow.fitment_reference,
    budgetAmount: requestRow.budget_amount,
    currency: requestRow.currency,
    deliveryLocation: requestRow.delivery_location,
    neededBy: requestRow.needed_by,
    countryCode: requestRow.country_code,
    locale: requestRow.locale,
    suppliers: supplierRows.map((supplier) => ({
      id: supplier.supplier_id,
      name: supplier.name,
      phone: supplier.phone_e164,
      area: supplier.area ?? undefined,
    })),
  };
  return {
    id: requestRow.id,
    createdAt: requestRow.created_at,
    expiresAt: requestRow.expires_at,
    request,
    task: buildCallTask(request),
    aggregateResultSchema: buildAggregateResultSchema(),
    recipientResultSchema: buildRecipientResultSchema(request.currency),
  };
}

export async function saveCallApproval(
  plan: SourcingCallPlan,
  approvalToken: string,
  db = getD1(),
): Promise<void> {
  await ensureSourcingStorage(db);
  const fingerprint = await approvalFingerprint(approvalToken);
  const approvedAt = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO call_approvals (id, request_id, plan_fingerprint, approved_at, consumed_at)
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(plan_fingerprint) DO NOTHING`,
    ).bind(crypto.randomUUID(), plan.id, fingerprint, approvedAt),
    db.prepare("UPDATE sourcing_requests SET status = 'approved', updated_at = ? WHERE id = ?").bind(
      approvedAt,
      plan.id,
    ),
  ]);
}

export async function saveCallExecution(
  plan: SourcingCallPlan,
  approvalToken: string,
  execution: SourcingExecution,
  db = getD1(),
): Promise<void> {
  await ensureSourcingStorage(db);
  const fingerprint = await approvalFingerprint(approvalToken);
  const now = new Date().toISOString();
  const statements = [
    db.prepare(
      "UPDATE call_approvals SET consumed_at = ? WHERE request_id = ? AND plan_fingerprint = ?",
    ).bind(now, plan.id, fingerprint),
    ...executionStatements(plan.id, execution, now, db),
  ];
  await db.batch(statements);
}

function requestStatusFor(execution: SourcingExecution): string {
  if (execution.status === "completed") return "quotes_ready";
  if (execution.status === "failed" || execution.status === "canceled") return "calls_failed";
  return "calls_in_progress";
}

function executionStatements(
  requestId: string,
  execution: SourcingExecution,
  now: string,
  db: D1Binding,
): D1Statement[] {
  const runId = `${requestId}:${execution.callId}`;
  return [
    db.prepare(
      `INSERT INTO call_runs (
        id, request_id, provider_call_id, mode, status, task_completed, confidence_score,
        confidence_label, summary, evidence_json, created_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_call_id) DO UPDATE SET
        status = excluded.status,
        task_completed = excluded.task_completed,
        confidence_score = excluded.confidence_score,
        confidence_label = excluded.confidence_label,
        summary = excluded.summary,
        evidence_json = excluded.evidence_json,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at`,
    ).bind(
      runId,
      requestId,
      execution.callId,
      execution.mode,
      execution.status,
      execution.taskCompleted === null ? null : Number(execution.taskCompleted),
      execution.completionConfidence?.score ?? null,
      execution.completionConfidence?.label ?? null,
      execution.summary,
      JSON.stringify(execution.evidence),
      execution.createdAt,
      execution.completedAt,
      now,
    ),
    ...execution.quotes.map((quote) =>
      db.prepare(
        `INSERT INTO supplier_quotes (
          id, request_id, call_run_id, supplier_id, supplier_name, status,
          result_json, summary, evidence_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(call_run_id, supplier_id) DO UPDATE SET
          status = excluded.status,
          result_json = excluded.result_json,
          summary = excluded.summary,
          evidence_json = excluded.evidence_json`,
      ).bind(
        `${runId}:${quote.supplierId}`,
        requestId,
        runId,
        quote.supplierId,
        quote.supplierName,
        quote.status,
        quote.result ? JSON.stringify(quote.result) : null,
        quote.summary,
        JSON.stringify(quote.evidence),
        now,
      ),
    ),
    db.prepare("UPDATE sourcing_requests SET status = ?, updated_at = ? WHERE id = ?").bind(
      requestStatusFor(execution),
      now,
      requestId,
    ),
  ];
}

export async function saveCallExecutionUpdate(
  requestId: string,
  execution: SourcingExecution,
  db = getD1(),
): Promise<void> {
  await ensureSourcingStorage(db);
  const now = new Date().toISOString();
  await db.batch(executionStatements(requestId, execution, now, db));
}

type RequestRow = {
  id: string;
  status: string;
  execution_mode: string;
  vehicle: string;
  part: string;
  fitment_reference: string;
  budget_amount: number;
  currency: string;
  delivery_location: string;
  needed_by: string;
  country_code: string;
  locale: string;
  recipient_consent_confirmed: number;
  authorized_call_window: string;
  created_at: string;
  updated_at: string;
};

type SupplierRow = {
  supplier_id: string;
  name: string;
  phone_masked: string;
  area: string | null;
};

type RunRow = {
  id: string;
  provider_call_id: string;
  mode: string;
  status: string;
  task_completed: number | null;
  confidence_score: number | null;
  confidence_label: string | null;
  summary: string | null;
  evidence_json: string;
  created_at: string;
  completed_at: string | null;
};

type QuoteRow = {
  call_run_id: string;
  supplier_id: string;
  supplier_name: string;
  status: string;
  result_json: string | null;
  summary: string | null;
  evidence_json: string;
  created_at: string;
};

type LiveRunRow = {
  execution_mode: string;
};

type InternalSupplierRow = {
  supplier_id: string;
  name: string;
  phone_e164: string;
  area: string | null;
};

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function getSourcingRequestHistory(
  requestId: string,
  historyAccessHash: string,
  db = getD1(),
) {
  await purgeExpiredSourcingData(db);
  const request = await db.prepare(
    `SELECT id, status, execution_mode, vehicle, part, fitment_reference, budget_amount,
      currency, delivery_location, needed_by, country_code, locale,
      recipient_consent_confirmed, authorized_call_window, created_at, updated_at
     FROM sourcing_requests WHERE id = ? AND history_access_hash = ?`,
  ).bind(requestId, historyAccessHash).first<RequestRow>();
  if (!request) return null;

  const [{ results: suppliers }, { results: runs }, { results: quotes }] = await Promise.all([
    db.prepare(
      `SELECT supplier_id, name, phone_masked, area
       FROM request_suppliers WHERE request_id = ? ORDER BY created_at, supplier_id`,
    ).bind(requestId).all<SupplierRow>(),
    db.prepare(
      `SELECT id, provider_call_id, mode, status, task_completed, confidence_score,
        confidence_label, summary, evidence_json, created_at, completed_at
       FROM call_runs WHERE request_id = ? ORDER BY created_at DESC`,
    ).bind(requestId).all<RunRow>(),
    db.prepare(
      `SELECT call_run_id, supplier_id, supplier_name, status, result_json, summary,
        evidence_json, created_at
       FROM supplier_quotes WHERE request_id = ? ORDER BY created_at, supplier_id`,
    ).bind(requestId).all<QuoteRow>(),
  ]);

  return {
    id: request.id,
    status: request.status,
    executionMode: request.execution_mode,
    vehicle: request.vehicle,
    part: request.part,
    fitmentReference: request.fitment_reference,
    budgetAmount: request.budget_amount,
    currency: request.currency,
    deliveryLocation: request.delivery_location,
    neededBy: request.needed_by,
    countryCode: request.country_code,
    locale: request.locale,
    recipientConsentConfirmed: Boolean(request.recipient_consent_confirmed),
    authorizedCallWindow: request.authorized_call_window,
    createdAt: request.created_at,
    updatedAt: request.updated_at,
    suppliers: suppliers.map((supplier) => ({
      id: supplier.supplier_id,
      name: supplier.name,
      phone: supplier.phone_masked,
      area: supplier.area,
    })),
    runs: runs.map((run) => ({
      id: run.provider_call_id,
      mode: run.mode,
      status: run.status,
      taskCompleted: run.task_completed === null ? null : Boolean(run.task_completed),
      completionConfidence: run.confidence_score === null
        ? null
        : { score: run.confidence_score, label: run.confidence_label },
      summary: run.summary,
      evidence: parseJson(run.evidence_json),
      createdAt: run.created_at,
      completedAt: run.completed_at,
      quotes: quotes
        .filter((quote) => quote.call_run_id === run.id)
        .map((quote) => ({
          supplierId: quote.supplier_id,
          supplierName: quote.supplier_name,
          status: quote.status,
          result: parseJson(quote.result_json),
          summary: quote.summary,
          evidence: parseJson(quote.evidence_json),
          createdAt: quote.created_at,
        })),
    })),
  };
}

export async function getLiveCallContext(
  requestId: string,
  providerCallId: string,
  historyAccessHash: string,
  db = getD1(),
) {
  await purgeExpiredSourcingData(db);
  const run = await db.prepare(
    `SELECT request.execution_mode
     FROM sourcing_requests AS request
     INNER JOIN call_runs AS run ON run.request_id = request.id
     WHERE request.id = ? AND run.provider_call_id = ? AND request.history_access_hash = ?`,
  ).bind(requestId, providerCallId, historyAccessHash).first<LiveRunRow>();
  if (!run || run.execution_mode !== "live") return null;

  const { results } = await db.prepare(
    `SELECT supplier_id, name, phone_e164, area
     FROM request_suppliers WHERE request_id = ? ORDER BY created_at, supplier_id`,
  ).bind(requestId).all<InternalSupplierRow>();

  return {
    requestId,
    callId: providerCallId,
    suppliers: results.map((supplier) => ({
      id: supplier.supplier_id,
      name: supplier.name,
      phone: supplier.phone_e164,
      area: supplier.area ?? undefined,
    })),
  };
}
