import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationReport, redactConversationText } from "../lib/conversation-pdf.ts";
import { fixtureBrief, fixtureCandidates, fixtureResults, fixtureSummaries, fixtureTranscripts, initialRecords } from "../lib/fixtures.ts";

test("redacts E.164, formatted, and long phone-like numbers without hiding dates", () => {
  assert.equal(redactConversationText("Call +442079460123 or 202-555-0199."), "Call [phone masked] or [phone masked].");
  assert.equal(redactConversationText("Needed by 2026-10-15."), "Needed by 2026-10-15.");
});

test("builds conversation sections with summaries, checks, evidence, and transcript turns", () => {
  const records = initialRecords.map((record) => record.candidateId === "willow-room" ? {
    ...record,
    status: "completed" as const,
    result: fixtureResults[record.candidateId],
    summary: `${fixtureSummaries[record.candidateId]} Call +442079460123.`,
    transcriptTurns: fixtureTranscripts[record.candidateId],
  } : record);
  const sections = buildConversationReport(fixtureBrief, fixtureCandidates, records);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].candidateName, "Willow Room Childcare");
  assert.match(sections[0].summary, /\[phone masked\]/);
  assert.equal(sections[0].transcriptLines.length, 6);
  assert.ok(sections[0].checkLines.some((line) => line.startsWith("PASS - Start date")));
  assert.ok(sections[0].evidenceLines.some((line) => line.includes("toddler opening")));
});
