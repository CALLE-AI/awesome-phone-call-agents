import { evaluateCenter } from "./matching.ts";
import type { CenterCallRecord, CenterCandidate, SearchBrief } from "./types.ts";

export type ConversationReportSection = {
  candidateName: string;
  sourceLabel: string;
  summary: string;
  outcome: string;
  resultLines: string[];
  checkLines: string[];
  transcriptLines: string[];
  evidenceLines: string[];
};

const phonePattern = /\+[1-9]\d{7,14}/g;
const formattedPhonePattern = /\b(?:\d{3}[- .]){2}\d{4}\b/g;
const longNumberPattern = /\b\d{8,}\b/g;

export function redactConversationText(value: string) {
  return value
    .replace(phonePattern, "[phone masked]")
    .replace(formattedPhonePattern, "[phone masked]")
    .replace(longNumberPattern, "[number masked]")
    .trim();
}

export function buildConversationReport(
  brief: SearchBrief,
  candidates: CenterCandidate[],
  records: CenterCallRecord[],
): ConversationReportSection[] {
  return records.flatMap((record) => {
    if (record.status !== "completed") return [];
    const candidate = candidates.find((item) => item.id === record.candidateId);
    if (!candidate) return [];
    const evaluation = evaluateCenter(candidate, record.result, brief);
    const result = record.result;
    const resultLines = result ? [
      `Line outcome: ${result.lineOutcome.replaceAll("_", " ")}`,
      `Vacancy: ${result.vacancyStatus.replaceAll("_", " ")}`,
      `Earliest start: ${result.earliestStartDate || "unknown"}`,
      `Weekdays: ${result.availableWeekdays.join(", ") || "unknown"}`,
      `Hours: ${result.openingTime || "unknown"} to ${result.closingTime || "unknown"}`,
      `Monthly tuition: ${result.monthlyTuitionMinor < 0 ? "unknown" : `${result.monthlyTuitionMinor} minor ${brief.currency} units`}`,
      `Registration fee: ${result.registrationFeeMinor < 0 ? "unknown" : `${result.registrationFeeMinor} minor ${brief.currency} units`}`,
      `Subsidy: ${result.subsidyStatus.replaceAll("_", " ")}`,
      `Tour: ${result.tourStatus.replaceAll("_", " ")}${result.tourWindows.length ? ` (${result.tourWindows.join("; ")})` : ""}`,
    ] : ["No schema-valid structured result was available."];
    const transcriptLines = (record.transcriptTurns ?? []).map((turn) => {
      const speaker = turn.speaker === "agent" ? "TinySlot" : turn.speaker === "recipient" ? "Center staff" : "Unknown speaker";
      const timestamp = turn.offsetSeconds === null ? "" : ` [${Math.floor(turn.offsetSeconds / 60)}:${String(Math.floor(turn.offsetSeconds % 60)).padStart(2, "0")}]`;
      return redactConversationText(`${speaker}${timestamp}: ${turn.text}`);
    });
    const evidenceLines = result ? [result.availabilityEvidence, result.scheduleEvidence, result.feeEvidence]
      .filter((line) => line.trim().length > 0)
      .map(redactConversationText) : [];
    return [{
      candidateName: candidate.name,
      sourceLabel: record.source === "fixture" ? "Synthetic no-call fixture" : "CALL-E live result",
      summary: redactConversationText(record.summary || "No call summary was available."),
      outcome: `${evaluation.tier.replaceAll("_", " ")} - ${evaluation.headline}`,
      resultLines: resultLines.map(redactConversationText),
      checkLines: evaluation.checks.map((item) => `${item.status.toUpperCase()} - ${item.label}: ${item.detail}`).map(redactConversationText),
      transcriptLines: transcriptLines.length ? transcriptLines : ["Full transcript unavailable; evidence excerpts are included below."],
      evidenceLines: evidenceLines.length ? evidenceLines : ["No evidence excerpts were available."],
    }];
  });
}

export async function downloadConversationPdf(
  brief: SearchBrief,
  candidates: CenterCandidate[],
  records: CenterCallRecord[],
) {
  const sections = buildConversationReport(brief, candidates, records);
  if (sections.length === 0) throw new Error("No completed conversations are available for PDF export.");
  const { jsPDF } = await import("jspdf");
  const document = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 46;
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  const textWidth = pageWidth - margin * 2;
  let y = margin;

  function ensureSpace(height: number) {
    if (y + height <= pageHeight - margin) return;
    document.addPage();
    y = margin;
  }

  function write(text: string, size = 10, style: "normal" | "bold" = "normal", gap = 5) {
    document.setFont("helvetica", style);
    document.setFontSize(size);
    const lines = document.splitTextToSize(redactConversationText(text), textWidth) as string[];
    const height = lines.length * (size * 1.3);
    ensureSpace(height + gap);
    document.text(lines, margin, y);
    y += height + gap;
  }

  document.setProperties({
    title: "TinySlot Conversation Evidence Report",
    subject: "Privacy-masked childcare availability conversation evidence",
    creator: "TinySlot",
  });
  write("TinySlot", 24, "bold", 2);
  write("Conversation evidence report", 15, "bold", 10);
  write(`Generated: ${new Date().toISOString()}`, 9);
  write("Privacy note: phone numbers are masked. Synthetic transcripts are labeled. This report is not enrollment, licensing, medical, legal, financial, or safety advice.", 9, "normal", 12);
  write("Care brief", 13, "bold");
  write(`${brief.ageBand} care by ${brief.desiredStartDate}; ${brief.requiredWeekdays.join(", ")}; ${brief.dropoffTime}-${brief.pickupTime}; monthly budget ${brief.budgetMonthlyMinor} minor ${brief.currency} units; target ${brief.targetMatches} matches.`, 10, "normal", 14);

  sections.forEach((section, index) => {
    ensureSpace(90);
    write(`${index + 1}. ${section.candidateName}`, 15, "bold", 2);
    write(section.sourceLabel, 9, "bold", 8);
    write(`Outcome: ${section.outcome}`, 11, "bold", 8);
    write("Call summary", 12, "bold");
    write(section.summary, 10, "normal", 10);
    write("Structured outcome", 12, "bold");
    section.resultLines.forEach((line) => write(`- ${line}`, 9, "normal", 2));
    y += 5;
    write("Deterministic checks", 12, "bold");
    section.checkLines.forEach((line) => write(`- ${line}`, 9, "normal", 2));
    y += 5;
    write("Conversation", 12, "bold");
    section.transcriptLines.forEach((line) => write(line, 9, "normal", 4));
    y += 5;
    write("Evidence excerpts", 12, "bold");
    section.evidenceLines.forEach((line) => write(`- "${line}"`, 9, "normal", 4));
    y += 14;
  });

  document.save("tinyslot-conversation-report.pdf");
}
