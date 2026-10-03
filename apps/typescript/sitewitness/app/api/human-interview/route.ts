import { privateRoute } from "../../lib/private-route";
import { initializeCase } from "../workflow/route";
import { env } from "cloudflare:workers";

type Interview = {
  task_id?: string; interviewer?: string; method?: string; interview_date?: string;
  respondent_name?: string; respondent_role?: string; knowledge_start?: string; knowledge_end?: string;
  operations_answer?: string; operations_source?: string; operations_confidence?: string;
  storage_answer?: string; storage_source?: string; storage_confidence?: string;
  limitations?: string; declined_notes?: string; confirmed?: boolean;
};

async function ensureSchema() {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, entity_id TEXT NOT NULL, detail TEXT NOT NULL, actor TEXT NOT NULL DEFAULT 'System', created_at TEXT NOT NULL)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS human_interview_records (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL UNIQUE, interviewer TEXT NOT NULL, method TEXT NOT NULL, interview_date TEXT NOT NULL, respondent_name TEXT NOT NULL, respondent_role TEXT NOT NULL, knowledge_start TEXT NOT NULL, knowledge_end TEXT NOT NULL, answers TEXT NOT NULL, limitations TEXT NOT NULL, declined_notes TEXT NOT NULL, confirmed INTEGER NOT NULL, submitted_at TEXT NOT NULL)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS ingested_statements (id TEXT PRIMARY KEY, evidence_gap_id TEXT NOT NULL, origin TEXT NOT NULL, fact TEXT NOT NULL, source TEXT NOT NULL, certainty TEXT NOT NULL, evidence TEXT NOT NULL, limitations TEXT NOT NULL, created_at TEXT NOT NULL)").run();
}

async function getHandler(request: Request) {
  await ensureSchema();
  const session = await initializeCase();
  const id = new URL(request.url).searchParams.get("task_id");
  const task = id ? await env.DB.prepare("SELECT id, summary, status, assignee, due_at FROM follow_up_tasks WHERE evidence_gap_id = ? AND id = ? AND channel = 'human_interview'").bind(session.caseId, id).first() : null;
  if (!task) return Response.json({ error: "This human interview task is unavailable." }, { status: 404 });
  const record = await env.DB.prepare("SELECT submitted_at FROM human_interview_records WHERE task_id = ?").bind(task.id).first();
  if (!record && task.status === "SCHEDULED") {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE follow_up_tasks SET status = 'IN_PROGRESS', updated_at = ? WHERE id = ?").bind(now, task.id),
      env.DB.prepare("INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) VALUES ('HUMAN_INTERVIEW_STARTED', ?, '{}', ?, ?)").bind(`TASK-${task.id}`, task.assignee || "Assigned interviewer", now),
    ]);
    task.status = "IN_PROGRESS";
  }
  return Response.json({ task, submitted: Boolean(record), submitted_at: record?.submitted_at || null });
}

async function postHandler(request: Request) {
  await ensureSchema();
  const session = await initializeCase();
  if (request.headers.get("x-demo-role") !== "coordinator")
    return Response.json({ error: "Coordinator permission is required." }, { status: 403 });
  let body: Interview;
  try { body = (await request.json()) as Interview; }
  catch { return Response.json({ error: "A valid interview record is required." }, { status: 400 }); }
  const task = body.task_id ? await env.DB.prepare("SELECT id, status FROM follow_up_tasks WHERE evidence_gap_id = ? AND id = ? AND channel = 'human_interview'").bind(session.caseId, body.task_id).first<{ id: number; status: string }>() : null;
  if (!task) return Response.json({ error: "This human interview task is unavailable." }, { status: 404 });
  if (!["SCHEDULED", "IN_PROGRESS"].includes(task.status)) return Response.json({ error: "This request is not open for a response." }, { status: 409 });
  if (!body.interviewer?.trim() || !body.method || !body.interview_date || !body.respondent_name?.trim() || !body.respondent_role?.trim() || !body.knowledge_start || !body.knowledge_end)
    return Response.json({ error: "Interview, respondent, and knowledge-period details are required." }, { status: 422 });
  if (!body.operations_answer?.trim() || !body.storage_answer?.trim() || !body.operations_source || !body.storage_source)
    return Response.json({ error: "Record each scoped answer and its source basis." }, { status: 422 });
  if (!body.confirmed) return Response.json({ error: "The interviewer confirmation is required." }, { status: 422 });
  const now = new Date().toISOString();
  const limitation = [body.limitations, body.declined_notes].filter(Boolean).join("; ");
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO human_interview_records (task_id, interviewer, method, interview_date, respondent_name, respondent_role, knowledge_start, knowledge_end, answers, limitations, declined_notes, confirmed, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)").bind(
        task.id, body.interviewer.trim(), body.method, body.interview_date, body.respondent_name.trim(), body.respondent_role.trim(), body.knowledge_start, body.knowledge_end,
        JSON.stringify([{ question: "Operations before 1991", answer: body.operations_answer.trim(), source: body.operations_source, confidence: body.operations_confidence }, { question: "Rear storage room use", answer: body.storage_answer.trim(), source: body.storage_source, confidence: body.storage_confidence }]),
        body.limitations?.trim() || "", body.declined_notes?.trim() || "", now,
      ),
      env.DB.prepare("INSERT INTO ingested_statements (id, evidence_gap_id, origin, fact, source, certainty, evidence, limitations, created_at) VALUES (?, ?, 'human_interview', ?, ?, ?, ?, ?, ?)").bind(`HUMAN-${task.id}-01`, session.caseId, `${body.respondent_name.trim()} stated in a human-led interview regarding operations before 1991: ${body.operations_answer.trim()}`, body.operations_source, body.operations_confidence || "Uncertain", body.operations_answer.trim(), limitation, now),
      env.DB.prepare("INSERT INTO ingested_statements (id, evidence_gap_id, origin, fact, source, certainty, evidence, limitations, created_at) VALUES (?, ?, 'human_interview', ?, ?, ?, ?, ?, ?)").bind(`HUMAN-${task.id}-02`, session.caseId, `${body.respondent_name.trim()} stated in a human-led interview regarding the rear storage room: ${body.storage_answer.trim()}`, body.storage_source, body.storage_confidence || "Uncertain", body.storage_answer.trim(), limitation, now),
      env.DB.prepare("UPDATE follow_up_tasks SET status = 'SUBMITTED' WHERE id = ?").bind(task.id),
      env.DB.prepare("UPDATE case_workflow SET status = 'AWAITING_EP_REVIEW', assigned_role = 'reviewer', next_action = 'Review the submitted human-interview evidence and save a human disposition.', updated_at = ? WHERE evidence_gap_id = ?").bind(now, session.caseId),
      env.DB.prepare("INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) VALUES ('HUMAN_INTERVIEW_SUBMITTED', ?, ?, ?, ?)").bind(`TASK-${task.id}`, JSON.stringify({ method: body.method, statements_created: 2 }), body.interviewer.trim(), now),
    ]);
  } catch { return Response.json({ error: "This interview has already been submitted." }, { status: 409 }); }
  return Response.json({ ok: true, submitted_at: now, statements_created: 2, workflow_status: "AWAITING_EP_REVIEW" }, { status: 201 });
}

export const GET = privateRoute(getHandler);
export const POST = privateRoute(postHandler);
