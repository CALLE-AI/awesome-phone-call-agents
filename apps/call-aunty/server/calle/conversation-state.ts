export type ConversationState =
  | "greeting"
  | "identity_check"
  | "purpose_confirmation"
  | "information_exchange"
  | "appointment_discussion"
  | "concern_detection"
  | "action_confirmation"
  | "closing"
  | "escalation"
  | "voicemail"
  | "terminated";

export type ConversationEvent =
  | "start"
  | "identity_verified"
  | "purpose_acknowledged"
  | "info_collected"
  | "appointment_topic"
  | "concern_detected"
  | "action_confirmed"
  | "close_requested"
  | "escalate"
  | "voicemail_detected"
  | "provider_interrupt"
  | "timeout";

const LEGAL: Record<ConversationState, readonly ConversationState[]> = {
  greeting: ["identity_check", "escalation", "terminated", "voicemail"],
  identity_check: ["purpose_confirmation", "escalation", "terminated", "voicemail"],
  purpose_confirmation: [
    "information_exchange",
    "appointment_discussion",
    "escalation",
    "terminated",
    "voicemail",
  ],
  information_exchange: ["appointment_discussion", "concern_detection", "action_confirmation", "escalation", "closing"],
  appointment_discussion: ["action_confirmation", "concern_detection", "closing", "escalation"],
  concern_detection: ["escalation", "information_exchange", "action_confirmation"],
  action_confirmation: ["closing", "information_exchange", "escalation"],
  closing: ["terminated"],
  escalation: ["terminated"],
  voicemail: ["terminated"],
  terminated: [],
};

export function canTransitionConversation(from: ConversationState, to: ConversationState): boolean {
  if (from === to) return true;
  return LEGAL[from].includes(to);
}

export function assertConversationTransition(from: ConversationState, to: ConversationState): void {
  if (!canTransitionConversation(from, to)) {
    throw new Error(`Illegal conversation transition: ${from} -> ${to}`);
  }
}

export function reduceConversationState(
  state: ConversationState,
  event: ConversationEvent,
): ConversationState {
  const next = transitionTable(state, event);
  assertConversationTransition(state, next);
  return next;
}

function transitionTable(state: ConversationState, event: ConversationEvent): ConversationState {
  if (event === "escalate") return "escalation";
  if (event === "voicemail_detected") return "voicemail";
  if (event === "timeout" && state === "closing") return "terminated";

  switch (state) {
    case "greeting":
      if (event === "start") return "identity_check";
      break;
    case "identity_check":
      if (event === "identity_verified") return "purpose_confirmation";
      break;
    case "purpose_confirmation":
      if (event === "purpose_acknowledged") return "information_exchange";
      break;
    case "information_exchange":
      if (event === "appointment_topic") return "appointment_discussion";
      if (event === "concern_detected") return "concern_detection";
      if (event === "action_confirmed") return "action_confirmation";
      if (event === "close_requested") return "closing";
      break;
    case "appointment_discussion":
      if (event === "action_confirmed") return "action_confirmation";
      if (event === "concern_detected") return "concern_detection";
      if (event === "close_requested") return "closing";
      break;
    case "concern_detection":
      if (event === "info_collected") return "information_exchange";
      break;
    case "action_confirmation":
      if (event === "close_requested") return "closing";
      break;
    case "closing":
      if (event === "close_requested") return "terminated";
      break;
    case "escalation":
    case "voicemail":
      return "terminated";
    case "terminated":
      return "terminated";
  }

  return state;
}

export function isTerminalConversation(state: ConversationState): boolean {
  return state === "terminated";
}

/** In-memory conversation pointer keyed by workflow id (simulator / demo). */
const conversationPointers = new Map<string, ConversationState>();

export function getConversationState(workflowId: string): ConversationState {
  return conversationPointers.get(workflowId) ?? "greeting";
}

export function advanceConversation(workflowId: string, event: ConversationEvent): ConversationState {
  const current = getConversationState(workflowId);
  const next = reduceConversationState(current, event);
  conversationPointers.set(workflowId, next);
  return next;
}

export function resetConversation(workflowId: string) {
  conversationPointers.delete(workflowId);
}
