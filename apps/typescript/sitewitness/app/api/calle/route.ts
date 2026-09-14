import { privateRoute } from "../../lib/private-route";
import { publicCallStatus, publicProviderError } from "../../lib/output-privacy";
import {
  sessionMismatch,
  staleDemoResponse,
  type DemoSession,
  sessionGuard,
  readDemoSession,
  PENDING_CALL_SQL,
} from "../../lib/demo-session";
import { env } from "cloudflare:workers";
import { initializeCase } from "../workflow/route";
import { contactById, contactEntity } from "../../lib/case-file-store";
import { INITIAL_CONTACT, contactReadiness } from "../../lib/case-file";
import {
  readCoverage,
  yearsInText,
  describeYears,
  coverageRevision,
} from "../../lib/case-coverage";
import {
  buildCallInstructions,
  INTERVIEW_BRANCHES,
} from "../../lib/call-instructions";
import {
  CALL_EVIDENCE_SCHEMA,
  citeQuote,
  extractTranscript,
  normalizeEvidenceResult,
  type EvidenceRecord,
} from "../../lib/evidence";
import {
  CalleApiError,
  approvedProviderBase,
  CalleCallsProvider,
  CalleGoalRunProvider,
  FakeGoalRunProvider,
  verifyGoalContract,
  SITEWITNESS_GOAL_RESULT_SCHEMA,
  type GoalRun,
  type GoalRunProvider,
  type ProviderMode,
} from "../../lib/call-provider";
import {
  compileGoalContext,
  fingerprintVariables,
  type SiteKey,
} from "../../lib/goal-context";

type RuntimeEnv = {
  DB: D1Database;
  CALL_PROVIDER?: string;
  LIVE_CALLS_ENABLED?: string;
  CALLE_API_KEY?: string;
  CALLE_BASE_URL?: string;
  CALLE_GOAL_ID?: string;
};
type RequestBody = {
  action?: "prepare" | "launch" | "poll";
  interview_id?: string;
  authorization_version?: number;
  phone?: string;
  site_key?: SiteKey;
  automated_call_allowed?: boolean;
  transcription_allowed?: boolean;
  selected_channel?: string;
  preview_confirmed?: boolean;
  live_confirmation?: string;
  run_id?: string;
  contact_id?: string;
  contact_version?: number;
  preview_fingerprint?: string;
  scenario?: string;
  follow_up_focus?: string;
};
type StoredPreview = {
  site_key: SiteKey;
  variables: Record<string, string | number | boolean>;
  plan: unknown;
  variables_fingerprint: string;
  task?: string;
  contact_id?: string;
  contact_version?: number;
  provider_mode?: string;
  schema_version?: string;
  result_schema?: Record<string, unknown>;
  branches?: typeof INTERVIEW_BRANCHES;
  coverage_fingerprint?: string;
};
const LIVE_CALL_LIMIT = 20;
const runtime = () => env as unknown as RuntimeEnv;
const failure = (code: string, message: string, status = 422) =>
  Response.json({ error: { code, message } }, { status });
async function ensureLocalCallCompatibility(db: D1Database) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS call_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, interview_id TEXT NOT NULL, authorization_version INTEGER NOT NULL, provider_mode TEXT NOT NULL, provider_call_id TEXT, goal_id TEXT, goal_run_id TEXT, telephone_run_id TEXT, run_spec_id TEXT, run_spec_version INTEGER, variables_fingerprint TEXT, status TEXT NOT NULL, request_payload TEXT NOT NULL, response_payload TEXT, goal_result TEXT, goal_error TEXT, live_call_budget_reserved_at TEXT, preview_confirmed_at TEXT, launched_at TEXT, updated_at TEXT NOT NULL, UNIQUE(interview_id, authorization_version))",
    )
    .run();
  const columns = await db
    .prepare("PRAGMA table_info(call_runs)")
    .all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  const additions = [
    ["goal_id", "TEXT"],
    ["goal_run_id", "TEXT"],
    ["telephone_run_id", "TEXT"],
    ["run_spec_id", "TEXT"],
    ["run_spec_version", "INTEGER"],
    ["variables_fingerprint", "TEXT"],
    ["goal_result", "TEXT"],
    ["goal_error", "TEXT"],
    ["live_call_budget_reserved_at", "TEXT"],
  ] as const;
  for (const [name, type] of additions)
    if (!names.has(name))
      await db
        .prepare(`ALTER TABLE call_runs ADD COLUMN ${name} ${type}`)
        .run();
  await db
    .prepare("DROP INDEX IF EXISTS idx_call_runs_single_live_budget")
    .run();
  await db
    .prepare(
      "CREATE INDEX IF NOT EXISTS idx_call_runs_live_budget ON call_runs (provider_mode, live_call_budget_reserved_at)",
    )
    .run();
}

