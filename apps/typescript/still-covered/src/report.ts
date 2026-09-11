// Outreach report for the program. Rebuilt from the ledger, so it is reproducible and every number
// can be traced to a line in the JSONL file. Phone numbers are masked throughout; no diagnosis or
// medical detail is ever recorded.

import type { Projection } from "./ledger.js";
import { maskPhone } from "./mask.js";
import { formatMonth } from "./rules.js";
import { languageName } from "./tasks.js";
import type { ExemptionCode, Outcome, PersonState } from "./types.js";

const TERMINAL = new Set(["completed", "failed", "canceled"]);

export const OUTCOME_LABEL: Record<Outcome, string> = {
  cleared_by_data: "Cleared by state data, no call needed",
  likely_exempt: "May qualify for an exemption",
  likely_meets: "May already meet the requirement",
  at_risk: "At risk: no exemption found, below the requirement",
  needs_review: "Needs a navigator's review",
  declined: "Asked to be called later",
  opted_out: "Asked not to be called again",
  identity_unconfirmed: "Identity not confirmed",
  unreachable: "Not reached",
  unverified: "Call did not finish",
  not_attempted: "Not attempted: CALL-E did not accept the task",
};

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`;
}

function fmtSeconds(s: number | null): string {
  if (s === null) {
    return "n/a";
  }
  return s < 90 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function buildReport(projection: Projection): string {
  const c = projection.campaign;
  const states = [...projection.states.values()];
  const by = (o: Outcome): PersonState[] => states.filter((s) => s.outcome === o);
  const pending = states.filter((s) => s.outcome === null);
  const called = states.filter((s) => s.attempts > 0).length;
  const screened = states.filter((s) => s.outcome === "likely_exempt" || s.outcome === "likely_meets" || s.outcome === "at_risk" || s.outcome === "needs_review").length;
  const awareYes = states.filter((s) => s.awareBefore === "yes").length;
  const awareNo = states.filter((s) => s.awareBefore === "no").length;
  const calls = [...projection.calls.values()];
  const pendingCalls = calls.filter((x) => !TERMINAL.has(x.status));
  const work = [...projection.work.values()];
  const declaredAt = projection.timeline[0]?.at ?? null;
  const verdicts = states.map((s) => s.classifiedAt).filter((t): t is string => t !== null).sort();
  const last = verdicts[verdicts.length - 1] ?? null;
  const lastSeconds = declaredAt && last ? Math.round((Date.parse(last) - Date.parse(declaredAt)) / 1000) : null;
  const label = (code: ExemptionCode): string => projection.exemptionLabels[code] ?? code;

  const lines: string[] = [];
  lines.push(`# Outreach report: ${c?.title ?? "campaign"}`);
  lines.push("");
  lines.push(`- State: ${projection.stateName ?? "n/a"}; calls placed on behalf of ${projection.callerOrg ?? "n/a"}`);
  lines.push(`- Campaign: ${c?.id ?? "n/a"}, as of ${c?.asOf ?? "n/a"}, rules ${c?.rulesId ?? "n/a"}`);
  lines.push(`- Mode: ${projection.mode ?? "n/a"}${projection.mode === "dry-run" ? " (no real calls were placed; conversations were simulated by the local fake CALL-E server)" : ""}`);
  if (pendingCalls.length > 0 || projection.failedWaves.length > 0) {
    lines.push(`- Status: **incomplete**. ${pendingCalls.length} call(s) still pending and ${projection.failedWaves.reduce((n, f) => n + f.personIds.length, 0)} call task(s) not accepted by CALL-E. Run \`resume --campaign-id ${c?.id ?? ""}\`.`);
  }
  lines.push("- Nothing in this report changes anyone's coverage. Every exemption is \"may qualify\" until a caseworker reviews it.");
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push("| Measure | People |");
  lines.push("| --- | --- |");
  lines.push(`| On the outreach list | ${states.length} |`);
  lines.push(`| ${OUTCOME_LABEL.cleared_by_data} | ${by("cleared_by_data").length} |`);
  lines.push(`| Called | ${called} |`);
  lines.push(`| Screened by phone | ${screened} |`);
  lines.push(`| Had not heard of the rule before the call | ${awareNo} of ${awareYes + awareNo} who answered (${pct(awareNo, awareYes + awareNo)}) |`);
  for (const o of ["likely_exempt", "likely_meets", "at_risk", "needs_review", "declined", "opted_out", "identity_unconfirmed", "unreachable", "unverified", "not_attempted"] as const) {
    lines.push(`| ${OUTCOME_LABEL[o]} | ${by(o).length} |`);
  }
  lines.push(`| Awaiting a result | ${pending.length} |`);
  lines.push(`| Outside the due window, not in this campaign | ${projection.excludedNotDue} |`);
  lines.push(`| CALL-E calls placed | ${calls.length} |`);
  lines.push(`| Worklist items | ${work.length} (${work.filter((w) => w.needsHumanReview).length} need caseworker review, ${work.filter((w) => w.kind === "correction_call").length} correction calls) |`);
  lines.push(`| Time to last result | ${fmtSeconds(lastSeconds)} |`);
  lines.push("");

  lines.push("## Awareness");
  lines.push("");
  lines.push(`Of the ${awareYes + awareNo} people who confirmed their identity and answered the question, ${awareNo} had not heard of the rule before this call. In Arkansas in 2018, a third of the people subject to that state's work requirement had never heard of it (Sommers et al., NEJM 2019).`);
  lines.push("");

  const codes = new Set<ExemptionCode>();
  for (const s of states) {
    if (s.outcome === "likely_exempt" || s.outcome === "cleared_by_data") {
      for (const code of s.exemptions) {
        codes.add(code);
      }
    }
  }
  lines.push("## Exemptions");
  lines.push("");
  if (codes.size === 0) {
    lines.push("No exemption was supported by the answers or the state's records.");
  } else {
    lines.push("| Exemption | May qualify, from the call | Already shown by state records |");
    lines.push("| --- | --- | --- |");
    for (const code of codes) {
      lines.push(`| ${label(code)} | ${by("likely_exempt").filter((s) => s.exemptions.includes(code)).length} | ${by("cleared_by_data").filter((s) => s.exemptions.includes(code)).length} |`);
    }
  }
  lines.push("");

  lines.push("## By language");
  lines.push("");
  lines.push("| Language | On the list | Screened | Had not heard of the rule |");
  lines.push("| --- | --- | --- | --- |");
  const languages = new Map<string, PersonState[]>();
  for (const s of states) {
    const lang = languageName(projection.people.get(s.personId)?.locale ?? "en-US");
    languages.set(lang, [...(languages.get(lang) ?? []), s]);
  }
  for (const [lang, list] of languages) {
    const scr = list.filter((s) => ["likely_exempt", "likely_meets", "at_risk", "needs_review"].includes(s.outcome ?? "")).length;
    lines.push(`| ${lang} | ${list.length} | ${scr} | ${list.filter((s) => s.awareBefore === "no").length} |`);
  }
  lines.push("");

  lines.push("## Worklist");
  lines.push("");
  if (work.length === 0) {
    lines.push("No worklist items.");
  } else {
    lines.push("| Item | Kind | Person | Check month | High priority | Needs review | Reviewed |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    const ordered = [...work].sort((a, b) => Number(b.highPriority) - Number(a.highPriority) || a.kind.localeCompare(b.kind));
    for (const w of ordered) {
      const person = projection.people.get(w.personId);
      lines.push(`| ${w.id} | ${w.kind.replace(/_/g, " ")} | ${person?.name ?? w.personId} | ${formatMonth(w.checkDate)} | ${w.highPriority ? "yes" : "no"} | ${w.needsHumanReview ? "yes" : "no"} | ${w.reviewedAt ?? "-"} |`);
    }
  }
  lines.push("");

  const corrections = work.filter((w) => w.kind === "correction_call");
  if (corrections.length > 0) {
    lines.push("## Corrections");
    lines.push("");
    lines.push("The automated call told these people more than their answers support. A person calls them back before anything else happens.");
    lines.push("");
    for (const w of corrections) {
      lines.push(`- ${w.summary}`);
    }
    lines.push("");
  }

  const section = (title: string, list: PersonState[]): void => {
    if (list.length === 0) {
      return;
    }
    lines.push(`## ${title}`);
    lines.push("");
    for (const s of list) {
      const person = projection.people.get(s.personId);
      lines.push(`### ${person?.name ?? s.personId} (${maskPhone(person?.phone ?? "")}, ${languageName(person?.locale ?? "en-US")}, check ${formatMonth(person?.checkDate ?? null)})`);
      lines.push("");
      lines.push(`- Result: **${s.outcome ? OUTCOME_LABEL[s.outcome] : "awaiting a result"}** after ${s.attempts} call${s.attempts === 1 ? "" : "s"}`);
      if (s.reasons.length > 0) {
        lines.push(`- Why: ${s.reasons.join("; ")}`);
      }
      if (s.exemptions.length > 0) {
        lines.push(`- Exemption: ${s.exemptions.map(label).join("; ")}`);
      }
      if (s.agentSaid && s.agentSaid !== "nothing") {
        lines.push(`- The agent told them: ${s.agentSaid.replace(/_/g, " ")}`);
      }
      if (s.awareBefore) {
        lines.push(`- Had heard of the rule before the call: ${s.awareBefore}`);
      }
      if (s.lastSummary) {
        lines.push(`- Call summary: ${s.lastSummary}`);
      }
      for (const quote of s.evidence.slice(-2)) {
        lines.push(`- In their words: "${quote}"`);
      }
      if (s.nextAction) {
        lines.push(`- Next: ${s.nextAction.type} (${s.nextAction.reason})${s.followUpDueAt ? `, due ${s.followUpDueAt}` : ""}`);
      }
      lines.push("");
    }
  };
  section("At risk", by("at_risk"));
  section("Needs a navigator's review", by("needs_review"));
  section("May qualify for an exemption", by("likely_exempt"));
  section("May already meet the requirement", by("likely_meets"));
  section("Not screened yet", [...by("identity_unconfirmed"), ...by("unreachable"), ...by("unverified")]);
  section("Asked to be called later", by("declined"));
  section("Asked not to be called again", by("opted_out"));
  section("Not attempted", by("not_attempted"));
  section("Awaiting a result", pending);

  const cleared = by("cleared_by_data");
  if (cleared.length > 0) {
    lines.push("## Cleared by state data");
    lines.push("");
    for (const s of cleared) {
      lines.push(`- ${projection.people.get(s.personId)?.name ?? s.personId}: ${s.reasons[0] ?? "cleared"}`);
    }
    lines.push("");
  }

  lines.push("## CALL-E platform observations");
  lines.push("");
  const failed = calls.filter((x) => TERMINAL.has(x.status) && x.status !== "completed");
  const lowConfidence = calls.filter((x) => x.confidenceLabel !== null && x.confidenceLabel.toLowerCase() === "low");
  const slow = calls.flatMap((x) => x.firstBotTurnOffsets.map((o, i) => ({ who: x.recipients[i]?.maskedPhone ?? "?", o }))).filter((x) => x.o !== null && x.o >= 15);
  const retries = projection.timeline.filter((t) => t.message.includes("did not accept") && t.message.includes("retry")).length;
  lines.push(`- Calls: ${calls.length}; ${failed.length} did not complete${failed.length > 0 ? ` (${failed.map((f) => `${f.callId}: ${f.failureCode ?? f.status}`).join(", ")})` : ""}; ${pendingCalls.length} still pending.`);
  lines.push(`- Create requests retried after a platform error: ${retries}.`);
  lines.push(`- Completed calls with no usable structured result: ${by("unverified").length}.`);
  lines.push(`- Calls with low completion confidence: ${lowConfidence.length}.`);
  lines.push(`- Recipients whose first bot turn started 15 s or more after connect: ${slow.length}${slow.length > 0 ? ` (${slow.map((x) => `${x.who} at ${x.o}s`).join(", ")})` : ""}.`);
  lines.push("");

  lines.push("## Data handling");
  lines.push("");
  lines.push("Phone numbers are masked in this report and in the ledger timeline; full numbers stay in the program's own enrollee file. The birth year is sent to CALL-E only so the agent can confirm identity before saying anything about coverage, and it is never spoken. No diagnosis, medication or immigration detail is asked for or recorded. In production this runs under the program's data agreement with its telephony provider; purge the campaign folder once the worklist is closed.");
  lines.push("");
  return lines.join("\n");
}
