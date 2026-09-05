// After-action report. Rebuilt from the ledger, so it is reproducible and every number
// in it can be traced to a line in the JSONL file. Phone numbers are masked throughout.

import type { Projection } from "./ledger.js";
import { maskPhone } from "./mask.js";
import type { Outcome, PersonState } from "./types.js";

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`;
}

function secondsBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) {
    return null;
  }
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000);
}

function fmtSeconds(s: number | null): string {
  if (s === null) {
    return "n/a";
  }
  if (s < 90) {
    return `${s}s`;
  }
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function buildReport(projection: Projection): string {
  const event = projection.event;
  const states = [...projection.states.values()];
  const byOutcome = (o: Outcome): PersonState[] => states.filter((s) => s.outcome === o);
  const total = states.length;
  const reached = states.filter((s) => s.outcome === "green" || s.outcome === "yellow" || s.outcome === "red").length;
  const calls = [...projection.calls.values()];
  const waveCalls = calls.filter((c) => c.kind === "wave");
  const escalationCalls = calls.filter((c) => c.kind === "escalation");
  const dispatches = [...projection.dispatches.values()];
  const declaredAt = projection.timeline[0]?.at ?? null;
  const verdictTimes = states.map((s) => s.classifiedAt).filter((t): t is string => t !== null).sort();
  const firstVerdict = secondsBetween(declaredAt, verdictTimes[0] ?? null);
  const lastVerdict = secondsBetween(declaredAt, verdictTimes[verdictTimes.length - 1] ?? null);

  const lines: string[] = [];
  lines.push(`# After-action report: ${event?.headline ?? "roll call"}`);
  lines.push("");
  lines.push(`- Area: ${event?.area ?? "n/a"}`);
  lines.push(`- Hazard playbook: ${event?.hazard ?? "n/a"}`);
  lines.push(`- Declared: ${declaredAt ?? "n/a"} (source: ${event?.source ?? "n/a"})`);
  lines.push(`- Organisation: ${event?.org ?? "n/a"}`);
  lines.push(`- Mode: ${projection.mode ?? "n/a"}${projection.mode === "dry-run" ? " (no real calls were placed; conversations were simulated by the local fake CALL-E server)" : ""}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| --- | --- |");
  lines.push(`| People on the registry (consented) | ${total} |`);
  lines.push(`| Reached (a person or caregiver spoke) | ${reached} (${pct(reached, total)}) |`);
  lines.push(`| Green | ${byOutcome("green").length} |`);
  lines.push(`| Yellow (follow-up due) | ${byOutcome("yellow").length} |`);
  lines.push(`| Red (human escalation) | ${byOutcome("red").length} |`);
  lines.push(`| Unreachable | ${byOutcome("unreachable").length} |`);
  lines.push(`| Unverified (answered, facts not established) | ${byOutcome("unverified").length} |`);
  lines.push(`| Wave call tasks placed | ${waveCalls.length} |`);
  lines.push(`| Escalation calls to contacts | ${escalationCalls.length} |`);
  lines.push(`| Dispatch tickets | ${dispatches.length} (${dispatches.filter((d) => d.needsHumanApproval).length} need human approval) |`);
  lines.push(`| Time to first verdict | ${fmtSeconds(firstVerdict)} |`);
  lines.push(`| Time to last verdict | ${fmtSeconds(lastVerdict)} |`);
  lines.push("");

  const section = (title: string, outcome: Outcome, empty: string): void => {
    lines.push(`## ${title}`);
    lines.push("");
    const list = byOutcome(outcome);
    if (list.length === 0) {
      lines.push(empty);
      lines.push("");
      return;
    }
    for (const state of list) {
      const person = projection.people.get(state.personId);
      lines.push(`### ${person?.name ?? state.personId} (${maskPhone(person?.phone ?? "")}, priority ${state.priority}, risk ${state.riskScore})`);
      lines.push("");
      lines.push(`- Verdict: **${state.outcome}**${state.agentTier && state.agentTier !== state.outcome ? ` (agent said ${state.agentTier})` : ""}`);
      lines.push(`- Why: ${state.reasons.join("; ")}`);
      if (state.lastSummary) {
        lines.push(`- Call summary: ${state.lastSummary}`);
      }
      for (const quote of state.evidence.slice(0, 2)) {
        lines.push(`- In their words: "${quote}"`);
      }
      if (state.nextAction) {
        lines.push(`- Next action: ${state.nextAction.type} (${state.nextAction.reason})${state.followUpDueAt ? `, due ${state.followUpDueAt}` : ""}`);
      }
      if (state.contactResult) {
        lines.push(`- Emergency contact: reached=${state.contactResult.reached}, will_check=${state.contactResult.will_check}, ETA ${state.contactResult.eta_minutes} min, wants emergency services=${state.contactResult.wants_emergency_services}`);
      } else if (state.contactCalled) {
        lines.push("- Emergency contact: called, no usable answer");
      }
      lines.push("");
    }
  };

  section("Red: warning signs reported", "red", "Nobody reported red-flag symptoms.");
  section("Unreachable", "unreachable", "Everyone was reached.");
  section("Unverified", "unverified", "Every completed call established the facts.");
  section("Yellow: follow-up due", "yellow", "Nobody needed a follow-up.");

  lines.push("## Dispatch tickets");
  lines.push("");
  if (dispatches.length === 0) {
    lines.push("No dispatch tickets were created.");
  } else {
    lines.push("| Ticket | Kind | Person | ETA | Needs approval | Approved |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const ticket of dispatches) {
      const person = projection.people.get(ticket.personId);
      lines.push(`| ${ticket.id} | ${ticket.kind} | ${person?.name ?? ticket.personId} | ${ticket.etaMinutes !== null ? `${ticket.etaMinutes} min` : "-"} | ${ticket.needsHumanApproval ? "yes" : "no"} | ${ticket.approvedAt ?? "-"} |`);
    }
  }
  lines.push("");

  lines.push("## Green");
  lines.push("");
  const greens = byOutcome("green");
  lines.push(greens.length === 0 ? "Nobody was classified green." : greens.map((s) => `- ${projection.people.get(s.personId)?.name ?? s.personId} (${maskPhone(projection.people.get(s.personId)?.phone ?? "")})`).join("\n"));
  lines.push("");

  lines.push("## CALL-E platform observations");
  lines.push("");
  const slow = calls.flatMap((c) => c.firstBotTurnOffsets.map((o, i) => ({ call: c.callId, recipient: c.recipients[i]?.maskedPhone ?? "?", offset: o }))).filter((x) => x.offset !== null && x.offset >= 15);
  const nullResults = states.filter((s) => s.outcome === "unverified").length;
  const failures = calls.filter((c) => c.status !== "completed");
  const lowConfidence = calls.filter((c) => c.confidenceLabel !== null && c.confidenceLabel.toLowerCase() === "low");
  lines.push(`- Call tasks: ${calls.length} (${waveCalls.length} wave, ${escalationCalls.length} escalation); ${failures.length} did not complete${failures.length > 0 ? ` (${failures.map((f) => `${f.callId}: ${f.failureCode ?? f.status}`).join(", ")})` : ""}.`);
  lines.push(`- Completed calls with no usable structured result: ${nullResults}.`);
  lines.push(`- Calls with low completion confidence: ${lowConfidence.length}.`);
  lines.push(`- Recipients whose first bot turn started 15 s or more after connect: ${slow.length}${slow.length > 0 ? ` (${slow.map((s) => `${s.recipient} at ${s.offset}s`).join(", ")})` : ""}.`);
  lines.push("");

  lines.push("## Data handling");
  lines.push("");
  lines.push("Phone numbers are masked in this report and in the ledger timeline. Full numbers live only in the operator's registry file. Transcript excerpts are limited to the person's own words and should be purged with the ledger once the event is closed and reviewed.");
  lines.push("");
  return lines.join("\n");
}
