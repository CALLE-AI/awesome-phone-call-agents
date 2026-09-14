import { privateRoute } from "../../lib/private-route";
import { env } from "cloudflare:workers";
import { initializeCase } from "../workflow/route";
import {
  demoSessions,
  pendingDemoCall,
  PENDING_CALL_SQL,
  readDemoSession,
  SESSION_ENTITY,
  sessionGuard,
  sessionMismatch,
  staleDemoResponse,
} from "../../lib/demo-session";

async function getHandler(request: Request) {
  const session = await initializeCase();
  const sessions = await demoSessions(env.DB);
  const pending = await pendingDemoCall(env.DB, session);
  return Response.json({
    session,
    archived: sessions.filter((item) => item.caseId !== session.caseId),
    canRestart: !pending,
  });
}

async function postHandler(request: Request) {
  const session = await initializeCase();
  if (request.headers.get("x-demo-role") !== "coordinator")
    return Response.json(
      { error: { message: "Switch to Coordinator to start a new demo." } },
      { status: 403 },
    );
  if (sessionMismatch(request, session)) return staleDemoResponse();
  let body: { action?: string; expectedCaseId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { message: "A valid restart request is required." } },
      { status: 400 },
    );
  }
  if (
    body.action !== "start_new_demo" ||
    body.expectedCaseId !== session.caseId
  )
    return staleDemoResponse();

  const id = crypto.randomUUID();
  const next = { caseId: `GAP-DRY-${id}`, interviewId: `INT-BAKER-${id}` };
  const now = new Date().toISOString();
  // The pointer switch and the call launch claim both check the same version
  // inside SQLite. Either launch wins (restart is blocked), or restart wins
  // (the old preview cannot dial). Nothing is deleted or renumbered.
  const guard = `${sessionGuard(session)} AND NOT EXISTS (
    SELECT 1 FROM call_runs WHERE interview_id = ? AND ${PENDING_CALL_SQL})`;
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO case_workflow (evidence_gap_id, status, assigned_role, next_action, updated_at)
      SELECT ?, 'NEEDS_OUTREACH', 'coordinator', 'Review the source records, then choose a person to interview.', ? WHERE ${guard}`,
    ).bind(next.caseId, now, session.interviewId),
    env.DB.prepare(
      `INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at)
      SELECT 'DEMO_STARTED', ?, ?, 'Coordinator', ? WHERE ${guard}`,
    ).bind(SESSION_ENTITY, JSON.stringify(next), now, session.interviewId),
  ]);
  if (!results[1].meta.changes) {
    if ((await readDemoSession(env.DB)).caseId !== session.caseId)
      return staleDemoResponse();
    return Response.json(
      {
        error: {
          code: "CALL_STILL_PENDING",
          message:
            "Finish the current call and retrieve its result before starting a new demo. An unconfirmed submission must be resolved using its saved attempt.",
        },
      },
      { status: 409 },
    );
  }
  return Response.json({
    ok: true,
    session: await readDemoSession(env.DB),
    archivedCaseId: session.caseId,
  });
}

export const GET = privateRoute(getHandler);
export const POST = privateRoute(postHandler);
