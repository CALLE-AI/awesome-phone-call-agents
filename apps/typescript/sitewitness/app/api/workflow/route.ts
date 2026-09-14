import { privateRoute } from "../../lib/private-route";
import { publicCallStatus, publicProviderError, redactText } from "../../lib/output-privacy";
import { resolvePrivateQuote } from "../../lib/private-quote";
import { env } from "cloudflare:workers";
import {
  readDemoSession,
  sessionMismatch,
  staleDemoResponse,
  type DemoSession,
} from "../../lib/demo-session";
import {
  applyReviews,
  citeQuote,
  extractTranscript,
  evidenceIsVisible,
  type IngestedStatement,
  type ReviewAction,
} from "../../lib/evidence";
import { readCaseFile } from "../../lib/case-file-store";
import { readCoverage } from "../../lib/case-coverage";
const dispositions = new Set([
  "PARTIALLY_RESOLVED",
  "REMAINS_UNRESOLVED",
  "HUMAN_INTERVIEW_REQUIRED",
  "ADDITIONAL_RECORD_REQUIRED",
  "RESOLVED_BY_REVIEWER",
]);
const reviewStates = new Set(["accepted", "rejected", "follow_up"]);
type Body = {
  action?: string;
  statement_id?: string;
  status?: string;
  expected_revision?: number;
  fact?: string;
  evidence_quote?: string;
  source?: string;
  certainty?: string;
  limitations?: string[];
  note?: string;
  disposition?: string;
  rationale?: string;
  channel?: string;
  summary?: string;
  task_id?: string;
  assignee?: string;
  due_at?: string;
  reason?: string;
  assignee_name?: string;
};
const initialCaseStatus = "NEEDS_OUTREACH";
const error = (code: string, message: string, status = 422) =>
  Response.json({ error: { code, message } }, { status });
