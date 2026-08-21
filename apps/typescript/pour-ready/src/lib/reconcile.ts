import {
  ROLE_LABELS,
  ROLES,
  type CallSnapshot,
  type ContactRole,
  type Reconciliation,
} from "./domain";

function hasBlocker(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !["", "none", "no blocker", "n/a", "not applicable"].includes(
    normalized,
  );
}

function callIsIncomplete(call: CallSnapshot): boolean {
  const result = call.result;
  return (
    call.status !== "completed" ||
    !result ||
    call.taskCompleted !== true ||
    call.completionConfidence?.label.toLowerCase() !== "high" ||
    result.contact_outcome !== "reached" ||
    result.commitment === "unknown" ||
    result.schedule_alignment === "unknown" ||
    result.scope_alignment === "unknown"
  );
}

function conflictMessages(call: CallSnapshot): string[] {
  const result = call.result;
  if (!result) return [];
  const label = ROLE_LABELS[call.role];
  const messages: string[] = [];
  if (result.schedule_alignment === "conflict") {
    messages.push(
      `${label} reported ${result.reported_time || "a different time"}.`,
    );
  }
  if (result.scope_alignment === "conflict") {
    messages.push(`${label} reported a scope or reference mismatch.`);
  }
  if (result.commitment === "conditional") {
    messages.push(`${label} gave only a conditional confirmation.`);
  }
  if (result.commitment === "declined") {
    messages.push(`${label} did not confirm participation.`);
  }
  if (hasBlocker(result.blocker)) {
    messages.push(`${label}: ${result.blocker}`);
  }
  return messages;
}

export function reconcile(calls: CallSnapshot[]): Reconciliation {
  const byRole = new Map(calls.map((call) => [call.role, call]));
  const incompleteRoles: ContactRole[] = ROLES.filter((role) => {
    const call = byRole.get(role);
    return !call || callIsIncomplete(call);
  });
  const conflicts = [
    ...new Set(calls.flatMap((call) => conflictMessages(call))),
  ];
  const conflictingRoles = calls.filter(
    (call) => conflictMessages(call).length > 0,
  ).length;

  if (conflicts.length > 0) {
    return {
      state: "conflict",
      headline: "The call plan is not aligned",
      detail:
        incompleteRoles.length > 0
          ? `${conflictingRoles} role${conflictingRoles === 1 ? "" : "s"} reported explicit conflicts; ${incompleteRoles.length} role${incompleteRoles.length === 1 ? "" : "s"} also need review.`
          : `${conflictingRoles} role${conflictingRoles === 1 ? "" : "s"} reported explicit conflicts that the project team must resolve.`,
      conflicts,
      incompleteRoles,
    };
  }

  if (incompleteRoles.length > 0) {
    return {
      state: "incomplete",
      headline: "Evidence is incomplete",
      detail: `${incompleteRoles.length} of ${ROLES.length} required role${incompleteRoles.length === 1 ? "" : "s"} did not produce a clear, high-confidence confirmation.`,
      conflicts: [],
      incompleteRoles,
    };
  }

  return {
    state: "aligned",
    headline: "All verbal confirmations align",
    detail:
      "Every required role confirmed the existing schedule and scope. A human still owns the proceed or hold decision.",
    conflicts: [],
    incompleteRoles: [],
  };
}
