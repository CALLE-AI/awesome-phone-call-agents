import { maskPhonesInText } from "./privacy.js";
import type { Disposition, RollCallReport, StudentDisposition } from "./types.js";

const ORDER: Disposition[] = [
  "safeguarding_alert",
  "needs_human_review",
  "unreached",
  "not_called",
  "accounted_for",
];

const LABEL: Record<Disposition, string> = {
  safeguarding_alert: "SAFEGUARDING ALERT",
  needs_human_review: "Needs human review",
  unreached: "Unreached",
  not_called: "Not called",
  accounted_for: "Accounted for",
};

export function emptyTotals(): Record<Disposition, number> {
  return {
    safeguarding_alert: 0,
    needs_human_review: 0,
    unreached: 0,
    not_called: 0,
    accounted_for: 0,
  };
}

export function buildReport(
  school: string,
  date: string,
  mode: RollCallReport["mode"],
  students: StudentDisposition[],
  now: Date,
): RollCallReport {
  const totals = emptyTotals();
  for (const s of students) totals[s.disposition] += 1;
  const sorted = [...students].sort(
    (a, b) => ORDER.indexOf(a.disposition) - ORDER.indexOf(b.disposition),
  );
  return { generatedAt: now.toISOString(), school, date, mode, students: sorted, totals };
}

/**
 * Office-facing text. Alerts first, everything masked, every verdict carries
 * the words it rests on. Nothing in here is both unchecked and unlabelled.
 */
export function renderReport(report: RollCallReport): string {
  const out: string[] = [];
  out.push(`Roll Call — ${report.school} — ${report.date} — mode: ${report.mode}`);
  out.push(`generated ${report.generatedAt}`);
  out.push("");
  out.push(
    ORDER.map((d) => `${LABEL[d]}: ${report.totals[d]}`).join(" | "),
  );
  out.push("");
  for (const s of report.students) {
    out.push(`[${LABEL[s.disposition]}] ${s.firstName} (${s.classLabel}, id ${s.studentId})`);
    out.push(`  because: ${maskPhonesInText(s.because)}`);
    out.push(`  next: ${maskPhonesInText(s.nextAction)}`);
    for (const a of s.attempts) {
      if (a.skippedReason) {
        out.push(`  guardian ${a.guardianIndex + 1} ${a.maskedPhone}: not dialled — ${a.skippedReason}`);
        continue;
      }
      const r = a.reduced;
      const status = a.outcome?.status ?? "n/a";
      out.push(
        `  guardian ${a.guardianIndex + 1} ${a.maskedPhone}: call ${a.outcome?.callId ?? "-"} ${status}; answered_by=${r?.answeredBy ?? "-"} aware=${r?.guardianAware ?? "-"} reason=${r?.reasonCategory ?? "-"}`,
      );
      if (a.outcome?.failureMessage) {
        out.push(`    provider note (unverified): ${maskPhonesInText(a.outcome.failureMessage)}`);
      }
    }
    out.push("");
  }
  return out.join("\n");
}
