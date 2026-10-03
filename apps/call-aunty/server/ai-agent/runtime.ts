import { classifyIntent } from "./intent";
import { evaluateAgentPolicy, planFromIntent } from "./policy";
import { minimizeText, responseFitsChannel } from "./sanitize";
import type { ToolRegistry } from "./tools";
import type {
  AgentContact,
  AgentMessage,
  AgentMode,
  AgentPlan,
  AgentPolicy,
  AgentResponse,
  AgentTurn,
  AgentTurnState,
  ToolInvocation,
} from "./types";

export type CallEAgentOptions = {
  agentId: string;
  mode: AgentMode;
  tools: ToolRegistry;
};

export class CallEAgent {
  private mode: AgentMode;

  constructor(private readonly options: CallEAgentOptions) {
    this.mode = options.mode;
  }

  setMode(mode: AgentMode): void {
    this.mode = mode;
  }

  getMode(): AgentMode {
    return this.mode;
  }

  handle(
    message: AgentMessage,
    contact: AgentContact,
    turnId: string,
    at: string,
    approved = false,
  ): AgentTurn {
    const sanitizedText = minimizeText(message.text);
    const intent = classifyIntent(message.text);
    const policy = evaluateAgentPolicy({ text: message.text, intent, contact });
    const plan = planFromIntent(intent, policy);
    const tools = this.invokePlan(plan, policy, contact.id, approved);
    const state = resolveState(policy, tools, approved);
    const response = buildResponse(intent.name, policy, message.channel, approved);

    return {
      id: turnId,
      state,
      input: { ...message, text: sanitizedText },
      sanitizedText,
      contactId: contact.id,
      intent,
      plan,
      policy,
      tools,
      response,
      at,
    };
  }

  invokePlan(
    plan: AgentPlan,
    policy: AgentPolicy,
    contactId: string,
    approved: boolean,
  ): ToolInvocation[] {
    const dryRun = this.mode !== "assist" || policy.suppressOutreach || !policy.allowed;
    return plan.tools.map((name) => {
      if (policy.suppressOutreach && name === "place_outbound_call") {
        return { name, args: {}, status: "blocked" as const, result: { reason: "outreach-suppressed" } };
      }
      if (!policy.allowed && name === "place_outbound_call") {
        return { name, args: {}, status: "blocked" as const, result: { reason: "policy-denied" } };
      }
      const gated =
        policy.requiresApproval &&
        !approved &&
        (this.options.tools.isSensitive(name) ||
          (policy.approvalAction === "persist_pii" && name === "record_survey_answer") ||
          (policy.approvalAction === "resume_outreach" && name !== "escalate_operator"));
      if (gated) {
        return { name, args: {}, status: "pending_approval" as const };
      }
      return this.options.tools.invoke(name, {}, { contactId, dryRun, approved });
    });
  }
}

function resolveState(policy: AgentPolicy, tools: ToolInvocation[], approved: boolean): AgentTurnState {
  if (policy.escalate) return "escalated";
  if (policy.reasons.includes("respondent-refused")) return "refused";
  if (!policy.allowed) return "blocked";
  if (!approved && (tools.some((tool) => tool.status === "pending_approval") || policy.requiresApproval)) {
    return "awaiting_approval";
  }
  return "completed";
}

function buildResponse(
  intent: AgentTurn["intent"]["name"],
  policy: AgentPolicy,
  channel: AgentTurn["input"]["channel"],
  approved: boolean,
): AgentResponse {
  const text = (() => {
    if (intent === "distress") {
      return "I am connecting you with a person from the care team now. I will not keep asking survey questions.";
    }
    if (intent === "refuse") {
      return "Understood. I will not call or text again about this survey.";
    }
    if (intent === "place_call" && policy.requiresApproval && !approved) {
      return "An operator needs to approve this call before I place it.";
    }
    if (intent === "place_call" && approved) {
      return "The call is queued in dry-run until the live provider is confirmed.";
    }
    if (intent === "pii_share") {
      return "I will keep contact details out of the durable record until an operator reviews them.";
    }
    if (intent === "callback") {
      return "I can note a callback window and wait until then.";
    }
    if (intent === "operator_request") {
      return "I am handing this to a community health worker.";
    }
    if (intent === "greeting") {
      return "Hello. I am the Call Aunty assistant. Is now a good time for a short check-in?";
    }
    if (intent === "survey_assist") {
      return "Thank you. I will ask the next allowed question only.";
    }
    if (intent === "memory_recall") {
      return "I can recall coded answers, not raw notes.";
    }
    return "I can help with a check-in, a callback, or a call that an operator approves first.";
  })();

  return {
    text: responseFitsChannel(text, channel === "sms" ? "sms" : "call"),
    channel,
  };
}
