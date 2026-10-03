import { CASE_ID, INTERVIEW_ID } from "./case-file.ts";

export type DemoSession = {
  caseId: string;
  interviewId: string;
  version: number;
  startedAt: string | null;
};

// Existing installations keep their original investigation until the user starts
// a new demo. The append-only audit log is the durable investigation registry.
export const INITIAL_DEMO: DemoSession = {
  caseId: CASE_ID,
  interviewId: INTERVIEW_ID,
  version: 0,
  startedAt: null,
};
export const SESSION_ENTITY = "SITEWITNESS-DEMO-SESSION";
export const SESSION_VERSION_SQL =
  "COALESCE((SELECT MAX(id) FROM audit_events WHERE entity_id = 'SITEWITNESS-DEMO-SESSION' AND event_type = 'DEMO_STARTED'), 0)";

export async function readDemoSession(db: D1Database): Promise<DemoSession> {
  const row = await db
    .prepare(
      "SELECT id, detail, created_at FROM audit_events WHERE entity_id = ? AND event_type = 'DEMO_STARTED' ORDER BY id DESC LIMIT 1",
    )
    .bind(SESSION_ENTITY)
    .first<{ id: number; detail: string; created_at: string }>();
  if (!row) return INITIAL_DEMO;
  const value = JSON.parse(row.detail) as {
    caseId: string;
    interviewId: string;
  };
  return { ...value, version: row.id, startedAt: row.created_at };
}

export function sessionMismatch(request: Request, session: DemoSession) {
  const expected = request.headers.get("x-demo-case");
  // Preserve old clients only for the original case. After the first restart,
  // an explicit identity is required so stale tabs cannot edit new contacts.
  return (
    expected !== session.caseId && !(expected === null && session.version === 0)
  );
}
export const staleDemoResponse = () =>
  Response.json(
    {
      error: {
        code: "DEMO_CHANGED",
        message:
          "A new demo has started. Refresh this page before making changes.",
      },
    },
    { status: 409 },
  );

export function sessionGuard(session: DemoSession) {
  if (!Number.isSafeInteger(session.version) || session.version < 0)
    throw new Error("Invalid demo version.");
  return `${SESSION_VERSION_SQL} = ${session.version}`;
}

// A returned result is not finished until evidence ingestion commits. An
// uncertain submission remains pending even if no provider ID was returned.
export const PENDING_CALL_SQL = `(status = 'DEMO_CALL_STARTING'
  OR (goal_run_id IS NOT NULL AND goal_error IS NULL AND
    (goal_result IS NULL OR (json_extract(request_payload, '$.schema_version') = 'evidence-v2'
      AND NOT EXISTS (SELECT 1 FROM audit_events WHERE entity_id = 'CALL-EVIDENCE-' || call_runs.id))))
  OR (goal_run_id IS NULL AND live_call_budget_reserved_at IS NOT NULL))`;

export async function pendingDemoCall(db: D1Database, session: DemoSession) {
  return db
    .prepare(
      `SELECT id FROM call_runs WHERE interview_id = ? AND ${PENDING_CALL_SQL} LIMIT 1`,
    )
    .bind(session.interviewId)
    .first<{ id: number }>();
}

export async function demoSessions(db: D1Database) {
  const rows = await db
    .prepare(
      "SELECT id, detail, created_at FROM audit_events WHERE entity_id = ? AND event_type = 'DEMO_STARTED' ORDER BY id DESC",
    )
    .bind(SESSION_ENTITY)
    .all<{ id: number; detail: string; created_at: string }>();
  return [
    ...rows.results.map(
      (row) =>
        ({
          ...JSON.parse(row.detail),
          version: row.id,
          startedAt: row.created_at,
        }) as DemoSession,
    ),
    INITIAL_DEMO,
  ];
}
