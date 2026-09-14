import { privateRoute } from "../../lib/private-route";
import { publicCallStatus, publicProviderError } from "../../lib/output-privacy";
import { demoSessions } from "../../lib/demo-session";
import { publicCaseFile } from "../../lib/case-file-store";
import { env } from "cloudflare:workers";
import { initializeCase, readWorkflow } from "../workflow/route";
import {
  applyReviews,
  citeQuote,
  evidenceIsVisible,
  extractTranscript,
  normalizeEvidenceResult,
} from "../../lib/evidence";
import { INTERVIEW_BRANCHES } from "../../lib/call-instructions";
import {
  readCoverage,
  followUpSuggestion,
  emptyCoverage,
  defaultCoverageQuote,
} from "../../lib/case-coverage";
import { readCaseFile } from "../../lib/case-file-store";

type RunRow = {
  id: number;
  provider_mode: string;
  status: string;
  response_payload: string | null;
  goal_result: string | null;
  goal_error: string | null;
  request_payload: string;
  launched_at: string | null;
  updated_at: string;
};
async function getHandler(request: Request) {
  const archived = request
    ? new URL(request.url).searchParams.get("archive") === "1"
    : false;
  const current = await initializeCase();
  const requestedCase = request
    ? new URL(request.url).searchParams.get("case")
    : null;
  const session =
    archived && requestedCase
      ? (await demoSessions(env.DB)).find(
          (item) =>
            item.caseId === requestedCase && item.caseId !== current.caseId,
        )
      : current;
  if (!session)
    return Response.json(
      { error: { message: "This earlier demo was not found." } },
      { status: 404 },
    );
  const workflow = await readWorkflow(session);
  const mode = archived
    ? "archive"
    : (env as unknown as { CALL_PROVIDER?: string }).CALL_PROVIDER || "fake";
  const rows = await env.DB.prepare(
    "SELECT id, provider_mode, status, response_payload, goal_result, goal_error, request_payload, launched_at, updated_at FROM call_runs WHERE (goal_run_id IS NOT NULL OR live_call_budget_reserved_at IS NOT NULL) AND (CASE WHEN ? = 1 THEN interview_id != ? ELSE interview_id = ? END) ORDER BY id DESC",
  )
    .bind(
      archived && !requestedCase ? 1 : 0,
      session.interviewId,
      session.interviewId,
    )
    .all<RunRow>();
  const markers = await env.DB.prepare(
    "SELECT entity_id FROM audit_events WHERE event_type = 'CALLE_GOAL_RESULT_INGESTED'",
  ).all<{ entity_id: string }>();
  const complete = new Set(markers.results.map((item) => item.entity_id));
  const runs = rows.results
    .filter((row) => evidenceIsVisible(row.provider_mode, mode))
    .map((row, index) => {
      const parse = (raw: string | null) => {
        try {
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      };
      const raw = parse(row.response_payload),
        stored = parse(row.request_payload);
      const turns = extractTranscript(raw, row.id);
      let evidence = null,
        validationError = "";
      if (row.goal_result) {
        try {
          evidence = normalizeEvidenceResult(
            parse(row.goal_result),
            stored?.schema_version === "evidence-v2"
              ? "evidence-v2"
              : row.provider_mode === "fake"
                ? "synthetic-legacy"
                : "legacy",
            stored?.branches?.map((branch: { id: string }) => branch.id),
          );
        } catch (error) {
          validationError =
            error instanceof Error
              ? error.message
              : "Invalid returned evidence.";
        }
      }
      const branches =
        evidence?.profile === "evidence-v2"
          ? (stored?.branches || INTERVIEW_BRANCHES).map(
              (branch: (typeof INTERVIEW_BRANCHES)[number]) => {
                const result = evidence!.branches.find(
                  (item) => item.id === branch.id,
                );
                return {
                  ...branch,
                  status: result?.status || "not_reported",
                  quote: result?.evidence_quote || "",
                  citation: citeQuote(result?.evidence_quote || "", turns),
                };
              },
            )
          : [];
      return {
        id: row.id,
        sequence: rows.results.length - index,
        contactId: stored?.contact_id || null,
        contactName:
          stored?.plan?.respondentRole?.split(",")[0] ||
          "Earlier test participant",
        provider: row.provider_mode,
        status: publicCallStatus(row.status),
        error: publicProviderError(row.goal_error),
        validationError,
        evidence,
        turns,
        branches,
        plan: stored?.plan || null,
        recordedAt: row.launched_at || row.updated_at,
        knowledgeCitation: citeQuote(evidence?.knowledge_quote || "", turns),
        suggestedCoverage: defaultCoverageQuote(evidence?.knowledge_quote || "", turns),
        noteCitations: [...(evidence?.limitation_items || []), ...(evidence?.unknown_items || [])].map(item => citeQuote(item.quote, turns)),
        leadCitations: (evidence?.leads || []).map(item => citeQuote(item.quote, turns)),
        terminal: Boolean(
          row.goal_error ||
          (row.goal_result &&
            (stored?.schema_version !== "evidence-v2" ||
              complete.has(`CALL-EVIDENCE-${row.id}`))),
        ),
      };
    });
  const statements = applyReviews(
    workflow.ingested_statements.filter((item) =>
      evidenceIsVisible(item.origin, mode),
    ),
    workflow.reviews,
  ).map((statement) => {
    const runId = Number(statement.id.match(/^CALLE-GOAL-(\d+)-/)?.[1]) || null;
    const run = runs.find((item) => item.id === runId);
    return {
      ...statement,
      runId,
      citation: runId ? citeQuote(statement.evidence, run?.turns || []) : null,
    };
  });
  const coverage =
    archived && !requestedCase
      ? emptyCoverage()
      : await readCoverage(env.DB, mode, session);
  const contacts = await readCaseFile(env.DB, session);
  const suggestion = archived
    ? null
    : followUpSuggestion(
        coverage,
        contacts.contacts,
        runs.map((run) => run.contactId),
      );
  return Response.json({
    session,
    runs,
    statements: archived && !requestedCase ? [] : statements,
    ...(archived && requestedCase
      ? { workflow, caseFile: await publicCaseFile(env.DB, session) }
      : {}),
    archived,
    coverage,
    suggestion,
  });
}

export const GET = privateRoute(getHandler);
