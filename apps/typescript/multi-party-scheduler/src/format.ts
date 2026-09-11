/**
 * Human-readable output. The availability grid is the point of the plan and the
 * replay: it shows which options each party was even asked about, because the
 * blanks are calls and call time that were never spent.
 */

import { worstCaseCalls } from "./config.js";
import { maskPhone } from "./coordinate.js";
import { confirmSchema, confirmTask, gatherSchema, gatherTask, releaseTask } from "./script.js";
import type { CoordinationRequest, LedgerEntry, RunResult, Slot } from "./types.js";

function pad(text: string, width: number): string {
  return text.length >= width ? text : `${text}${" ".repeat(width - text.length)}`;
}

/**
 * The request as it goes into `--json`, with numbers masked the way the ledger
 * masks them. JSON output is what people paste into an issue or a log, so it gets
 * the same treatment as everything else that leaves the process.
 */
export function redactRequest(request: CoordinationRequest): CoordinationRequest {
  return {
    ...request,
    parties: request.parties.map((party) => ({ ...party, phone: maskPhone(party.phone) })),
  };
}

export function renderPlan(request: CoordinationRequest): string {
  const lines: string[] = [];
  lines.push("Plan only. No call is placed and no credentials are used.");
  lines.push("");
  lines.push(`Request     ${request.requestId}`);
  lines.push(`Purpose     ${request.meeting.purpose}`);
  lines.push(`Where       ${request.meeting.location}`);
  lines.push(`Length      ${request.meeting.duration_minutes} minutes`);
  lines.push(`Timezone    ${request.meeting.timezone}`);
  lines.push(
    `Policy      ${request.policy.windowMinutes} minute window, ${request.policy.perCallTimeoutSeconds}s per call, at most ${request.policy.maxCalls} calls`,
  );
  lines.push("");
  lines.push("Options");
  for (const slot of request.slots) {
    lines.push(`  ${slot.spoken}`);
  }
  lines.push("");
  lines.push("Call order, one gather call each, then one confirm call each");
  for (const [index, party] of request.parties.entries()) {
    lines.push(
      `  ${index + 1}. ${party.name} (${party.role}) ${maskPhone(party.phone)}, callable ${party.callingHours.start} to ${party.callingHours.end} ${party.callingHours.timezone}, consent recorded`,
    );
  }
  lines.push("");
  lines.push(
    `Call budget  ${request.parties.length} to gather, ${request.parties.length} to confirm, up to ${Math.max(request.parties.length - 1, 0)} to release. Worst case ${worstCaseCalls(request)}, best case ${request.parties.length + 1} when the first answer rules everything out.`,
  );
  lines.push("");
  lines.push(`Gather script for ${request.parties[0]!.id}`);
  lines.push("");
  for (const line of gatherTask(request, request.parties[0]!, request.slots).split("\n")) {
    lines.push(line.length === 0 ? "" : `  ${line}`);
  }
  lines.push("");
  lines.push(`Confirm script, shown for ${request.slots[0]!.id}`);
  lines.push("");
  for (const line of confirmTask(request, request.parties[0]!, request.slots[0]!).split("\n")) {
    lines.push(line.length === 0 ? "" : `  ${line}`);
  }
  lines.push("");
  lines.push(`Release script, used only when a confirm call fails`);
  lines.push("");
  for (const line of releaseTask(request, request.parties[0]!, request.slots[0]!).split("\n")) {
    lines.push(line.length === 0 ? "" : `  ${line}`);
  }
  lines.push("");
  lines.push("Result contracts");
  lines.push(`  gather   ${JSON.stringify(gatherSchema(request.slots.length))}`);
  lines.push(`  confirm  ${JSON.stringify(confirmSchema())}`);
  lines.push("");
  lines.push("Nothing above has been sent anywhere. Add --live to place calls.");
  return lines.join("\n");
}

/** The grid, built from a ledger. A dash means the option was already ruled out. */
export function renderMatrix(entries: LedgerEntry[]): string {
  const started = entries.find((entry) => entry.kind === "run_started");
  if (started === undefined || started.kind !== "run_started") {
    return "No run_started entry, nothing to draw.";
  }
  const slots: Slot[] = started.slots;
  const nameWidth = Math.max(
    12,
    ...entries
      .filter((entry) => entry.kind === "gather")
      .map((entry) => (entry.kind === "gather" ? entry.result.party_id.length + 2 : 0)),
  );
  const lines: string[] = [];
  lines.push(
    `${pad("party", nameWidth)}${slots.map((slot) => pad(`opt${slot.option}`, 7)).join("")}`.trimEnd(),
  );
  for (const entry of entries) {
    if (entry.kind !== "gather") {
      continue;
    }
    const offered = new Set(entry.feasible_before);
    const available = new Set(
      entry.result.available_options
        .map((option) => slots.find((slot) => slot.option === option)?.id)
        .filter((id): id is string => id !== undefined),
    );
    const cells = slots.map((slot) => {
      if (!offered.has(slot.id)) {
        return pad("-", 7);
      }
      if (!entry.result.reached_person) {
        return pad("?", 7);
      }
      return pad(available.has(slot.id) ? "yes" : "no", 7);
    });
    lines.push(`${pad(entry.result.party_id, nameWidth)}${cells.join("")}`.trimEnd());
  }
  const chosen = entries.find((entry) => entry.kind === "slot_chosen");
  if (chosen !== undefined && chosen.kind === "slot_chosen") {
    const slot = slots.find((candidate) => candidate.id === chosen.slot_id);
    lines.push("");
    lines.push(`chosen  ${slot?.spoken ?? chosen.slot_id}`);
  }
  lines.push("");
  lines.push("dash means the option was already ruled out, so nobody was asked about it");
  return lines.join("\n");
}

export function renderResult(result: RunResult): string {
  const lines: string[] = [];
  lines.push(`Outcome      ${result.outcome}`);
  if (result.slot_spoken !== null) {
    lines.push(`Agreed       ${result.slot_spoken}`);
    lines.push(`With         ${result.confirmed_with.join(", ")}`);
    lines.push("             every party said yes on a call. Nothing is booked in any system.");
  }
  if (result.unreleased.length > 0) {
    lines.push(`Follow up    ${result.unreleased.join(", ")} confirmed but could not be told it is off`);
  }
  lines.push(`Calls        ${result.calls_placed} placed, ${result.calls_saved} saved against the worst case`);
  if (result.note.length > 0) {
    lines.push(`Note         ${result.note}`);
  }
  if (result.ledger_path !== null) {
    lines.push(`Ledger       ${result.ledger_path}`);
  }
  return lines.join("\n");
}
