import { evaluateSafetyText, mustStopAutomation } from "../ai/safety";
import { isSafeCallContent } from "../calle/content-guard";
import type { AgentContact, AgentIntent, AgentPlan, AgentPolicy, AgentToolName } from "./types";

export function evaluateAgentPolicy(input: {
  text: string;
  intent: AgentIntent;
  contact: AgentContact;
}): AgentPolicy {
  const reasons: string[] = [];
  const safety = evaluateSafetyText(input.text);
  const consentOk = input.contact.consentGranted && !input.contact.dnc;
  let risk: AgentPolicy["risk"] = "low";
  let requiresApproval = false;
  let requiredApprovals = 0;
  let escalate = false;
  let suppressOutreach = !consentOk;
  let allowed = true;
  let approvalAction: AgentPolicy["approvalAction"] = null;

  if (!consentOk) {
    reasons.push(input.contact.dnc ? "dnc-listed" : "missing-consent");
    suppressOutreach = true;
  }

  if (mustStopAutomation(safety) || input.intent.name === "distress") {
    risk = "critical";
    escalate = true;
    suppressOutreach = true;
    requiresApproval = true;
    requiredApprovals = 2;
    approvalAction = "resume_outreach";
    reasons.push("safety-stop");
  } else if (input.intent.name === "refuse") {
    allowed = true;
    suppressOutreach = true;
    reasons.push("respondent-refused");
  } else if (input.intent.name === "pii_share") {
    risk = "high";
    requiresApproval = true;
    requiredApprovals = 1;
    approvalAction = "persist_pii";
    reasons.push("pii-requires-operator-ack");
  } else if (input.intent.name === "place_call") {
    if (!consentOk) {
      allowed = false;
      reasons.push("call-blocked-without-consent");
    } else {
      risk = input.contact.triageState === "urgent_in_person_care" ? "critical" : "high";
      requiresApproval = true;
      requiredApprovals = risk === "critical" ? 2 : 1;
      approvalAction = "place_call";
      reasons.push("outbound-call-requires-approval");
    }
  } else if (input.intent.name === "operator_request") {
    risk = "medium";
    escalate = true;
    reasons.push("operator-requested");
  } else if (input.intent.name === "callback") {
    risk = "medium";
    reasons.push("callback-window");
  } else if (input.intent.name === "survey_assist") {
    risk = "low";
  }

  if (!isSafeCallContent(input.text) && input.intent.name === "place_call") {
    allowed = false;
    risk = "critical";
    reasons.push("unsafe-clinical-language");
  }

  return {
    allowed,
    risk,
    reasons,
    requiresApproval,
    requiredApprovals,
    approvalAction,
    escalate,
    suppressOutreach,
    consentOk,
  };
}

export function planFromIntent(intent: AgentIntent, policy: AgentPolicy): AgentPlan {
  const tools: AgentToolName[] = [];
  let goal = "acknowledge-and-assist";
  const steps = [`intent:${intent.name}`, `risk:${policy.risk}`];

  switch (intent.name) {
    case "greeting":
      goal = "open-safely";
      steps.push("greet-without-probing");
      break;
    case "survey_assist":
      goal = "advance-survey";
      tools.push("record_survey_answer");
      steps.push("ask-next-allowed-question");
      break;
    case "place_call":
      goal = "place-guarded-call";
      tools.push("draft_call_plan", "place_outbound_call");
      steps.push("require-human-approval", "dry-run-until-approved");
      break;
    case "callback":
      goal = "schedule-callback";
      tools.push("request_callback");
      steps.push("record-callback-window");
      break;
    case "refuse":
      goal = "stop-outreach";
      steps.push("suppress-follow-up");
      break;
    case "distress":
      goal = "stop-and-escalate";
      tools.push("escalate_operator");
      steps.push("halt-survey", "handoff-to-operator");
      break;
    case "pii_share":
      goal = "minimize-and-ack";
      tools.push("record_survey_answer");
      steps.push("redact-before-persist");
      break;
    case "operator_request":
      goal = "handoff";
      tools.push("escalate_operator");
      steps.push("queue-operator");
      break;
    case "memory_recall":
      goal = "recall-minimized-memory";
      tools.push("recall_memory");
      steps.push("return-codes-not-raw-notes");
      break;
    default:
      steps.push("clarify");
  }

  if (policy.suppressOutreach) {
    return {
      goal,
      steps,
      tools: tools.filter((name) => name === "escalate_operator" || name === "recall_memory"),
    };
  }

  return { goal, steps, tools };
}
