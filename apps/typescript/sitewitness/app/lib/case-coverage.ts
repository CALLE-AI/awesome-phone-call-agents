import { type DemoSession } from "./demo-session.ts";
import { type Contact, type PublicContact } from "./case-file.ts";
import {
  applyReviews,
  citeQuote,
  evidenceIsVisible,
  extractTranscript,
  type Citation,
  type IngestedStatement,
  type ReviewAction,
  type TranscriptTurn,
} from "./evidence.ts";

export const RESEARCH_YEARS = [1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994];
export function yearsInText(text: string): number[] {
  // In this 1987–1994 case, explicit '80s/'90s year abbreviations refer to
  // the 1900s. Normalize a working copy; preserve the exact transcript quote.
  text = text.replace(
    /(^|[^\p{L}\p{N}])['’](8\d|9\d)\b/gu,
    (_match, prefix: string, shortYear: string) => `${prefix}19${shortYear}`,
  );
  const spoken = [
    "eighty seven",
    "eighty eight",
    "eighty nine",
    "ninety",
    "ninety one",
    "ninety two",
    "ninety three",
    "ninety four",
  ];
  for (const index of [0, 1, 2, 4, 5, 6, 7, 3]) {
    // Do not turn an out-of-scope spoken year such as 1995 into 1990.
    const suffix =
      index === 3
        ? "(?![\\s-]+(?:one|two|three|four|five|six|seven|eight|nine)\\b)"
        : "";
    text = text.replace(
      new RegExp(
        `\\bnineteen[\\s-]+${spoken[index].replaceAll(" ", "[\\s-]+")}\\b${suffix}`,
        "gi",
      ),
      String(RESEARCH_YEARS[index]),
    );
  }
  const years = [...text.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) =>
    Number(match[0]),
  );
  // Recognize explicit spoken range connectors without skipping qualifications
  // such as "but not" or "an unknown date" between the two year boundaries.
  if (
    years.length === 2 &&
    /\b(?:19|20)\d{2}\s*(?:(?:(?:all\s+the\s+way(?:\s+up)?|(?:right\s+)?up)\s+)?(?:to|through|until)(?:[\s,]+(?:to|through|until))*|[-–—])\s*(?:19|20)\d{2}\b/i.test(
      text,
    ) &&
    years[0] <= years[1]
  )
    return RESEARCH_YEARS.filter(
      (year) => year >= years[0] && year <= years[1],
    );
  return RESEARCH_YEARS.filter((year) => years.includes(year));
}
// A reviewer can identify the original turn when identical words occur more
// than once. The selected source must still be a respondent's exact quotation.
export function coverageQuoteCitation(
  quote: string,
  turns: TranscriptTurn[],
  sourceTurnId?: string,
): Citation {
  if (!turns.length) return { status: "missing_transcript", turnIds: [] };
  if (!sourceTurnId?.trim()) return citeQuote(quote, turns);
  const source = turns.find((turn) => turn.id === sourceTurnId.trim());
  if (!source || source.speaker !== "respondent")
    return { status: "unmatched", turnIds: [] };
  return citeQuote(quote, [source]);
}
export function defaultCoverageQuote(
  knowledgeQuote: string,
  turns: TranscriptTurn[],
): { quote: string; sourceTurnId: string } {
  const citation = citeQuote(knowledgeQuote, turns);
  if (citation.status === "matched")
    return { quote: knowledgeQuote, sourceTurnId: citation.turnIds[0] };
  const source = turns.find(
    (turn) =>
      turn.speaker === "respondent" && yearsInText(turn.text).length > 0,
  );
  return { quote: source?.text || "", sourceTurnId: source?.id || "" };
}
export function describeYears(years: readonly number[]) {
  const sorted = [...new Set(years)].sort((a, b) => a - b),
    ranges: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const first = sorted[i];
    let last = first;
    while (sorted[i + 1] === last + 1) last = sorted[++i];
    ranges.push(first === last ? `${first}` : `${first}–${last}`);
  }
  return ranges.join(" and ") || "none";
}
export type CoverageRecord = {
  runId: number;
  years: number[];
  quote: string;
  sourceTurnId?: string;
  interpretationNote?: string;
  signature: string;
  reviewScope?: "years";
  savedAt: string;
};
// A date review is independent of reviewing the interview's other claims.
export const yearCoverageSignature = (
  record: Pick<
    CoverageRecord,
    "runId" | "quote" | "years" | "sourceTurnId" | "interpretationNote"
  >,
) =>
  JSON.stringify({
    runId: record.runId,
    quote: record.quote.trim(),
    years: [...new Set(record.years)].sort((a, b) => a - b),
    ...(record.sourceTurnId?.trim()
      ? { sourceTurnId: record.sourceTurnId.trim() }
      : {}),
    ...(record.interpretationNote?.trim()
      ? { interpretationNote: record.interpretationNote.trim() }
      : {}),
  });
export type CaseCoverage = {
  records: CoverageRecord[];
  years: number[];
  missingYears: number[];
};
export const coverageRevision = (coverage: CaseCoverage) =>
  JSON.stringify(
    [...coverage.records]
      .sort((a, b) => a.runId - b.runId)
      .map(({ runId, years, quote, signature }) => ({
        runId,
        years,
        quote,
        signature,
      })),
  );