function configuration() {
  const e = runtime();
  let approvedOrigin = false;
  try { approvedProviderBase(e.CALLE_BASE_URL || "https://api.heycall-e.com"); approvedOrigin = true; } catch { /* Fail before preview or reservation. */ }
  const mode: ProviderMode =
    e.CALL_PROVIDER === "calle_calls"
      ? "calle_calls"
      : e.CALL_PROVIDER === "calle_goal"
        ? "calle_goal"
        : "fake";
  return {
    mode,
    goalId:
      mode === "fake"
        ? "goal_phase1_evidence_gap_v1"
        : mode === "calle_calls"
          ? "calls_api_v1"
          : e.CALLE_GOAL_ID || "",
    configured:
      mode === "fake" ||
      Boolean(approvedOrigin && e.CALLE_API_KEY && (mode === "calle_calls" || e.CALLE_GOAL_ID)),
    liveCallsEnabled: e.LIVE_CALLS_ENABLED === "true",
  };
}
function provider(): GoalRunProvider {
  const e = runtime();
  const config = configuration();
  if (config.mode === "calle_calls") {
    if (!e.CALLE_API_KEY)
      throw new Error("CALL-E API credentials are not configured.");
    return new CalleCallsProvider(
      e.CALLE_API_KEY,
      e.CALLE_BASE_URL || "https://api.heycall-e.com",
    );
  }
  if (config.mode === "calle_goal") {
    if (!e.CALLE_API_KEY || !config.goalId)
      throw new Error("CALL-E Goal credentials are not configured.");
    return new CalleGoalRunProvider(
      e.CALLE_API_KEY,
      e.CALLE_BASE_URL || "https://api.heycall-e.com",
    );
  }
  return new FakeGoalRunProvider();
}
function consentFailures(body: RequestBody) {
  const failures: string[] = [];
  if (body.selected_channel !== "automated_callback")
    failures.push("Automated callback was not selected.");
  if (!body.automated_call_allowed)
    failures.push("Automated-call consent is missing.");
  if (!body.transcription_allowed)
    failures.push("Transcription permission is missing.");
  if (!body.interview_id || !body.authorization_version)
    failures.push("Interview authorization is incomplete.");
  if (!body.site_key) failures.push("A supported site context is required.");
  return failures;
}
function launchFailures(body: RequestBody, live: boolean) {
  const failures = consentFailures(body);
  if (!body.preview_confirmed)
    failures.push("The current Goal plan has not been confirmed.");
  if (!body.phone || !/^\+[1-9]\d{7,14}$/.test(body.phone))
    failures.push("A valid authorized E.164 phone number is required.");
  if (live && body.live_confirmation !== "PLACE LIVE CALL")
    failures.push("The second live-call confirmation is missing.");
  return failures;
}

