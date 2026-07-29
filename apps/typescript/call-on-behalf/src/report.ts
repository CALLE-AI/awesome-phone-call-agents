/**
 * Rendering. The report is the product: a person who could not make the call gets
 * the answer, exactly what was said about them and the transcript in writing.
 */

import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { blocking } from "./disclosure.js";
import { maskPhone, preflight } from "./errand.js";
import { buildResultSchema, buildTask, spokenLocal, spokenWindow } from "./script.js";
import type { DisclosureFinding, ErrandReport, ErrandRequest, TranscriptTurn } from "./types.js";

function speaker(turn: TranscriptTurn): string {
  if (turn.speaker === "bot") {
    return "assistant";
  }
  return turn.speaker === "user" ? "them" : "unclear";
}

function clock(seconds: number | null): string {
  if (seconds === null) {
    return "     ";
  }
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function renderTranscript(turns: TranscriptTurn[]): string {
  if (turns.length === 0) {
    return "  No transcript came back for this call.";
  }
  return turns.map((turn) => `  [${clock(turn.offset_seconds)}] ${speaker(turn)}: ${turn.text}`).join("\n");
}

export function renderPreview(request: ErrandRequest): string {
  const findings = preflight(request);
  const blockers = blocking(findings);
  const lines: string[] = [];
  lines.push("Preview only. No call is placed and no credentials are used.");
  lines.push("");
  lines.push(`Errand        ${request.errandId}`);
  lines.push(`On behalf of  ${request.onBehalfOf.name} (${request.onBehalfOf.reason_for_delegation})`);
  lines.push(`Calling       ${request.callee.name} ${maskPhone(request.callee.phone)}`);
  lines.push(`Number from   ${request.callee.published_source}`);
  lines.push(`Language      ${request.policy.language}`);
  lines.push(`Goal          ${request.goal.summary}`);
  lines.push(`May agree to  ${request.goal.commitment}`);
  for (const window of request.authorizedWindows) {
    lines.push(`              ${spokenWindow(window)}`);
  }
  lines.push("");
  lines.push("Details the caller may give if asked and nothing else");
  if (request.disclosure.length === 0) {
    lines.push("  none");
  }
  for (const item of request.disclosure) {
    lines.push(`  ${item.label}: ${item.value}`);
  }
  lines.push("");
  lines.push("Privacy check on the script");
  if (blockers.length === 0 && findings.length === 0) {
    lines.push("  clean, the script says nothing about you that is not on the list above");
  }
  for (const finding of findings) {
    lines.push(`  ${finding.severity === "block" ? "refused" : "warning"}: ${finding.kind} (${finding.masked}) in ${finding.where}`);
  }
  lines.push("");
  lines.push("The call script");
  lines.push("");
  for (const line of buildTask(request).split("\n")) {
    lines.push(line.length === 0 ? "" : `  ${line}`);
  }
  lines.push("");
  lines.push("Result contract");
  lines.push(`  ${JSON.stringify(buildResultSchema(request))}`);
  lines.push("");
  lines.push(
    blockers.length === 0
      ? "Nothing above has been sent anywhere. Add --live to place the call."
      : "This errand will not run until the refused details are removed or authorized.",
  );
  return lines.join("\n");
}

export function renderReport(report: ErrandReport): string {
  const lines: string[] = [];
  lines.push(`Call report: ${report.errand_id}`);
  lines.push("");
  lines.push(`On behalf of  ${report.on_behalf_of}`);
  lines.push(`Called        ${report.callee_name}  ${report.callee_phone_masked}`);
  lines.push(
    `Status        ${report.call_status}, ${report.reached_person ? "a person answered" : "no person on the line"}`,
  );
  lines.push(`Outcome       ${report.outcome}`);
  lines.push("");

  if (report.commitment !== "none_sought") {
    lines.push("What was agreed");
    if (report.commitment === "committed") {
      const when =
        report.committed_datetime === null
          ? "as discussed on the call"
          : /^\d{4}-\d{2}-\d{2}T/.test(report.committed_datetime)
            ? spokenLocal(report.committed_datetime)
            : report.committed_datetime;
      lines.push(`  ${when}`);
      if (report.confirmation_code.length > 0) {
        lines.push(`  confirmation ${report.confirmation_code}`);
      }
    } else if (report.commitment === "outside_authorized_window") {
      lines.push("  something was agreed outside the windows you authorized, see what to do next");
    } else if (report.commitment === "proposal_only") {
      lines.push("  nothing. They offered something the caller was not allowed to accept");
    } else {
      lines.push("  nothing. They would not arrange it on this call");
    }
    lines.push("");
  }

  lines.push("Your questions");
  for (const [index, answer] of report.answers.entries()) {
    lines.push(`  ${index + 1}. ${answer.text}`);
    lines.push(answer.answered ? `     answered: ${answer.answer}` : "     not answered");
  }
  lines.push("");

  lines.push("What was said about you");
  lines.push(`  said          ${report.disclosed.length > 0 ? report.disclosed.join(", ") : "nothing"}`);
  lines.push(
    `  not needed    ${report.authorized_but_unused.length > 0 ? report.authorized_but_unused.join(", ") : "nothing left over"}`,
  );
  if (report.leaks.length === 0) {
    lines.push("  privacy check nothing outside your list was said");
  } else {
    for (const leak of report.leaks) {
      lines.push(`  privacy check ${leak.severity === "block" ? "LEAK" : "possible leak"}: ${leak.kind} (${leak.masked})`);
    }
  }
  lines.push("");

  if (report.callee_notes.length > 0) {
    lines.push("Notes");
    lines.push(`  ${report.callee_notes}`);
    lines.push("");
  }
  lines.push("What to do next");
  lines.push(`  ${report.next_step}`);
  lines.push("");
  lines.push("Transcript, verbatim");
  lines.push(renderTranscript(report.transcript));
  return lines.join("\n");
}

export function writeReport(path: string, report: ErrandReport): void {
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

export function readReport(path: string): ErrandReport {
  return JSON.parse(readFileSync(path, "utf8")) as ErrandReport;
}

export function findingsLine(findings: DisclosureFinding[]): string {
  return findings.map((finding) => `${finding.kind} (${finding.masked}) in ${finding.where}`).join(", ");
}
