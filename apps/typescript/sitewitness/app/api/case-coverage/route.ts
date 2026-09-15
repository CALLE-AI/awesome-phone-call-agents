import { privateRoute } from "../../lib/private-route";
import { sessionMismatch, staleDemoResponse } from "../../lib/demo-session";
import { env } from "cloudflare:workers";
import { initializeCase } from "../workflow/route";
import {
  RESEARCH_YEARS,
  coverageQuoteCitation,
  yearCoverageSignature,
  describeYears,
  readCoverage,
  yearsInText,
} from "../../lib/case-coverage";
import { extractTranscript } from "../../lib/evidence";
import { resolvePrivateQuote } from "../../lib/private-quote";

async function postHandler(request: Request) {
  const session = await initializeCase();
  if (sessionMismatch(request, session)) return staleDemoResponse();
  const fail = (message: string, status = 422) =>
    Response.json({ error: { message } }, { status });
  if (request.headers.get("x-demo-role") !== "reviewer")
    return fail("EP Reviewer permission is required.", 403);
  let body: {
    runId?: number;
    years?: number[];
    quote?: string;
    sourceTurnId?: string;
    interpretationNote?: string;
    reviewed?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return fail("A JSON request is required.");
  }
  if (
    !body ||
    typeof body !== "object" ||
    body.reviewed !== true ||
    !Number.isInteger(body.runId) ||
    !Array.isArray(body.years) ||
    !body.years.length ||
    body.years.some((year) => !RESEARCH_YEARS.includes(year)) ||
    typeof body.quote !== "string" ||
    body.quote.length > 2000 ||
    (body.sourceTurnId !== undefined &&
      (typeof body.sourceTurnId !== "string" ||
        body.sourceTurnId.length > 200)) ||
    (body.interpretationNote !== undefined &&
      typeof body.interpretationNote !== "string")
  )
    return fail(
      "Confirm the supported years and supply the exact respondent quotation.",
    );
  const sourceTurnId = body.sourceTurnId?.trim() || "";
  const interpretationNote = body.interpretationNote?.trim() || "";
  if (
    interpretationNote &&
    (interpretationNote.length < 10 || interpretationNote.length > 1000)
  )
    return fail("Explain the year correction in 10 to 1,000 characters.");
  const run = await env.DB.prepare(
    "SELECT id, response_payload, goal_result FROM call_runs WHERE id = ? AND interview_id = ? AND goal_result IS NOT NULL AND goal_error IS NULL AND EXISTS (SELECT 1 FROM audit_events WHERE entity_id = 'CALL-EVIDENCE-' || call_runs.id)",
  )
    .bind(body.runId, session.interviewId)
    .first<{ id: number; response_payload: string | null; goal_result: string }>();
  if (!run)
    return fail(
      "A completed, processed interview in this case is required.",
      409,
    );
  const turns = extractTranscript(JSON.parse(run.response_payload || "{}"), run.id);
  const returned = JSON.parse(run.goal_result);
  const originalQuote = resolvePrivateQuote(body.quote, turns, sourceTurnId,
    typeof returned.knowledge_period?.quote === "string" ? [returned.knowledge_period.quote] : [],
    [String(env.CALLE_API_KEY || ""), String(env.SITEWITNESS_BASIC_PASSWORD || "")]);
  if (!originalQuote) return fail("Select one original respondent answer before saving this redacted quotation.");
  body.quote = originalQuote;
  if (
    coverageQuoteCitation(
      body.quote,
      turns,
      sourceTurnId,
    ).status !== "matched"
  )
    return fail(
      "The quotation must match the selected respondent turn in this interview. Choose an original respondent answer from the transcript.",
    );
  if (
    body.years.some((year) => !yearsInText(body.quote!).includes(year)) &&
    !interpretationNote
  )
    return fail(
      "Explain why the original quotation supports the extra selected years. Add a reviewer correction of 10 to 1,000 characters, or select only automatically recognized years.",
    );
  const mode =
    (env as unknown as { CALL_PROVIDER?: string }).CALL_PROVIDER || "fake";
  const savedAt = new Date().toISOString();
  const reviewedYears = {
    runId: run.id,
    years: [...new Set(body.years)].sort((a, b) => a - b),
    quote: body.quote.trim(),
    ...(sourceTurnId ? { sourceTurnId } : {}),
    ...(interpretationNote ? { interpretationNote } : {}),
  };
  const record = {
    ...reviewedYears,
    reviewScope: "years" as const,
    signature: yearCoverageSignature(reviewedYears),
    savedAt,
  };
  const previous = await readCoverage(env.DB, mode, session);
  const years = RESEARCH_YEARS.filter(
    (year) =>
      record.years.includes(year) ||
      previous.records.some(
        (item) => item.runId !== run.id && item.years.includes(year),
      ),
  );
  const missing = RESEARCH_YEARS.filter((year) => !years.includes(year));
  const rationale = `Reviewed interview testimony addresses ${describeYears(years)}. ${missing.length ? `${describeYears(missing)} still need additional sources.` : "All research years have reviewed testimony. Review the evidence and any outstanding tasks, then save a decision on the historical-use question."}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO audit_events (event_type, entity_id, detail, actor, created_at) VALUES ('CASE_YEARS_CONFIRMED', ?, ?, 'EP Reviewer', ?)",
    ).bind(
      `${session.caseId}:COVERAGE:${run.id}`,
      JSON.stringify(record),
      savedAt,
    ),
    ...(missing.length
      ? [
          env.DB.prepare(
            "INSERT INTO evidence_gap_dispositions (evidence_gap_id, disposition, rationale, reviewer_role, created_at) VALUES (?, 'PARTIALLY_RESOLVED', ?, 'reviewer', ?)",
          ).bind(session.caseId, rationale, savedAt),
        ]
      : []),
    env.DB.prepare(
      "UPDATE case_workflow SET status = ?, assigned_role = ?, next_action = ?, updated_at = ? WHERE evidence_gap_id = ?",
    ).bind(
      missing.length ? "FOLLOW_UP_REQUIRED" : "AWAITING_EP_REVIEW",
      missing.length ? "coordinator" : "reviewer",
      rationale,
      savedAt,
      session.caseId,
    ),
  ]);
  return Response.json({
    ok: true,
    coverage: await readCoverage(env.DB, mode, session),
  });
}

export const POST = privateRoute(postHandler);