// Durable leases serialize status checks; terminal ingestion commits as one batch.
// Existing audit storage avoids changing the database schema of an installed demo.
const leaseEntity = (runId: number) => `CALL-POLL-${runId}`;
const evidenceEntity = (runId: number) => `CALL-EVIDENCE-${runId}`;
function leaseGuard(runId: number, token: string) {
  // Both values are generated internally (integer ID and UUID), never user text.
  return `EXISTS (SELECT 1 FROM audit_events WHERE entity_id = 'CALL-POLL-${runId}' AND detail = '${token}' AND id = (SELECT MAX(id) FROM audit_events WHERE entity_id = 'CALL-POLL-${runId}'))`;
}
function launchGuard(runId: number, token: string) {
  return `EXISTS (SELECT 1 FROM audit_events WHERE entity_id = 'CALL-LAUNCH-${runId}' AND detail = '${token}' AND id = (SELECT MAX(id) FROM audit_events WHERE entity_id = 'CALL-LAUNCH-${runId}'))`;
}
async function ingestResult(
  db: D1Database,
  runId: number,
  providerMode: string,
  result: EvidenceRecord,
  raw: unknown,
  token: string,
  session: DemoSession,
) {
  const turns = extractTranscript(raw, runId),
    now = new Date().toISOString();
  const admissible = result.statements
    .map((statement, index) => ({ ...statement, index }))
    .filter(
      (statement) =>
        statement.fact.trim() &&
        statement.evidence_quote.trim() &&
        !/\b(no rec|phase ii|no environmental concern|not contaminated|no liability)\b/i.test(
          statement.fact,
        ),
    );
  const guard = `${leaseGuard(runId, token)} AND NOT EXISTS (SELECT 1 FROM audit_events WHERE entity_id = 'CALL-EVIDENCE-${runId}')`;
  const writes = admissible.map((statement) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO ingested_statements (id, evidence_gap_id, origin, fact, source, certainty, evidence, limitations, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`,
      )
      .bind(
        `CALLE-GOAL-${runId}-${statement.index + 1}`,
        session.caseId,
        providerMode,
        statement.fact,
        statement.source_type,
        statement.certainty,
        statement.evidence_quote,
        result.limitations,
        now,
      ),
  );
  for (const [index, lead] of result.leads.entries()) {
    if (
      citeQuote(lead.quote, turns).status !== "matched" ||
      !lead.quote.toLocaleLowerCase().includes(lead.name.toLocaleLowerCase())
    )
      continue;
    const id = `lead-${runId}-${index}`,
      entity = contactEntity(id, session);
    const contact = {
      ...INITIAL_CONTACT,
      id,
      name: lead.name,
      role: lead.reason,
      expectedPeriod: "Not established",
      source: `${providerMode === "fake" ? "Synthetic rehearsal" : "Respondent referral"} in interview ${runId}`,
      sourceRecord: null,
      sourceQuote: lead.quote,
      sourceRun: runId,
      version: 0,
    };
    writes.push(
      db
        .prepare(
          `INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) SELECT 'CASE_CONTACT_LEAD', ?, ?, 'System', ? WHERE ${guard} AND NOT EXISTS (SELECT 1 FROM audit_events WHERE entity_id = ?)`,
        )
        .bind(entity, JSON.stringify(contact), now, entity),
    );
  }
  const next = admissible.length
    ? "Review the returned interview evidence. The proposed interview outcome is not a human case disposition."
    : "The interview produced no factual statements for review. Arrange a human response or seek another source.";
  writes.push(
    db
      .prepare(
        `UPDATE case_workflow SET status = ?, assigned_role = ?, next_action = ?, updated_at = ? WHERE evidence_gap_id = ? AND ${guard}`,
      )
      .bind(
        admissible.length ? "AWAITING_EP_REVIEW" : "FOLLOW_UP_REQUIRED",
        admissible.length ? "reviewer" : "coordinator",
        next,
        now,
        session.caseId,
      ),
  );
  writes.push(
    db
      .prepare(
        `INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) SELECT 'CALLE_GOAL_RESULT_INGESTED', ?, ?, 'System', ? WHERE ${guard}`,
      )
      .bind(
        evidenceEntity(runId),
        JSON.stringify({
          run_id: runId,
          provider_mode: providerMode,
          interview_outcome: result.outcome,
          statements_created: admissible.length,
        }),
        now,
      ),
  );
  const saved = await db.batch(writes);
  return {
    valid: true,
    statementsCreated: saved
      .slice(0, admissible.length)
      .reduce((total, item) => total + (item.meta.changes || 0), 0),
    outcome: result.outcome,
  };
}
async function recordGoalError(
  db: D1Database,
  runId: number,
  error: { code: string; message: string },
  token: string,
  session: DemoSession,
) {
  error = publicProviderError(error)!;
  const next =
    error.code === "declined"
      ? "The respondent declined. Choose a human or written follow-up only if appropriate."
      : error.code === "no_answer"
        ? "No human answered. Coordinate a retry or another consented channel."
        : "CALL-E could not return usable evidence. Arrange human follow-up.";
  const now = new Date().toISOString(),
    guard = leaseGuard(runId, token);
  await db.batch([
    db
      .prepare(
        `UPDATE call_runs SET status = ?, goal_error = ?, updated_at = ? WHERE id = ? AND ${guard}`,
      )
      .bind(error.code.toUpperCase(), JSON.stringify(error), now, runId),
    db
      .prepare(
        `UPDATE case_workflow SET status = 'FOLLOW_UP_REQUIRED', assigned_role = 'coordinator', next_action = ?, updated_at = ? WHERE evidence_gap_id = ? AND ${guard}`,
      )
      .bind(next, now, session.caseId),
  ]);
}

async function getHandler(request: Request) {
  const e = runtime();
  const session = await initializeCase();
  await ensureLocalCallCompatibility(e.DB);
  const config = configuration();
  const count = await e.DB.prepare(
    "SELECT COUNT(*) AS count FROM call_runs WHERE interview_id = ? AND provider_mode IN ('calle_goal','calle_calls') AND goal_run_id IS NOT NULL",
  )
    .bind(session.interviewId)
    .first<{ count: number }>();
  const reserved = await e.DB.prepare(
    "SELECT COUNT(*) AS count FROM call_runs WHERE provider_mode IN ('calle_goal','calle_calls') AND live_call_budget_reserved_at IS NOT NULL",
  ).first<{ count: number }>();
  let goal: {
    id: string;
    title?: string;
    version?: number;
    contract_valid: boolean;
    missing_inputs?: readonly string[];
    missing_results?: readonly string[];
  } = {
    id: config.goalId,
    contract_valid: config.mode !== "calle_goal" && config.configured,
  };
  if (config.configured && config.mode === "calle_goal") {
    try {
      const published = await provider().getGoal(config.goalId);
      const contract = verifyGoalContract(published);
      goal = {
        id: published.id,
        title: published.title,
        version: published.runSpecVersion,
        contract_valid: contract.valid,
        missing_inputs: contract.missingInputs,
        missing_results: contract.missingResults,
      };
    } catch {
      goal.contract_valid = false;
    }
  }
  const pending = await e.DB.prepare(
    `SELECT id, authorization_version, status, request_payload, goal_run_id FROM call_runs WHERE interview_id = ? AND provider_mode = ? AND ${PENDING_CALL_SQL} ORDER BY id DESC LIMIT 1`,
  )
    .bind(session.interviewId, config.mode)
    .first<{
      id: number;
      authorization_version: number;
      status: string;
      request_payload: string;
      goal_run_id: string | null;
    }>();
  const pendingAttempt = pending
    ? {
        ...JSON.parse(pending.request_payload),
        authorization_version: pending.authorization_version,
        run_id: pending.id,
        status: publicCallStatus(pending.status),
        has_provider_id: Boolean(pending.goal_run_id),
      }
    : null;
  const used = reserved?.count || 0;
  return Response.json({
    session,
    provider_mode: config.mode,
    provider_configured: config.configured,
    live_calls_enabled: config.liveCallsEnabled,
    external_calls_created: count?.count || 0,
    live_call_limit: LIVE_CALL_LIMIT,
    live_call_slots_remaining: Math.max(0, LIVE_CALL_LIMIT - used),
    pending_attempt: pendingAttempt,
    safe_for_development: config.mode === "fake" || !config.liveCallsEnabled,
    published_goal: config.mode === "calle_goal",
    integration_label:
      config.mode === "calle_calls"
        ? "CALL-E Calls API"
        : config.mode === "fake"
          ? "Synthetic rehearsal provider"
          : "CALL-E Goal Runs",
    goal,
  });
}

async function postHandler(request: Request) {
  const e = runtime();
  const session = await initializeCase();
  if (sessionMismatch(request, session)) return staleDemoResponse();
  await ensureLocalCallCompatibility(e.DB);
  const role = request.headers.get("x-demo-role");
  if (role !== "coordinator")
    return failure(
      "PERMISSION_DENIED",
      "Coordinator permission is required.",
      403,
    );
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return failure("INVALID_REQUEST", "A JSON request body is required.", 400);
  }
  const config = configuration();
  const live = config.mode !== "fake";
  if (
    ["prepare", "launch"].includes(body.action || "") &&
    body.interview_id !== session.interviewId
  )
    return failure(
      "CASE_MISMATCH",
      "This request belongs to an earlier case. Refresh the current workspace.",
      409,
    );
  if (body.action === "prepare") {
    const active = await e.DB.prepare(
      `SELECT id FROM call_runs WHERE provider_mode = ? AND ${PENDING_CALL_SQL} LIMIT 1`,
    )
      .bind(config.mode)
      .first();
    if (active)
      return failure(
        "ACTIVE_CALL_EXISTS",
        "An active or unconfirmed call already exists. Resume that interview or retry its saved brief before preparing another.",
        409,
      );
    const problems = consentFailures(body);
    if (problems.length) return failure("PREVIEW_BLOCKED", problems.join(" "));
    if (config.mode === "calle_goal" && body.contact_id)
      return failure(
        "INTEGRATION_MISMATCH",
        "This revised case-file brief uses the Calls API. The configured published Goal has a separate contract.",
        409,
      );
    const contact = body.contact_id
      ? await contactById(e.DB, body.contact_id, session)
      : null;
    if (
      config.mode !== "calle_goal" &&
      (!contact || contactReadiness(contact) !== "Ready for authorized call")
    )
      return failure(
        "CONTACT_REQUIRED",
        "Select a suitable respondent, supply their number and record permission before preparing a call.",
      );
    if (contact && contact.version !== body.contact_version)
      return failure(
        "CONTACT_STALE",
        "Contact details changed. Refresh and prepare a new brief.",
        409,
      );
    const preparedCoverage = await readCoverage(e.DB, config.mode, session);
    const compiled = compileGoalContext(body.site_key!);
    if (
      body.follow_up_focus !== undefined &&
      (typeof body.follow_up_focus !== "string" ||
        body.follow_up_focus.length > 800)
    )
      return failure(
        "INVALID_FOLLOW_UP",
        "Keep the follow-up question within 800 characters.",
      );
    const focus = body.follow_up_focus?.trim() || "";
    if (focus && focus.length < 20)
      return failure(
        "INVALID_FOLLOW_UP",
        "Describe the remaining period or factual question in at least 20 characters.",
      );
    if (focus && config.mode === "calle_goal")
      return failure(
        "INTEGRATION_MISMATCH",
        "A targeted follow-up brief requires the Calls API.",
        409,
      );
    if (focus) {
      compiled.plan.evidenceGap += ` Coordinator-selected follow-up: ${focus}`;
      compiled.plan.priorityBranches.unshift(
        `Focus this interview on the remaining question supplied by the coordinator: ${focus}. Confirm the respondent's own knowledge; prior statements are context, not independently verified facts.`,
      );
      compiled.variables.evidence_gap = compiled.plan.evidenceGap;
    }
    if (contact) {
      compiled.plan.respondentRole = `${contact.name}, ${contact.role}`;
      compiled.plan.expectedKnowledgePeriod =
        contact.expectedPeriod || "Not established";
      compiled.variables.respondent_role = compiled.plan.respondentRole;
      const coverage = preparedCoverage;
      if (coverage.records.length && coverage.missingYears.length) {
        const target = yearsInText(contact.expectedPeriod).filter((year) =>
          coverage.missingYears.includes(year),
        );
        const remaining = `Human-confirmed interview testimony in this case addresses ${describeYears(coverage.years)}. Remaining years without reviewed testimony: ${describeYears(coverage.missingYears)}. Ask this respondent about ${describeYears(target.length ? target : coverage.missingYears)}, subject to their actual knowledge. Earlier testimony is context, not independent verification. Do not ask them to assert facts outside their knowledge.`;
        compiled.plan.evidenceGap += ` ${remaining}`;
        compiled.plan.priorityBranches.unshift(remaining);
        compiled.variables.evidence_gap = compiled.plan.evidenceGap;
      }
    }
    if (config.mode === "fake")
      (compiled.variables as Record<string, string>).demo_scenario = [
        "direct",
        "declined",
      ].includes(body.scenario || "")
        ? body.scenario!
        : "bounded";
    const task = buildCallInstructions(compiled.plan);
    const resultSchema =
      config.mode === "calle_goal"
        ? SITEWITNESS_GOAL_RESULT_SCHEMA
        : CALL_EVIDENCE_SCHEMA;
    const fingerprint = await fingerprintVariables({
      ...compiled.variables,
      task,
      contact: `${contact?.id || "legacy"}:${contact?.version || 0}`,
      provider: config.mode,
      result_schema: JSON.stringify(resultSchema),
    });
    const now = new Date().toISOString();
    const stored: StoredPreview = {
      coverage_fingerprint: coverageRevision(preparedCoverage),
      site_key: body.site_key!,
      variables: compiled.variables,
      plan: compiled.plan,
      task,
      contact_id: contact?.id,
      contact_version: contact?.version,
      provider_mode: config.mode,
      schema_version:
        config.mode === "calle_goal" ? "compact-legacy" : "evidence-v2",
      result_schema: resultSchema,
      branches: INTERVIEW_BRANCHES,
      variables_fingerprint: fingerprint,
    };
    let authorizationVersion = body.authorization_version!;
    {
      const existing = await e.DB.prepare(
        "SELECT goal_run_id, live_call_budget_reserved_at FROM call_runs WHERE interview_id = ? AND authorization_version = ?",
      )
        .bind(body.interview_id, authorizationVersion)
        .first<{
          goal_run_id: string | null;
          live_call_budget_reserved_at: string | null;
        }>();
      if (existing?.goal_run_id || existing?.live_call_budget_reserved_at) {
        const latest = await e.DB.prepare(
          "SELECT MAX(authorization_version) AS version FROM call_runs WHERE interview_id = ?",
        )
          .bind(body.interview_id)
          .first<{ version: number | null }>();
        authorizationVersion = (latest?.version || authorizationVersion) + 1;
      }
    }
    const savedPreview = await e.DB.prepare(
      `INSERT INTO call_runs (interview_id, authorization_version, provider_mode, goal_id, status, request_payload, variables_fingerprint, updated_at) SELECT ?, ?, ?, ?, 'PREVIEWED', ?, ?, ? WHERE ${sessionGuard(session)} ON CONFLICT(interview_id, authorization_version) DO UPDATE SET provider_mode = excluded.provider_mode, goal_id = excluded.goal_id, status = 'PREVIEWED', request_payload = excluded.request_payload, variables_fingerprint = excluded.variables_fingerprint, preview_confirmed_at = NULL, updated_at = excluded.updated_at WHERE call_runs.goal_run_id IS NULL AND call_runs.live_call_budget_reserved_at IS NULL AND call_runs.status != 'DEMO_CALL_STARTING'`,
    )
      .bind(
        body.interview_id,
        authorizationVersion,
        config.mode,
        config.goalId,
        JSON.stringify(stored),
        fingerprint,
        now,
      )
      .run();
    if (!savedPreview.meta.changes) return staleDemoResponse();
    return Response.json({
      ok: true,
      status: "PREVIEWED",
      provider_mode: config.mode,
      goal_id: config.goalId,
      authorization_version: authorizationVersion,
      plan: compiled.plan,
      variables: compiled.variables,
      variables_fingerprint: fingerprint,
      task,
      branches: INTERVIEW_BRANCHES,
      contact_id: contact?.id,
      contact_version: contact?.version,
    });
  }
  if (body.action === "launch") {
    if (live && (!config.configured || !config.liveCallsEnabled))
      return failure(
        "LIVE_CALLS_DISABLED",
        "Live CALL-E calls are not configured and explicitly enabled.",
        409,
      );
    const launchContact = body.contact_id
      ? await contactById(e.DB, body.contact_id, session)
      : null;
    if (
      config.mode !== "calle_goal" &&
      (!launchContact ||
        contactReadiness(launchContact) !== "Ready for authorized call")
    )
      return failure(
        "CONTACT_REQUIRED",
        "This contact is not ready for an authorized call.",
      );
    if (launchContact) {
      if (launchContact.version !== body.contact_version)
        return failure(
          "CONTACT_STALE",
          "The contact or its permissions changed. Prepare a new brief.",
          409,
        );
      body.phone = launchContact.phone;
      body.automated_call_allowed = launchContact.automatedAllowed;
      body.transcription_allowed = launchContact.transcriptionAllowed;
    }
    const problems = launchFailures(body, live);
    if (problems.length) return failure("LAUNCH_BLOCKED", problems.join(" "));
    const row = await e.DB.prepare(
      "SELECT id, goal_id, goal_run_id, live_call_budget_reserved_at, status, request_payload, variables_fingerprint FROM call_runs WHERE interview_id = ? AND authorization_version = ?",
    )
      .bind(body.interview_id, body.authorization_version)
      .first<{
        id: number;
        goal_id: string;
        goal_run_id: string | null;
        live_call_budget_reserved_at: string | null;
        status: string;
        request_payload: string;
        variables_fingerprint: string;
      }>();
    if (!row)
      return failure(
        "PREVIEW_REQUIRED",
        "Prepare the Goal plan before launch.",
        409,
      );
    if (row.goal_run_id)
      return Response.json({
        ok: true,
        duplicate: true,
        run_id: row.id,
        status: publicCallStatus(row.status),
      });
    const stored = JSON.parse(row.request_payload) as StoredPreview;
    if (
      stored.coverage_fingerprint !==
      coverageRevision(await readCoverage(e.DB, config.mode, session))
    )
      return failure(
        "EVIDENCE_CHANGED",
        "The reviewed years or supporting statements changed. Prepare and approve a new brief before calling.",
        409,
      );
    if (
      stored.site_key !== body.site_key ||
      stored.variables_fingerprint !== row.variables_fingerprint ||
      stored.provider_mode !== config.mode ||
      stored.contact_id !== body.contact_id ||
      stored.contact_version !== body.contact_version ||
      (stored.contact_id &&
        body.preview_fingerprint !== row.variables_fingerprint) ||
      !stored.task ||
      JSON.stringify(stored.result_schema) !==
        JSON.stringify(
          config.mode === "calle_goal"
            ? SITEWITNESS_GOAL_RESULT_SCHEMA
            : CALL_EVIDENCE_SCHEMA,
        )
    )
      return failure(
        "PREVIEW_STALE",
        "The compiled Goal variables changed; prepare and confirm a new preview.",
        409,
      );
    const published = await provider().getGoal(row.goal_id);
    const contract = verifyGoalContract(published);
    if (!contract.valid)
      return failure(
        "GOAL_CONTRACT_MISMATCH",
        "The published CALL-E Goal does not match the SiteWitness input and result contract.",
        409,
      );
    const reservationTime = new Date().toISOString();
    const launchToken = crypto.randomUUID();
    const launchEntity = `CALL-LAUNCH-${row.id}`;
    const claimed = await e.DB.batch([
      e.DB.prepare(
        `INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at)
        SELECT 'CALL_LAUNCH_CLAIMED', ?, ?, 'System', ? WHERE ${sessionGuard(session)}
        AND EXISTS (SELECT 1 FROM call_runs WHERE id = ? AND goal_run_id IS NULL
          AND (? = 0 OR live_call_budget_reserved_at IS NOT NULL OR (SELECT COUNT(*) FROM call_runs WHERE provider_mode IN ('calle_goal','calle_calls') AND live_call_budget_reserved_at IS NOT NULL) < ?))
        AND NOT EXISTS (SELECT 1 FROM audit_events WHERE entity_id = ? AND event_type = 'CALL_LAUNCH_CLAIMED'
          AND created_at > ? AND id = (SELECT MAX(id) FROM audit_events WHERE entity_id = ?))`,
      ).bind(
        launchEntity,
        launchToken,
        reservationTime,
        row.id,
        live ? 1 : 0,
        LIVE_CALL_LIMIT,
        launchEntity,
        new Date(Date.now() - 60000).toISOString(),
        launchEntity,
      ),
      e.DB.prepare(
        `UPDATE call_runs SET live_call_budget_reserved_at = CASE WHEN ? = 1 THEN COALESCE(live_call_budget_reserved_at, ?) ELSE live_call_budget_reserved_at END,
        status = 'DEMO_CALL_STARTING', updated_at = ? WHERE id = ? AND goal_run_id IS NULL AND ${launchGuard(row.id, launchToken)}`,
      ).bind(live ? 1 : 0, reservationTime, reservationTime, row.id),
    ]);
    if (!claimed[0].meta.changes) {
      if ((await readDemoSession(e.DB)).caseId !== session.caseId)
        return staleDemoResponse();
      const duplicate = await e.DB.prepare(
        "SELECT id, status FROM call_runs WHERE id = ? AND goal_run_id IS NOT NULL",
      )
        .bind(row.id)
        .first<{ id: number; status: string }>();
      if (duplicate)
        return Response.json({
          ok: true,
          duplicate: true,
          run_id: duplicate.id,
          status: publicCallStatus(duplicate.status),
        });
      const allowance = await e.DB.prepare(
        "SELECT COUNT(*) AS used FROM call_runs WHERE provider_mode IN ('calle_goal','calle_calls') AND live_call_budget_reserved_at IS NOT NULL",
      ).first<{ used: number }>();
      return live &&
        !row.live_call_budget_reserved_at &&
        (allowance?.used || 0) >= LIVE_CALL_LIMIT
        ? failure(
            "LIVE_CALL_LIMIT_REACHED",
            `The ${LIVE_CALL_LIMIT}-call allowance has been used. No additional call can be created.`,
            409,
          )
        : failure(
            "CALL_SUBMISSION_IN_PROGRESS",
            "This call is already being submitted. Wait a moment, then resume the saved attempt; do not start another call.",
            409,
          );
    }
    try {
      let created: GoalRun;
      try {
        created = await provider().create({
          goalId: row.goal_id,
          interviewId: body.interview_id!,
          authorizationVersion: body.authorization_version!,
          phone: body.phone!,
          variables: stored.variables,
          task: stored.task,
          resultSchema: stored.result_schema,
        });
      } catch (error) {
        const confirmed = await e.DB.prepare(
          "SELECT id, status FROM call_runs WHERE id = ? AND goal_run_id IS NOT NULL",
        )
          .bind(row.id)
          .first<{ id: number; status: string }>();
        if (confirmed)
          return Response.json({
            ok: true,
            duplicate: true,
            run_id: confirmed.id,
            status: publicCallStatus(confirmed.status),
          });
        if (
          live &&
          !row.live_call_budget_reserved_at &&
          error instanceof CalleApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408 &&
          error.status !== 409
        )
          await e.DB.prepare(
            `UPDATE call_runs SET status = 'LIVE_CALL_SUBMISSION_REJECTED', live_call_budget_reserved_at = NULL, goal_error = ?, updated_at = ? WHERE id = ? AND goal_run_id IS NULL AND ${launchGuard(row.id, launchToken)}`,
          )
            .bind(
              JSON.stringify({ code: error.code, message: error.message }),
              new Date().toISOString(),
              row.id,
            )
            .run();
        else if (live)
          await e.DB.prepare(
            `UPDATE call_runs SET status = 'LIVE_CALL_SUBMISSION_UNCERTAIN', updated_at = ? WHERE id = ? AND goal_run_id IS NULL AND ${launchGuard(row.id, launchToken)}`,
          )
            .bind(new Date().toISOString(), row.id)
            .run();
        else
          await e.DB.prepare(
            `UPDATE call_runs SET status = 'PREVIEWED' WHERE id = ? AND goal_run_id IS NULL AND ${launchGuard(row.id, launchToken)}`,
          )
            .bind(row.id)
            .run();
        const detail =
          error instanceof CalleApiError ? ` ${error.message}` : "";
        return failure(
          "CALL_SUBMISSION_FAILED",
          live
            ? `CALL-E did not confirm the call.${detail} ${!row.live_call_budget_reserved_at && error instanceof CalleApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 409 ? "No call slot was consumed." : "You can safely retry this same reserved attempt; it will not consume another slot."}`
            : "The fake Goal Run could not be created.",
          502,
        );
      }
      const now = new Date().toISOString();
      await e.DB.prepare(
        `UPDATE call_runs SET goal_error = NULL, goal_result = NULL, goal_run_id = ?, telephone_run_id = ?, run_spec_id = ?, run_spec_version = ?, status = ?, response_payload = ?, preview_confirmed_at = ?, launched_at = ?, updated_at = ? WHERE id = ? AND goal_run_id IS NULL AND ${launchGuard(row.id, launchToken)}`,
      )
        .bind(
          created.goalRunId,
          created.telephoneRunId,
          created.runSpecId,
          created.runSpecVersion,
          created.status,
          JSON.stringify(created.raw),
          now,
          now,
          now,
          row.id,
        )
        .run();
      return Response.json({
        ok: true,
        run_id: row.id,
        status: created.status,
        terminal: created.terminal,
      });
    } finally {
      await e.DB.prepare(
        `INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at)
        SELECT 'CALL_LAUNCH_RELEASED', ?, ?, 'System', ? WHERE ${launchGuard(row.id, launchToken)}`,
      )
        .bind(launchEntity, launchToken, new Date().toISOString())
        .run();
    }
  }
  if (body.action === "poll") {
    if (!body.run_id || !/^\d+$/.test(String(body.run_id)))
      return failure(
        "RUN_REQUIRED",
        "A known SiteWitness run identifier is required.",
      );
    const row = await e.DB.prepare(
      "SELECT id, goal_id, goal_run_id, provider_mode, status, goal_result, goal_error, response_payload, request_payload FROM call_runs WHERE id = ? AND interview_id = ?",
    )
      .bind(body.run_id, session.interviewId)
      .first<{
        id: number;
        goal_id: string;
        goal_run_id: string | null;
        provider_mode: string;
        status: string;
        goal_result: string | null;
        goal_error: string | null;
        response_payload: string | null;
        request_payload: string;
      }>();
    if (!row?.goal_run_id)
      return failure("RUN_NOT_FOUND", "The CALL-E run was not found.", 404);
    const stored = JSON.parse(row.request_payload) as StoredPreview;
    const completed = await e.DB.prepare(
      "SELECT id FROM audit_events WHERE entity_id = ? LIMIT 1",
    )
      .bind(evidenceEntity(row.id))
      .first();
    if (
      row.goal_error ||
      (row.goal_result &&
        (completed || stored.schema_version !== "evidence-v2"))
    )
      return Response.json({
        ok: true,
        run_id: row.id,
        status: publicCallStatus(row.status),
        terminal: true,
        result_ready: Boolean(row.goal_result),
        error: publicProviderError(row.goal_error),
      });
    if (row.provider_mode !== config.mode)
      return failure(
        "PROVIDER_CHANGED",
        "Restore the provider used for this call before checking its status.",
        409,
      );
    if (
      !row.goal_result &&
      row.provider_mode !== "fake" &&
      (!config.configured || !config.liveCallsEnabled)
    )
      return failure(
        "LIVE_POLLING_DISABLED",
        "Live CALL-E polling is disabled.",
        409,
      );
    const token = crypto.randomUUID(),
      entity = leaseEntity(row.id),
      started = new Date().toISOString();
    const claim = await e.DB.prepare(
      "INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) SELECT 'CALL_POLL_CLAIMED', ?, ?, 'System', ? WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE entity_id = ? AND id = (SELECT MAX(id) FROM audit_events WHERE entity_id = ?) AND event_type = 'CALL_POLL_CLAIMED' AND created_at > ?)",
    )
      .bind(
        entity,
        token,
        started,
        entity,
        entity,
        new Date(Date.now() - 120000).toISOString(),
      )
      .run();
    if (!claim.meta.changes)
      return Response.json({
        ok: true,
        run_id: row.id,
        status: publicCallStatus(row.status),
        terminal: false,
        result_ready: false,
        checking_elsewhere: true,
      });
    try {
      const latest: Pick<
        GoalRun,
        "status" | "raw" | "result" | "error" | "terminal" | "telephoneRunId"
      > = row.goal_result
        ? {
            status: publicCallStatus(row.status),
            raw: row.response_payload ? JSON.parse(row.response_payload) : null,
            result: JSON.parse(row.goal_result),
            error: null,
            terminal: true,
            telephoneRunId: null,
          }
        : await provider().get(row.goal_id, row.goal_run_id);
      // A failed storage operation can be retried from this saved provider result.
      if (!row.goal_result) {
        const saved = await e.DB.prepare(
          `UPDATE call_runs SET telephone_run_id = COALESCE(?, telephone_run_id), status = ?, response_payload = ?, goal_result = ?, updated_at = ? WHERE id = ? AND goal_result IS NULL AND goal_error IS NULL AND ${leaseGuard(row.id, token)}`,
        )
          .bind(
            latest.telephoneRunId,
            latest.status,
            JSON.stringify(latest.raw),
            latest.result ? JSON.stringify(latest.result) : null,
            new Date().toISOString(),
            row.id,
          )
          .run();
        if (!saved.meta.changes)
          return Response.json({
            ok: true,
            run_id: row.id,
            status: "CHECK_AGAIN",
            terminal: false,
            result_ready: false,
          });
      }
      let ingestion = null;
      if (latest.result) {
        let evidence: EvidenceRecord;
        try {
          evidence = normalizeEvidenceResult(
            latest.result,
            stored.schema_version === "evidence-v2"
              ? "evidence-v2"
              : row.provider_mode === "fake"
                ? "synthetic-legacy"
                : "legacy",
            stored.branches?.map((branch) => branch.id),
          );
          if (
            !evidence.statements.length &&
            !["declined", "human_follow_up", "unresolved", "unknown"].includes(
              evidence.outcome,
            )
          )
            throw new Error("The proposed outcome requires factual evidence.");
        } catch (error) {
          const detail =
            error instanceof Error
              ? error.message
              : "The evidence contract is invalid.";
          await recordGoalError(
            e.DB,
            row.id,
            { code: "invalid_result", message: detail },
            token,
            session,
          );
          return Response.json({
            ok: true,
            run_id: row.id,
            status: "INVALID_RESULT",
            terminal: true,
            result_ready: false,
            error: { message: detail },
          });
        }
        // Database failures are retryable storage failures, not invalid evidence.
        ingestion = await ingestResult(
          e.DB,
          row.id,
          row.provider_mode,
          evidence,
          latest.raw,
          token,
          session,
        );
      } else if (latest.error)
        await recordGoalError(e.DB, row.id, latest.error, token, session);
      return Response.json({
        ok: true,
        run_id: row.id,
        status: latest.status,
        terminal: latest.terminal,
        result_ready: latest.result !== null,
        error: latest.error,
        ingestion,
      });
    } catch {
      return failure(
        "STATUS_CHECK_FAILED",
        "The result could not be checked or saved. Resume checking this same interview; do not place another call.",
        503,
      );
    } finally {
      await e.DB.prepare(
        `INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) SELECT 'CALL_POLL_RELEASED', ?, ?, 'System', ? WHERE ${leaseGuard(row.id, token)}`,
      )
        .bind(entity, token, new Date().toISOString())
        .run();
    }
  }
  return failure(
    "UNKNOWN_ACTION",
    "The requested CALL-E Goal workflow action is not supported.",
    400,
  );
}

export const GET = privateRoute(getHandler);
export const POST = privateRoute(postHandler);
