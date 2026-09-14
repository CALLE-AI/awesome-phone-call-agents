/**
 * Alert output: a human summary for terminals and CI logs, a Slack webhook
 * payload for pages, and the process exit code. Alerts never carry full phone
 * numbers — a paging channel is not a place for PII, and masked numbers are
 * enough to know which line broke.
 */

import type { Regression } from "./diff.js";
import type { CheckRun, RunReport } from "./runner.js";

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

/** Human labels for regression kinds — Slack readers get prose, CI logs keep the raw kind. */
const KIND_LABELS: Record<Regression["kind"], string> = {
  new_failure: "New failure",
  assertion_regressed: "Different answer than expected",
  still_failing: "Still failing",
  timing_regressed: "Slower than usual",
  confidence_dropped: "Answer confidence dropped",
  recovered: "Recovered",
};

/** A skip reason phrased for the operator, with the fix where one exists. */
function describeSkip(reason: NonNullable<CheckRun["skipped"]>, lineId: string): string {
  switch (reason) {
    case "unverified-line":
      return `line not verified — run: linecanary verify ${lineId} --live`;
    case "outside-call-window":
      return "outside the configured call window";
    case "dry-run":
      return "dry run (no call placed)";
    case "filtered":
      return "filtered by --only";
  }
}

/** True when a live run skipped every check: no call produced an outcome. */
function nothingRan(report: RunReport): boolean {
  return report.live && report.runs.length > 0 && report.runs.every((run) => run.skipped !== null);
}

export function formatReport(report: RunReport, humanizeKinds = false): string {
  const lines: string[] = [];
  if (nothingRan(report)) {
    // A live invocation that placed zero calls gets its own headline: a cron
    // that always skips must read as "not monitoring", never as quiet health.
    const counts = new Map<string, number>();
    for (const run of report.runs) {
      counts.set(run.skipped!, (counts.get(run.skipped!) ?? 0) + 1);
    }
    const breakdown = [...counts].map(([reason, count]) => `${count}× ${reason}`).join(", ");
    // Benign skips (off-hours, dry-run, --only) stay OK; the alarming headline
    // is reserved for runs that skipped when they should have called.
    lines.push(
      report.ok
        ? `LineCanary live @ ${report.startedAt} — OK (no calls placed: ${breakdown})`
        : `LineCanary live @ ${report.startedAt} — NOTHING RAN (${breakdown})`,
    );
  } else {
    lines.push(`LineCanary ${report.live ? "live" : "dry-run"} @ ${report.startedAt} — ${report.ok ? "OK" : "ATTENTION"}`);
  }
  for (const run of report.runs) {
    const where = `${run.planned.checkId} (${run.planned.lineId} ${maskPhone(run.planned.phone)})`;
    if (run.skipped !== null) {
      lines.push(`  ⏭  ${where}: skipped — ${describeSkip(run.skipped, run.planned.lineId)}`);
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
      lines.push(`    [${humanizeKinds ? KIND_LABELS[regression.kind] : regression.kind}] ${regression.checkId}: ${regression.detail}`);
    }
  }
  return lines.join("\n");
}

function hasRecovery(report: RunReport): boolean {
  return report.regressions.some((entry) => entry.kind === "recovered");
}

/** Bad news always pages; a recovery closes the loop with good news. */
function needsAttention(report: RunReport): boolean {
  return !report.ok || hasRecovery(report);
}

export function slackPayload(report: RunReport): Record<string, unknown> {
  const headline = report.ok
    ? `✅ LineCanary: recovered at ${report.startedAt}`
    : nothingRan(report)
      ? `🐤 LineCanary: nothing ran at ${report.startedAt}`
      : `🐤 LineCanary: ${report.regressions.length} regression(s) at ${report.startedAt}`;
  const blocks: Record<string, unknown>[] = [
    { type: "header", text: { type: "plain_text", text: "LineCanary alert", emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: "```" + formatReport(report, true) + "```" } },
  ];
  // What the canary heard on the failing calls — the last few line-side turns,
  // so the person paged sees the evidence without opening the dashboard.
  for (const run of report.runs) {
    const outcome = run.outcome;
    if (outcome === null || outcome.status === "pass" || outcome.transcript === undefined) {
      continue;
    }
    const heard =
      outcome.transcript.length === 0
        ? "(dead air — no conversation)"
        : outcome.transcript
            .slice(-4)
            .map((turn) => `[${turn.offsetSeconds ?? "?"}s] ${turn.speaker === "bot" ? "canary" : "line"}: ${turn.text}`)
            .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${outcome.checkId} — what the canary heard:*\n` + "```" + heard.slice(0, 600) + "```" },
    });
  }
  return { text: headline, blocks };
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

/** 0 all good · 1 regressions, failures or a live run left unverified · 2 the run itself broke. */
export function exitCode(report: RunReport): 0 | 1 | 2 {
  if (report.runs.some((run) => run.error !== null)) {
    return 2;
  }
  return report.ok ? 0 : 1;
}
