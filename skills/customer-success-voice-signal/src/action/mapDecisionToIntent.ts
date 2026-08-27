import type { AccountEvent, DecisionResult } from "../schemas.js";
import type { RingMode } from "../policy/shouldRing.js";
import { ActionIntentSchema, type ActionIntent, type AdapterHint } from "./types.js";

const PLANNED: AdapterHint[] = [
  "zendesk_ticket_note",
  "salesforce_task",
  "slack_webhook",
  "internal_queue",
];

interface ActionSpec {
  action: string;
  adapter: AdapterHint;
  followUpHours?: number;
  note: string;
}

const DECISION_ACTIONS: Record<string, ActionSpec> = {
  take_over_chat: {
    action: "assign_owner_to_ticket_and_post_note",
    adapter: "zendesk_ticket_note",
    note: "CS owner takes the thread in chat/support.",
  },
  assign_se: {
    action: "create_se_assignment_task",
    adapter: "salesforce_task",
    note: "Route to SE / specialist queue.",
  },
  snooze_2h: {
    action: "schedule_follow_up",
    adapter: "internal_queue",
    followUpHours: 2,
    note: "Snooze cue; re-check in two hours.",
  },
  own_ticket: {
    action: "claim_ticket_ownership",
    adapter: "zendesk_ticket_note",
    note: "CS owner owns the SLA ticket now.",
  },
  page_backup: {
    action: "page_backup_owner",
    adapter: "slack_webhook",
    note: "Notify backup CS/SE via ops channel.",
  },
  accept_risk: {
    action: "log_risk_acceptance",
    adapter: "zendesk_ticket_note",
    note: "Acknowledge SLA risk with no immediate action.",
  },
  approve_a: {
    action: "record_policy_exception_a",
    adapter: "zendesk_ticket_note",
    note: "One-time exception approved.",
  },
  approve_b: {
    action: "require_signed_amendment",
    adapter: "salesforce_task",
    note: "Block until signed amendment.",
  },
  reject_escalate: {
    action: "escalate_to_manager",
    adapter: "slack_webhook",
    note: "Reject and escalate.",
  },
  book_se_session: {
    action: "book_se_technical_session",
    adapter: "salesforce_task",
    note: "Schedule SE technical session.",
  },
  watchlist: {
    action: "mark_account_watchlist",
    adapter: "salesforce_task",
    note: "Watchlist only — no outreach yet.",
  },
  flag_churn_risk: {
    action: "flag_churn_risk_for_manager",
    adapter: "slack_webhook",
    note: "Surface churn risk to manager.",
  },
};

/** True when this decision should emit an executable action intent. */
export function shouldEmitActionIntent(result: DecisionResult): boolean {
  if (result.option_id === "hold" || result.option_id === "unknown") return false;
  if (result.decision === "hold" || result.decision === "failure") return false;
  if (result.decision === "unclear" || result.decision === "no_answer") return false;
  if (result.decision === "queued") return false;
  return result.option_id === "1" || result.option_id === "2" || result.option_id === "3";
}

/**
 * Map a closed-set CS decision → action intent (system handoff contract).
 * Does not call external APIs — that is `apply-action`.
 */
export function buildActionIntent(input: {
  event: AccountEvent;
  result: DecisionResult;
  mode: RingMode;
  now?: Date;
}): ActionIntent | null {
  if (!shouldEmitActionIntent(input.result)) return null;

  const spec = DECISION_ACTIONS[input.result.decision];
  if (!spec) return null;

  const now = input.now ?? new Date();
  const follow_up_at = spec.followUpHours
    ? new Date(now.getTime() + spec.followUpHours * 3600_000).toISOString()
    : null;

  const intent_id = `act_${input.result.trigger_id}_${input.event.account.id}_${now.getTime()}`;

  return ActionIntentSchema.parse({
    intent_id,
    at: now.toISOString(),
    status: "pending",
    mode: input.mode,
    trigger_id: input.result.trigger_id,
    account_id: input.result.account_id,
    account_name: input.result.account_name,
    cs_owner_id: input.result.cs_owner_id,
    ticket_id: input.event.ticket_id ?? null,
    call_run_id: input.result.call_run_id,
    option_id: input.result.option_id,
    decision: input.result.decision,
    decision_label: input.result.decision_label,
    action: spec.action,
    adapter: spec.adapter,
    adapters_planned: PLANNED,
    follow_up_at,
    payload: {
      account_id: input.result.account_id,
      account_name: input.result.account_name,
      ticket_id: input.event.ticket_id ?? null,
      cs_owner_id: input.result.cs_owner_id,
      trigger_id: input.result.trigger_id,
      decision: input.result.decision,
      decision_label: input.result.decision_label,
      call_run_id: input.result.call_run_id,
      follow_up_at,
      source_event_id: input.event.event_id,
    },
    notes: spec.note,
  });
}
