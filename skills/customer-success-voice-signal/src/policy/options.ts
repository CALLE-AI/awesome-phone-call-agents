import type { DecisionOption, TriggerId } from "../schemas.js";

const OPTION_SETS: Record<TriggerId, DecisionOption[]> = {
  stuck_support: [
    {
      option_id: "1",
      decision: "take_over_chat",
      decision_label: "Take over in chat now",
    },
    {
      option_id: "2",
      decision: "assign_se",
      decision_label: "Assign to SE / specialist",
    },
    {
      option_id: "3",
      decision: "snooze_2h",
      decision_label: "Not now — snooze 2 hours",
    },
  ],
  sla_risk: [
    {
      option_id: "1",
      decision: "own_ticket",
      decision_label: "I own this ticket now",
    },
    {
      option_id: "2",
      decision: "page_backup",
      decision_label: "Page backup CS/SE",
    },
    {
      option_id: "3",
      decision: "accept_risk",
      decision_label: "Acknowledge risk, no action",
    },
  ],
  agent_needs_decision: [
    {
      option_id: "1",
      decision: "approve_a",
      decision_label: "Approve A — allow the one-time exception",
    },
    {
      option_id: "2",
      decision: "approve_b",
      decision_label: "Approve B — require the signed amendment first",
    },
    {
      option_id: "3",
      decision: "reject_escalate",
      decision_label: "Reject — escalate to manager",
    },
  ],
  health_onboarding: [
    {
      option_id: "1",
      decision: "book_se_session",
      decision_label: "Book SE technical session",
    },
    {
      option_id: "2",
      decision: "watchlist",
      decision_label: "Mark watchlist — no outreach yet",
    },
    {
      option_id: "3",
      decision: "flag_churn_risk",
      decision_label: "Flag churn risk for manager",
    },
  ],
};

/** Closed-set line readings for a cue. */
export function pickOptions(triggerId: TriggerId): DecisionOption[] {
  return OPTION_SETS[triggerId].map((o) => ({ ...o }));
}

export function getAllOptionSets(): Record<TriggerId, DecisionOption[]> {
  return {
    stuck_support: pickOptions("stuck_support"),
    sla_risk: pickOptions("sla_risk"),
    agent_needs_decision: pickOptions("agent_needs_decision"),
    health_onboarding: pickOptions("health_onboarding"),
  };
}