export const emptyCoverage = (): CaseCoverage => ({
  records: [],
  years: [],
  missingYears: [...RESEARCH_YEARS],
});
export const coverageSignature = (
  statements: ReturnType<typeof applyReviews>,
) =>
  JSON.stringify(
    statements
      .map((item) => ({
        id: item.id,
        revision: item.revision,
        status: item.status,
        fact: item.fact,
        evidence: item.evidence,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
export async function reviewedCaseStatements(
  db: D1Database,
  mode: string,
  session: DemoSession,
) {
  const input = await db
    .prepare("SELECT * FROM ingested_statements WHERE evidence_gap_id = ?")
    .bind(session.caseId)
    .all<IngestedStatement>();
  const actions = await db
    .prepare(
      "SELECT * FROM review_actions WHERE statement_id IN (SELECT id FROM ingested_statements WHERE evidence_gap_id = ?) ORDER BY id",
    )
    .bind(session.caseId)
    .all<ReviewAction>();
  return applyReviews(
    input.results.filter((item) => evidenceIsVisible(item.origin, mode)),
    actions.results,
  );
}
export async function readCoverage(
  db: D1Database,
  mode: string,
  session: DemoSession,
): Promise<CaseCoverage> {
  const prefix = `${session.caseId}:COVERAGE:`;
  const events = await db
    .prepare(
      "SELECT event_type, detail FROM audit_events WHERE event_type IN ('CASE_YEARS_CONFIRMED', 'CASE_YEARS_REOPENED') AND substr(entity_id, 1, ?) = ? ORDER BY id",
    )
    .bind(prefix.length, prefix)
    .all<{ event_type: string; detail: string }>();
  const runs = await db
    .prepare(
      "SELECT id, provider_mode, response_payload FROM call_runs WHERE interview_id = ?",
    )
    .bind(session.interviewId)
    .all<{
      id: number;
      provider_mode: string;
      response_payload: string | null;
    }>();
  const statements = await reviewedCaseStatements(db, mode, session);
  const latest = new Map<number, CoverageRecord>();
  for (const event of events.results) {
    const value = JSON.parse(event.detail) as CoverageRecord;
    if (event.event_type === "CASE_YEARS_REOPENED") latest.delete(value.runId);
    else latest.set(value.runId, value);
  }
  const records = [...latest.values()].filter((value) => {
    const run = runs.results.find(
      (item) =>
        item.id === value.runId && evidenceIsVisible(item.provider_mode, mode),
    );
    const reviewed = statements.filter((item) =>
      item.id.startsWith(`CALLE-GOAL-${value.runId}-`),
    );
    const note = value.interpretationNote?.trim() || "";
    const noteValid = !note || (note.length >= 10 && note.length <= 1000);
    const manuallyInterpreted = note.length >= 10 && note.length <= 1000;
    const reviewValid =
      value.reviewScope === "years"
        ? Array.isArray(value.years) &&
          value.years.length > 0 &&
          value.years.every((year) => RESEARCH_YEARS.includes(year)) &&
          noteValid &&
          (manuallyInterpreted ||
            value.years.every((year) =>
              yearsInText(value.quote).includes(year),
            )) &&
          value.signature === yearCoverageSignature(value)
        : reviewed.length > 0 &&
          reviewed.some((item) => item.status === "accepted") &&
          !reviewed.some((item) => item.status === "pending") &&
          value.signature === coverageSignature(reviewed);
    return (
      run &&
      reviewValid &&
      coverageQuoteCitation(
        value.quote,
        extractTranscript(JSON.parse(run.response_payload || "{}"), run.id),
        value.sourceTurnId,
      ).status === "matched"
    );
  });
  const years = RESEARCH_YEARS.filter((year) =>
    records.some((record) => record.years.includes(year)),
  );
  return {
    records,
    years,
    missingYears: RESEARCH_YEARS.filter((year) => !years.includes(year)),
  };
}
export function followUpSuggestion(
  coverage: CaseCoverage,
  contacts: Array<Contact | PublicContact>,
  called: Array<string | null>,
) {
  if (!coverage.records.length || !coverage.missingYears.length) return null;
  const candidates = contacts
    .filter((contact) => !called.includes(contact.id))
    .map((contact) => ({
      contact,
      years: yearsInText(contact.expectedPeriod).filter((year) =>
        coverage.missingYears.includes(year),
      ),
    }))
    .filter((item) => item.years.length)
    .sort((a, b) => b.years.length - a.years.length);
  const next = candidates[0];
  if (!next) return null;
  return {
    contactId: next.contact.id,
    name: next.contact.name,
    years: next.years,
    focus: `Human-reviewed interview testimony addresses ${describeYears(coverage.years)}. ${describeYears(coverage.missingYears)} still need testimony. Ask ${next.contact.name} about personally observed operations in ${describeYears(next.years)}. Confirm their actual knowledge and access; the referral period is not evidence.`,
  };
}
