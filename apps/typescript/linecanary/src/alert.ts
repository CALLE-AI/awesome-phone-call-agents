/**
 * Alert output: a human summary for terminals and CI logs, a Slack webhook
 * payload for pages, and the process exit code. Alerts never carry full phone
 * numbers — a paging channel is not a place for PII, and masked numbers are
 * enough to know which line broke.
 */

import type { RunReport } from "./runner.js";

export function maskPhone(phone: string): string {
  // Only the plus sign and the last two digits survive. Country-code
  // preservation would need a prefix table for no monitoring value — the
  // line id next to the mask already says which line this is.
  const match = /^\+(\d+)(\d{2})$/.exec(phone);
  if (match === null) {
    return "•••";
  }
  const [, middle, tail] = match;
  return `+${"•".repeat(middle.length)}${tail}`;
}

export function formatReport(report: RunReport): string {
  const lines: string[] = [];
  lines.push(`LineCanary ${report.live ? "live" : "dry-run"} @ ${report.startedAt} — ${report.ok ? "OK" : "ATTENTION"}`);
  for (const run of report.runs) {
    const where = `${run.planned.checkId} (${run.planned.lineId} ${maskPhone(run.planned.phone)})`;
    if (run.skipped !== null) {
      lines.push(`  ⏭  ${where}: skipped (${run.skipped})`);
      continue;
    }
    if (run.error !== null) {
      lines.push(`  ⚠  ${where}: error — ${run.error}`);
      continue;
    }
    const outcome = run.outcome!;
    const marker = outcome.status === "pass" ? "✓" : "✗";
    const timing = outcome.timing.secondsToAnswer === null ? "" : `, answered in ${outcome.timing.secondsToAnswer}s`;
    lines.push(`  ${marker}  ${where}: ${outcome.status}${timing}`);
    for (const entry of outcome.assertions.filter((candidate) => !candidate.pass)) {
      lines.push(`       ${entry.assertion.path}: ${entry.detail}`);
    }
    for (const violation of outcome.timingViolations) {
      lines.push(`       timing: ${violation}`);
    }
    if (outcome.confidenceViolation !== null) {
      lines.push(`       confidence: ${outcome.confidenceViolation}`);
    }
  }
  if (report.regressions.length > 0) {
    lines.push("  regressions:");
    for (const regression of report.regressions) {
      lines.push(`    [${regression.kind}] ${regression.checkId}: ${regression.detail}`);
    }
  }
  return lines.join("\n");
}

function needsAttention(report: RunReport): boolean {
  return !report.ok;
}

export function slackPayload(report: RunReport): Record<string, unknown> {
  const headline = `🐤 LineCanary: ${report.regressions.length} regression(s) at ${report.startedAt}`;
  return {
    text: headline,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "LineCanary alert", emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: "```" + formatReport(report) + "```" } },
    ],
  };
}

export async function sendSlack(webhookUrl: string, report: RunReport, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!needsAttention(report)) {
    return;
  }
  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(slackPayload(report)),
  });
  if (!response.ok) {
    throw new Error(`Slack webhook answered ${response.status}.`);
  }
}

/** 0 all good · 1 regressions or check failures · 2 the run itself broke. */
export function exitCode(report: RunReport): 0 | 1 | 2 {
  if (report.runs.some((run) => run.error !== null)) {
    return 2;
  }
  return report.ok ? 0 : 1;
}
