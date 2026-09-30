import { privateRoute } from "../../lib/private-route";
import { initializeCase } from "../workflow/route";
import { env } from "cloudflare:workers";

type Submission = {
  token?: string;
  name?: string;
  role?: string;
  knowledge_start?: string;
  knowledge_end?: string;
  operations_answer?: string;
  operations_source?: string;
  operations_confidence?: string;
  storage_answer?: string;
  storage_source?: string;
  storage_confidence?: string;
  limitations?: string;
  acknowledged?: boolean;
};

async function ensureResponseSchema() {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, entity_id TEXT NOT NULL, detail TEXT NOT NULL, actor TEXT NOT NULL DEFAULT 'System', created_at TEXT NOT NULL)").run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS secure_form_responses (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL UNIQUE, respondent_name TEXT NOT NULL, respondent_role TEXT NOT NULL, knowledge_start TEXT NOT NULL, knowledge_end TEXT NOT NULL, answers TEXT NOT NULL, limitations TEXT NOT NULL, acknowledged INTEGER NOT NULL, submitted_at TEXT NOT NULL)",
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS ingested_statements (id TEXT PRIMARY KEY, evidence_gap_id TEXT NOT NULL, origin TEXT NOT NULL, fact TEXT NOT NULL, source TEXT NOT NULL, certainty TEXT NOT NULL, evidence TEXT NOT NULL, limitations TEXT NOT NULL, created_at TEXT NOT NULL)",
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ingested_statements_gap_id ON ingested_statements(evidence_gap_id)").run();
}

async function getHandler(request: Request) {
  await ensureResponseSchema();
  const session = await initializeCase();
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return Response.json({ error: "A response token is required." }, { status: 400 });
  const task = await env.DB.prepare(
    "SELECT id, summary, status, due_at FROM follow_up_tasks WHERE evidence_gap_id = ? AND response_token = ? AND channel = 'secure_form'",
  ).bind(session.caseId, token).first();
  if (!task) return Response.json({ error: "This secure request is unavailable." }, { status: 404 });
  const response = await env.DB.prepare(
    "SELECT submitted_at FROM secure_form_responses WHERE task_id = ?",
  ).bind(task.id).first();
  if (!response && task.status === "READY") return Response.json({ error: "This request has not been sent yet." }, { status: 409 });
  if (!response && task.status === "SENT") {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE follow_up_tasks SET status = 'VIEWED', viewed_at = ?, updated_at = ? WHERE id = ?").bind(now, now, task.id),
      env.DB.prepare("INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) VALUES ('REQUEST_VIEWED', ?, '{}', 'Morgan Lee', ?)").bind(`TASK-${task.id}`, now),
    ]);
    task.status = "VIEWED";
  }
  return Response.json({
    request: task,
    submitted: Boolean(response),
    submitted_at: response?.submitted_at || null,
    property: "47 Baker Street",
    organization: "Meridian Environmental",
  });
}

async function postHandler(request: Request) {
  await ensureResponseSchema();
  const session = await initializeCase();
  let body: Submission;
  try { body = (await request.json()) as Submission; }
  catch { return Response.json({ error: "A valid submission is required." }, { status: 400 }); }
  const task = body.token
    ? await env.DB.prepare("SELECT id, status FROM follow_up_tasks WHERE evidence_gap_id = ? AND response_token = ? AND channel = 'secure_form'").bind(session.caseId, body.token).first<{ id: number; status: string }>()
    : null;
  if (!task) return Response.json({ error: "This secure request is unavailable." }, { status: 404 });
  if (!["SENT", "VIEWED"].includes(task.status)) return Response.json({ error: "This request is not open for a response." }, { status: 409 });
  if (!body.name?.trim() || !body.role?.trim() || !body.knowledge_start || !body.knowledge_end)
    return Response.json({ error: "Identity, role, and knowledge period are required." }, { status: 422 });
  if (!body.operations_answer?.trim() || !body.storage_answer?.trim() || !body.operations_source || !body.storage_source)
    return Response.json({ error: "Answer each scoped question and identify the source basis." }, { status: 422 });
  if (!body.acknowledged)
    return Response.json({ error: "Acknowledgement is required before submission." }, { status: 422 });
  const now = new Date().toISOString();
  try {
    const operationsFact = `${body.name.trim()} reported regarding operations before 1991: ${body.operations_answer.trim()}`;
    const storageFact = `${body.name.trim()} reported regarding the rear storage room: ${body.storage_answer.trim()}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO secure_form_responses (task_id, respondent_name, respondent_role, knowledge_start, knowledge_end, answers, limitations, acknowledged, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)").bind(
        task.id, body.name.trim(), body.role.trim(), body.knowledge_start, body.knowledge_end,
        JSON.stringify([
          { question: "Operations before 1991", answer: body.operations_answer.trim(), source: body.operations_source, confidence: body.operations_confidence },
          { question: "Rear storage room use", answer: body.storage_answer.trim(), source: body.storage_source, confidence: body.storage_confidence },
        ]), body.limitations?.trim() || "", now,
      ),
      env.DB.prepare("UPDATE follow_up_tasks SET status = 'SUBMITTED' WHERE id = ?").bind(task.id),
      env.DB.prepare("INSERT INTO ingested_statements (id, evidence_gap_id, origin, fact, source, certainty, evidence, limitations, created_at) VALUES (?, ?, 'secure_form', ?, ?, ?, ?, ?, ?)").bind(`FORM-${task.id}-01`, session.caseId, operationsFact, body.operations_source, body.operations_confidence || "Uncertain", body.operations_answer.trim(), body.limitations?.trim() || "", now),
      env.DB.prepare("INSERT INTO ingested_statements (id, evidence_gap_id, origin, fact, source, certainty, evidence, limitations, created_at) VALUES (?, ?, 'secure_form', ?, ?, ?, ?, ?, ?)").bind(`FORM-${task.id}-02`, session.caseId, storageFact, body.storage_source, body.storage_confidence || "Uncertain", body.storage_answer.trim(), body.limitations?.trim() || "", now),
      env.DB.prepare("UPDATE case_workflow SET status = 'AWAITING_EP_REVIEW', assigned_role = 'reviewer', next_action = 'Review the submitted secure-form evidence and save a human disposition.', updated_at = ? WHERE evidence_gap_id = ?").bind(now, session.caseId),
      env.DB.prepare("INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) VALUES ('SECURE_FORM_SUBMITTED', ?, ?, ?, ?)").bind(`TASK-${task.id}`, JSON.stringify({ statements_created: 2 }), body.name.trim(), now),
    ]);
  } catch {
    return Response.json({ error: "This response has already been submitted." }, { status: 409 });
  }
  return Response.json({ ok: true, submitted_at: now, statements_created: 2, workflow_status: "AWAITING_EP_REVIEW" }, { status: 201 });
}

export const GET = privateRoute(getHandler);
export const POST = privateRoute(postHandler);