async function ensureSchema() {
  const db = env.DB;
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS review_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, statement_id TEXT NOT NULL, action TEXT NOT NULL, expected_revision INTEGER NOT NULL, payload TEXT NOT NULL, reviewer_role TEXT NOT NULL, created_at TEXT NOT NULL)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_review_actions_statement_id ON review_actions(statement_id)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS evidence_gap_dispositions (id INTEGER PRIMARY KEY AUTOINCREMENT, evidence_gap_id TEXT NOT NULL, disposition TEXT NOT NULL, rationale TEXT NOT NULL, reviewer_role TEXT NOT NULL, created_at TEXT NOT NULL)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_dispositions_gap_id ON evidence_gap_dispositions(evidence_gap_id)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS follow_up_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, evidence_gap_id TEXT NOT NULL, channel TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_gap_id ON follow_up_tasks(evidence_gap_id)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS case_workflow (evidence_gap_id TEXT PRIMARY KEY, status TEXT NOT NULL, assigned_role TEXT NOT NULL, next_action TEXT NOT NULL, updated_at TEXT NOT NULL)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS secure_form_responses (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL UNIQUE, respondent_name TEXT NOT NULL, respondent_role TEXT NOT NULL, knowledge_start TEXT NOT NULL, knowledge_end TEXT NOT NULL, answers TEXT NOT NULL, limitations TEXT NOT NULL, acknowledged INTEGER NOT NULL, submitted_at TEXT NOT NULL)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS ingested_statements (id TEXT PRIMARY KEY, evidence_gap_id TEXT NOT NULL, origin TEXT NOT NULL, fact TEXT NOT NULL, source TEXT NOT NULL, certainty TEXT NOT NULL, evidence TEXT NOT NULL, limitations TEXT NOT NULL, created_at TEXT NOT NULL)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_ingested_statements_gap_id ON ingested_statements(evidence_gap_id)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS human_interview_records (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL UNIQUE, interviewer TEXT NOT NULL, method TEXT NOT NULL, interview_date TEXT NOT NULL, respondent_name TEXT NOT NULL, respondent_role TEXT NOT NULL, knowledge_start TEXT NOT NULL, knowledge_end TEXT NOT NULL, answers TEXT NOT NULL, limitations TEXT NOT NULL, declined_notes TEXT NOT NULL, confirmed INTEGER NOT NULL, submitted_at TEXT NOT NULL)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, entity_id TEXT NOT NULL, detail TEXT NOT NULL, actor TEXT NOT NULL DEFAULT 'System', created_at TEXT NOT NULL)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS call_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, interview_id TEXT NOT NULL, authorization_version INTEGER NOT NULL, provider_mode TEXT NOT NULL, provider_call_id TEXT, goal_id TEXT, goal_run_id TEXT, telephone_run_id TEXT, run_spec_id TEXT, run_spec_version INTEGER, variables_fingerprint TEXT, status TEXT NOT NULL, request_payload TEXT NOT NULL, response_payload TEXT, goal_result TEXT, goal_error TEXT, live_call_budget_reserved_at TEXT, preview_confirmed_at TEXT, launched_at TEXT, updated_at TEXT NOT NULL, UNIQUE(interview_id, authorization_version))",
    ),
  ]);
  const columns = await db
    .prepare("PRAGMA table_info(follow_up_tasks)")
    .all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  if (!names.has("assignee"))
    await db
      .prepare("ALTER TABLE follow_up_tasks ADD COLUMN assignee TEXT")
      .run();
  if (!names.has("due_at"))
    await db
      .prepare("ALTER TABLE follow_up_tasks ADD COLUMN due_at TEXT")
      .run();
  if (!names.has("response_token"))
    await db
      .prepare("ALTER TABLE follow_up_tasks ADD COLUMN response_token TEXT")
      .run();
  if (!names.has("updated_at"))
    await db
      .prepare("ALTER TABLE follow_up_tasks ADD COLUMN updated_at TEXT")
      .run();
  if (!names.has("attempt_count"))
    await db
      .prepare(
        "ALTER TABLE follow_up_tasks ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0",
      )
      .run();
  if (!names.has("cancel_reason"))
    await db
      .prepare("ALTER TABLE follow_up_tasks ADD COLUMN cancel_reason TEXT")
      .run();
  if (!names.has("sent_at"))
    await db
      .prepare("ALTER TABLE follow_up_tasks ADD COLUMN sent_at TEXT")
      .run();
  if (!names.has("viewed_at"))
    await db
      .prepare("ALTER TABLE follow_up_tasks ADD COLUMN viewed_at TEXT")
      .run();
  const auditColumns = await db
    .prepare("PRAGMA table_info(audit_events)")
    .all<{ name: string }>();
  if (!auditColumns.results.some((column) => column.name === "actor"))
    await db
      .prepare(
        "ALTER TABLE audit_events ADD COLUMN actor TEXT NOT NULL DEFAULT 'System'",
      )
      .run();
  await db.batch([
    db.prepare(
      "UPDATE follow_up_tasks SET status = 'READY', updated_at = COALESCE(updated_at, created_at) WHERE status = 'OPEN' AND channel = 'secure_form'",
    ),
    db.prepare(
      "UPDATE follow_up_tasks SET status = 'SCHEDULED', updated_at = COALESCE(updated_at, created_at) WHERE status = 'OPEN' AND channel = 'human_interview'",
    ),
  ]);
}
export async function initializeCase() {
  await ensureSchema();
  const db = env.DB;
  const session = await readDemoSession(db);
  await db
    .prepare(
      "INSERT OR IGNORE INTO case_workflow (evidence_gap_id, status, assigned_role, next_action, updated_at) VALUES (?, ?, 'coordinator', 'Select an interview channel and prepare outreach.', ?)",
    )
    .bind(session.caseId, initialCaseStatus, new Date().toISOString())
    .run();
  return session;
}
async function getHandler(request: Request) {
  return Response.json(await readWorkflow(await initializeCase()));
}
export async function readWorkflow(session: DemoSession) {
  const [
    reviews,
    dispositionsResult,
    tasksResult,
    workflow,
    ingestedStatements,
    audit,
    latestCall,
  ] = await Promise.all([
    env.DB.prepare(
      "SELECT id, statement_id, action, expected_revision, payload, reviewer_role, created_at FROM review_actions WHERE statement_id IN (SELECT id FROM ingested_statements WHERE evidence_gap_id = ?) ORDER BY id DESC",
    )
      .bind(session.caseId)
      .all<ReviewAction>(),
    env.DB.prepare(
      "SELECT id, evidence_gap_id, disposition, rationale, reviewer_role, created_at FROM evidence_gap_dispositions WHERE evidence_gap_id = ? ORDER BY id DESC LIMIT 20",
    )
      .bind(session.caseId)
      .all(),
    env.DB.prepare(
      "SELECT id, channel, summary, status, assignee, due_at, response_token, attempt_count, cancel_reason, sent_at, viewed_at, updated_at, created_at FROM follow_up_tasks WHERE evidence_gap_id = ? ORDER BY id DESC LIMIT 20",
    )
      .bind(session.caseId)
      .all(),
    env.DB.prepare(
      "SELECT evidence_gap_id, status, assigned_role, next_action, updated_at FROM case_workflow WHERE evidence_gap_id = ?",
    )
      .bind(session.caseId)
      .first(),
    env.DB.prepare(
      "SELECT id, origin, fact, source, certainty, evidence, limitations, created_at FROM ingested_statements WHERE evidence_gap_id = ? ORDER BY created_at, id",
    )
      .bind(session.caseId)
      .all<IngestedStatement>(),
    env.DB.prepare(
      "SELECT id, event_type, entity_id, detail, actor, created_at FROM audit_events WHERE entity_id = ? OR substr(entity_id, 1, ?) = ? OR entity_id IN (SELECT 'TASK-' || id FROM follow_up_tasks WHERE evidence_gap_id = ?) ORDER BY id DESC LIMIT 100",
    )
      .bind(
        session.caseId,
        session.caseId.length + 1,
        `${session.caseId}:`,
        session.caseId,
      )
      .all(),
    env.DB.prepare(
      "SELECT id, goal_run_id, status, goal_result, goal_error, response_payload, updated_at FROM call_runs WHERE interview_id = ? AND provider_mode IN ('calle_goal','calle_calls') AND goal_run_id IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
      .bind(session.interviewId)
      .first<{
        id: number;
        goal_run_id: string;
        status: string;
        goal_result: string | null;
        goal_error: string | null;
        response_payload: string | null;
        updated_at: string;
      }>(),
  ]);
  let latestTranscript: Array<{
    speaker: string;
    text: string;
    offset_seconds?: number;
  }> = [];
  if (latestCall?.response_payload) {
    try {
      const payload = JSON.parse(latestCall.response_payload) as {
        recipients?: Array<{
          attempts?: Array<{
            transcript_turns?: Array<{
              speaker?: string;
              text?: string;
              offset_seconds?: number;
            }>;
          }>;
        }>;
      };
      latestTranscript = (payload.recipients || [])
        .flatMap((recipient) => recipient.attempts || [])
        .flatMap((attempt) => attempt.transcript_turns || [])
        .filter((turn) => typeof turn.text === "string")
        .map((turn) => ({
          speaker: turn.speaker === "bot" ? "SiteWitness" : "Respondent",
          text: turn.text!,
          offset_seconds: turn.offset_seconds,
        }));
    } catch {
      latestTranscript = [];
    }
  }
  return {
    session,
    reviews: reviews.results,
    dispositions: dispositionsResult.results,
    tasks: tasksResult.results,
    workflow,
    ingested_statements: ingestedStatements.results,
    audit: audit.results,
    latest_call: latestCall
      ? {
          id: latestCall.id,
          status: publicCallStatus(latestCall.status),
          terminal:
            Boolean(latestCall.goal_result || latestCall.goal_error) ||
            [
              "COMPLETED",
              "FAILED",
              "CANCELED",
              "CANCELLED",
              "INVALID_RESULT",
            ].includes(latestCall.status),
          goal_error: latestCall.goal_error ? JSON.stringify(publicProviderError(latestCall.goal_error)) : null,
          updated_at: latestCall.updated_at,
        }
      : null,
    latest_transcript: latestTranscript,
  };
}
async function postHandler(request: Request) {
  const session = await initializeCase();
  if (sessionMismatch(request, session)) return staleDemoResponse();
  const role = request.headers.get("x-demo-role");
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return error("INVALID_REQUEST", "A JSON request body is required.", 400);
  }
  const now = new Date().toISOString();
  if (body.action === "reset" && role === "demo_admin") {
    return error(
      "LIVE_HISTORY_PRESERVED",
      "Live case history is retained. Reloading does not erase interviews or call reservations.",
      409,
    );
  }
  if (body.action === "clear_follow_up" && role === "demo_admin") {
    await env.DB.prepare(
      "DELETE FROM follow_up_tasks WHERE evidence_gap_id = ?",
    )
      .bind(session.caseId)
      .run();
    return Response.json({ ok: true, cleared: true });
  }
  if (body.action === "follow_up" || body.action === "update_follow_up") {
    if (role !== "coordinator")
      return error(
        "PERMISSION_DENIED",
        "Coordinator permission is required to administer follow-up.",
        403,
      );
    if (body.action === "update_follow_up")
      return error("INVALID_TASK_UPDATE", "Use a specific lifecycle action.");
    if (
      !body.channel ||
      !["secure_form", "human_interview"].includes(body.channel) ||
      !body.summary ||
      body.summary.trim().length < 20
    )
      return error(
        "INVALID_FOLLOW_UP",
        "A supported channel and specific follow-up summary are required.",
      );
    const duplicate = await env.DB.prepare(
      "SELECT id FROM follow_up_tasks WHERE evidence_gap_id = ? AND channel = ? AND status NOT IN ('SUBMITTED','CANCELLED','DECLINED','EXPIRED')",
    )
      .bind(session.caseId, body.channel)
      .first();
    if (duplicate)
      return error(
        "DUPLICATE_ACTIVE_REQUEST",
        "An active request already exists for this channel.",
        409,
      );
    const token =
      body.channel === "secure_form" ? `sw-${crypto.randomUUID()}` : null;
    const taskStatus = body.channel === "secure_form" ? "READY" : "SCHEDULED";
    const result = await env.DB.prepare(
      "INSERT INTO follow_up_tasks (evidence_gap_id, channel, summary, status, assignee, due_at, response_token, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
      .bind(
        session.caseId,
        body.channel,
        body.summary.trim(),
        taskStatus,
        body.assignee || "Case coordinator",
        body.due_at || null,
        token,
        now,
        now,
      )
      .first<{ id: number }>();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE case_workflow SET status = 'OUTREACH_PREPARED', assigned_role = 'coordinator', next_action = 'Send the written request or conduct the scheduled human interview.', updated_at = ? WHERE evidence_gap_id = ?",
      ).bind(now, session.caseId),
      env.DB.prepare(
        "INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) VALUES ('FOLLOW_UP_CREATED', ?, ?, 'Case coordinator', ?)",
      ).bind(
        `TASK-${result?.id}`,
        JSON.stringify({
          channel: body.channel,
          status: taskStatus,
          assignee: body.assignee,
        }),
        now,
      ),
    ]);
    return Response.json(
      {
        ok: true,
        task: {
          id: String(result?.id || now),
          channel: body.channel,
          summary: body.summary.trim(),
          status: taskStatus,
          assignee: body.assignee || "Case coordinator",
          due_at: body.due_at,
          response_token: token,
          attempt_count: 0,
          updated_at: now,
          created_at: now,
        },
      },
      { status: 201 },
    );
  }
  if (
    [
      "send_request",
      "record_attempt",
      "extend_due",
      "cancel_request",
      "reopen_request",
      "reassign_request",
      "decline_request",
      "expire_request",
    ].includes(body.action || "")
  ) {
    if (role !== "coordinator")
      return error(
        "PERMISSION_DENIED",
        "Coordinator permission is required.",
        403,
      );
    if (!body.task_id)
      return error("TASK_REQUIRED", "Choose a follow-up task.");
    const task = await env.DB.prepare(
      "SELECT id, channel, status, assignee, due_at, attempt_count FROM follow_up_tasks WHERE evidence_gap_id = ? AND id = ?",
    )
      .bind(session.caseId, body.task_id)
      .first<{
        id: number;
        channel: string;
        status: string;
        assignee: string;
        due_at: string;
        attempt_count: number;
      }>();
    if (!task)
      return error("TASK_NOT_FOUND", "The follow-up task was not found.", 404);
    const terminal = ["SUBMITTED", "CANCELLED", "DECLINED", "EXPIRED"].includes(
      task.status,
    );
    let status = task.status;
    let assignee = task.assignee;
    let dueAt = task.due_at;
    let attempts = task.attempt_count || 0;
    let cancelReason: string | null = null;
    let sentAt: string | null = null;
    if (body.action === "send_request") {
      if (
        task.channel !== "secure_form" ||
        !["READY", "SENT"].includes(task.status)
      )
        return error(
          "INVALID_TRANSITION",
          "Only a ready secure form can be sent.",
          409,
        );
      status = "SENT";
      sentAt = now;
    } else if (body.action === "record_attempt") {
      if (terminal)
        return error(
          "INVALID_TRANSITION",
          "Contact attempts cannot be added to a closed request.",
          409,
        );
      attempts += 1;
    } else if (body.action === "extend_due") {
      if (terminal || !body.due_at)
        return error(
          "INVALID_TRANSITION",
          "An active request and new due date are required.",
          409,
        );
      dueAt = body.due_at;
    } else if (body.action === "reassign_request") {
      if (terminal || !body.assignee_name?.trim())
        return error(
          "INVALID_TRANSITION",
          "An active request and assignee are required.",
          409,
        );
      assignee = body.assignee_name.trim();
    } else if (body.action === "cancel_request") {
      if (terminal || !body.reason?.trim())
        return error(
          "INVALID_TRANSITION",
          "An active request and cancellation reason are required.",
          409,
        );
      status = "CANCELLED";
      cancelReason = body.reason.trim();
    } else if (body.action === "decline_request") {
      if (terminal || !body.reason?.trim())
        return error(
          "INVALID_TRANSITION",
          "An active request and decline reason are required.",
          409,
        );
      status = "DECLINED";
      cancelReason = body.reason.trim();
    } else if (body.action === "expire_request") {
      if (terminal)
        return error(
          "INVALID_TRANSITION",
          "This request is already closed.",
          409,
        );
      status = "EXPIRED";
    } else if (body.action === "reopen_request") {
      if (!["CANCELLED", "DECLINED", "EXPIRED"].includes(task.status))
        return error(
          "INVALID_TRANSITION",
          "Only a cancelled, declined, or expired request can be reopened.",
          409,
        );
      status = task.channel === "secure_form" ? "READY" : "SCHEDULED";
    }
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE follow_up_tasks SET status = ?, assignee = ?, due_at = ?, attempt_count = ?, cancel_reason = ?, sent_at = COALESCE(?, sent_at), updated_at = ? WHERE id = ?",
      ).bind(
        status,
        assignee,
        dueAt,
        attempts,
        cancelReason,
        sentAt,
        now,
        task.id,
      ),
      env.DB.prepare(
        "INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) VALUES (?, ?, ?, 'Case coordinator', ?)",
      ).bind(
        (body.action || "").toUpperCase(),
        `TASK-${task.id}`,
        JSON.stringify({
          from: task.status,
          to: status,
          assignee,
          due_at: dueAt,
          attempt_count: attempts,
          reason: body.reason || null,
        }),
        now,
      ),
    ]);
    if (body.action === "send_request")
      await env.DB.prepare(
        "UPDATE case_workflow SET status = 'AWAITING_RESPONSE', assigned_role = 'coordinator', next_action = 'Monitor the written request for respondent activity and submission.', updated_at = ? WHERE evidence_gap_id = ?",
      )
        .bind(now, session.caseId)
        .run();
    if (
      ["cancel_request", "decline_request", "expire_request"].includes(
        body.action || "",
      )
    )
      await env.DB.prepare(
        "UPDATE case_workflow SET status = 'FOLLOW_UP_REQUIRED', assigned_role = 'coordinator', next_action = 'Choose whether to reopen this request or select another follow-up channel.', updated_at = ? WHERE evidence_gap_id = ?",
      )
        .bind(now, session.caseId)
        .run();
    return Response.json({
      ok: true,
      task: {
        ...task,
        status,
        assignee,
        due_at: dueAt,
        attempt_count: attempts,
        cancel_reason: cancelReason,
        sent_at: sentAt,
        updated_at: now,
      },
    });
  }
  if (
    body.action === "start_interview" ||
    body.action === "start_fake_interview" ||
    body.action === "complete_fake_interview"
  ) {
    if (role !== "coordinator")
      return error(
        "PERMISSION_DENIED",
        "Coordinator permission is required to complete interview operations.",
        403,
      );
    const completed = body.action === "complete_fake_interview";
    const status = completed ? "AWAITING_EP_REVIEW" : "INTERVIEW_IN_PROGRESS";
    const assignedRole = completed ? "reviewer" : "coordinator";
    const nextAction = completed
      ? "Review the returned evidence and save a human disposition."
      : "Monitor the interview through completion.";
    await env.DB.prepare(
      "UPDATE case_workflow SET status = ?, assigned_role = ?, next_action = ?, updated_at = ? WHERE evidence_gap_id = ?",
    )
      .bind(status, assignedRole, nextAction, now, session.caseId)
      .run();
    return Response.json({
      ok: true,
      status,
      assigned_role: assignedRole,
      next_action: nextAction,
      updated_at: now,
    });
  }
  if (role !== "reviewer")
    return error(
      "PERMISSION_DENIED",
      "Environmental Professional Reviewer permission is required.",
      403,
    );
  if (["review", "edit", "disposition"].includes(body.action || "")) {
    const current = await env.DB.prepare(
      "SELECT assigned_role FROM case_workflow WHERE evidence_gap_id = ?",
    )
      .bind(session.caseId)
      .first<{ assigned_role: string }>();
    if (current?.assigned_role !== "reviewer")
      return error(
        "CASE_NOT_ASSIGNED",
        "This case is not currently assigned to EP review.",
        409,
      );
  }
  let currentStatement: ReturnType<typeof applyReviews>[number] | undefined;
  if (body.action === "review" || body.action === "edit") {
    const source = await env.DB.prepare(
      "SELECT * FROM ingested_statements WHERE id = ? AND evidence_gap_id = ?",
    )
      .bind(body.statement_id || "", session.caseId)
      .first<IngestedStatement>();
    if (!source)
      return error(
        "STATEMENT_NOT_FOUND",
        "Review a statement actually returned for this case.",
        404,
      );
    const actions = await env.DB.prepare(
      "SELECT * FROM review_actions WHERE statement_id = ? ORDER BY id",
    )
      .bind(source.id)
      .all<ReviewAction>();
    currentStatement = applyReviews([source], actions.results)[0];
    if (body.expected_revision !== currentStatement.revision)
      return error(
        "REVISION_CHANGED",
        "The statement changed. Refresh before reviewing it.",
        409,
      );
    if (
      body.action === "review" &&
      body.status === "accepted" &&
      ["calle_calls", "calle_goal", "fake"].includes(source.origin)
    ) {
      const runId = source.id.match(/^CALLE-GOAL-(\d+)-/)?.[1];
      const run = runId
        ? await env.DB.prepare(
            "SELECT response_payload FROM call_runs WHERE id = ?",
          )
            .bind(runId)
            .first<{ response_payload: string }>()
        : null;
      let raw = null;
      try {
        raw = run ? JSON.parse(run.response_payload) : null;
      } catch {
        /* unavailable original */
      }
      if (
        citeQuote(
          currentStatement.evidence,
          extractTranscript(raw, Number(runId)),
        ).status !== "matched"
      )
        return error(
          "QUOTE_NOT_VERIFIED",
          "The supporting quote must match one respondent turn before acceptance.",
          409,
        );
    }
  }
  if (body.action === "review") {
    if (!body.statement_id || !body.status || !reviewStates.has(body.status))
      return error(
        "INVALID_REVIEW_ACTION",
        "Choose accept, reject, or follow up.",
      );
    if (body.statement_id === "STMT-006" && body.status === "accepted")
      return error(
        "BLOCKING_WARNING_PRESENT",
        "The prohibited environmental conclusion cannot be accepted.",
        409,
      );
    const written = await env.DB.prepare(
      "INSERT INTO review_actions (statement_id, action, expected_revision, payload, reviewer_role, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE 1 + (SELECT COUNT(*) FROM review_actions WHERE statement_id = ? AND action = 'edit') = ? RETURNING id",
    )
      .bind(
        body.statement_id,
        body.status,
        body.expected_revision || 1,
        JSON.stringify({ note: body.note || "" }),
        role,
        now,
        body.statement_id,
        body.expected_revision,
      )
      .first();
    if (!written)
      return error(
        "REVISION_CHANGED",
        "The statement changed. Refresh before reviewing it.",
        409,
      );
    await env.DB.prepare(
      "INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) VALUES ('STATEMENT_REVIEWED', ?, ?, 'EP Reviewer', ?)",
    )
      .bind(
        session.caseId,
        JSON.stringify({
          statement_id: body.statement_id,
          action: body.status,
        }),
        now,
      )
      .run();
    return Response.json(
      { ok: true, status: body.status, created_at: now },
      { status: 201 },
    );
  }
  if (body.action === "edit") {
    const secrets = [String(env.CALLE_API_KEY || ""), String(env.SITEWITNESS_BASIC_PASSWORD || "")];
    if (currentStatement && body.evidence_quote === redactText(currentStatement.evidence, secrets))
      body.evidence_quote = currentStatement.evidence;
    if (
      body.evidence_quote !== undefined &&
      body.evidence_quote !== currentStatement?.evidence
    ) {
      const runId = body.statement_id?.match(/^CALLE-GOAL-(\d+)-/)?.[1];
      const run = runId
        ? await env.DB.prepare(
            "SELECT response_payload FROM call_runs WHERE id = ? AND interview_id = ?",
          )
            .bind(runId, session.interviewId)
            .first<{ response_payload: string }>()
        : null;
      if (run && typeof body.evidence_quote === "string") {
        const original = resolvePrivateQuote(body.evidence_quote,
          extractTranscript(JSON.parse(run.response_payload || "{}"), Number(runId)), "", [], secrets);
        if (original === null) return error("QUOTE_NOT_VERIFIED", "Choose one unambiguous original respondent quotation.", 409);
        body.evidence_quote = original;
      }
      if (
        typeof body.evidence_quote !== "string" ||
        body.evidence_quote.length > 2000 ||
        !run ||
        citeQuote(
          body.evidence_quote,
          extractTranscript(
            JSON.parse(run.response_payload || "{}"),
            Number(runId),
          ),
        ).status !== "matched"
      )
        return error(
          "QUOTE_NOT_VERIFIED",
          "Use a longer exact quotation from one respondent turn. Original provider evidence remains in the audit history.",
          409,
        );
    }
    if (
      !body.statement_id ||
      !body.fact ||
      body.fact.trim().length < 12 ||
      !body.note ||
      body.note.trim().length < 5
    )
      return error(
        "INVALID_EDIT",
        "Supported wording and a reviewer note are required.",
      );
    if (
      /\b(clean property|no environmental concern|recognized environmental condition|phase ii)\b/i.test(
        body.fact,
      )
    )
      return error(
        "PROFESSIONAL_CONCLUSION_PROHIBITED",
        "The edited statement contains a prohibited professional conclusion.",
        409,
      );
    const written = await env.DB.prepare(
      "INSERT INTO review_actions (statement_id, action, expected_revision, payload, reviewer_role, created_at) SELECT ?, 'edit', ?, ?, ?, ? WHERE 1 + (SELECT COUNT(*) FROM review_actions WHERE statement_id = ? AND action = 'edit') = ? RETURNING id",
    )
      .bind(
        body.statement_id,
        body.expected_revision || 1,
        JSON.stringify({
          fact: body.fact,
          evidence: body.evidence_quote,
          source: body.source,
          certainty: body.certainty,
          limitations: body.limitations || [],
          note: body.note,
        }),
        role,
        now,
        body.statement_id,
        body.expected_revision,
      )
      .first();
    if (!written)
      return error(
        "REVISION_CHANGED",
        "The statement changed. Refresh before reviewing it.",
        409,
      );
    await env.DB.prepare(
      "INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) VALUES ('STATEMENT_EDITED', ?, ?, 'EP Reviewer', ?)",
    )
      .bind(
        session.caseId,
        JSON.stringify({ statement_id: body.statement_id }),
        now,
      )
      .run();
    return Response.json(
      { ok: true, status: "edited", created_at: now },
      { status: 201 },
    );
  }
  if (body.action === "disposition") {
    if (
      !body.disposition ||
      !dispositions.has(body.disposition) ||
      !body.rationale ||
      body.rationale.trim().length < 20
    )
      return error(
        "INVALID_DISPOSITION",
        "A valid factual disposition and specific rationale are required.",
      );
    const inputs = await env.DB.prepare(
      "SELECT * FROM ingested_statements WHERE evidence_gap_id = ?",
    )
      .bind(session.caseId)
      .all<IngestedStatement>();
    const actions = await env.DB.prepare(
      "SELECT * FROM review_actions ORDER BY id",
    ).all<ReviewAction>();
    const mode =
      (env as unknown as { CALL_PROVIDER?: string }).CALL_PROVIDER || "fake";
    const reviewed = applyReviews(
      inputs.results.filter((item) => evidenceIsVisible(item.origin, mode)),
      actions.results,
    );
    if (reviewed.some((item) => item.status === "pending"))
      return error(
        "REVIEW_INCOMPLETE",
        "Review all pending statements across the case before saving a disposition.",
        409,
      );
    if (body.disposition === "RESOLVED_BY_REVIEWER") {
      const coverage = await readCoverage(env.DB, mode, session);
      if (coverage.missingYears.length)
        return error(
          "OPEN_YEARS_REMAIN",
          "Some research years still lack reviewed interview testimony. Preserve the gap and arrange the next source.",
          409,
        );
      const tasks = await readCaseFile(env.DB, session);
      const outstanding = await env.DB.prepare(
        "SELECT id FROM follow_up_tasks WHERE evidence_gap_id = ? AND status NOT IN ('SUBMITTED','CANCELLED','DECLINED','EXPIRED') LIMIT 1",
      )
        .bind(session.caseId)
        .first();
      if (
        !reviewed.some((item) => item.status === "accepted") ||
        reviewed.some((item) => item.status === "follow_up") ||
        tasks.tasks.some((task) => task.status === "open") ||
        outstanding
      )
        return error(
          "OPEN_WORK_REMAINS",
          "Full resolution requires accepted evidence and no outstanding follow-up work.",
          409,
        );
    }
    await env.DB.prepare(
      "INSERT INTO evidence_gap_dispositions (evidence_gap_id, disposition, rationale, reviewer_role, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(session.caseId, body.disposition, body.rationale.trim(), role, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) VALUES ('DISPOSITION_SAVED', ?, ?, 'EP Reviewer', ?)",
    )
      .bind(
        session.caseId,
        JSON.stringify({
          disposition: body.disposition,
          rationale: body.rationale,
        }),
        now,
      )
      .run();
    const resolved = body.disposition === "RESOLVED_BY_REVIEWER";
    await env.DB.prepare(
      "UPDATE case_workflow SET status = ?, assigned_role = ?, next_action = ?, updated_at = ? WHERE evidence_gap_id = ?",
    )
      .bind(
        resolved ? "RESOLVED" : "FOLLOW_UP_REQUIRED",
        resolved ? "none" : "coordinator",
        resolved
          ? "No further workflow action is required."
          : "Create and manage the follow-up requested by the EP Reviewer.",
        now,
        session.caseId,
      )
      .run();
    return Response.json(
      {
        ok: true,
        evidence_gap_id: session.caseId,
        status: body.disposition,
        created_at: now,
      },
      { status: 201 },
    );
  }
  return error(
    "UNKNOWN_ACTION",
    "The requested workflow action is not supported.",
    400,
  );
}

export const GET = privateRoute(getHandler);
export const POST = privateRoute(postHandler);
