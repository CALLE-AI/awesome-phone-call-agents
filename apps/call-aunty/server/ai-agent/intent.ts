import { evaluateSafetyText } from "../ai/safety";
import { containsPii } from "./sanitize";
import type { AgentIntent, AgentIntentName } from "./types";

const RULES: { name: AgentIntentName; pattern: RegExp; confidence: number; reason: string }[] = [
  {
    name: "distress",
    pattern: /\b(chest pain|can'?t breathe|suicide|self[- ]harm|hard to breathe|call 911)\b/i,
    confidence: 0.99,
    reason: "safety-sensitive phrase",
  },
  {
    name: "refuse",
    pattern: /\b(no thanks|don'?t (want|call)|stop (calling|texting)|opt out|unsubscribe|i do not want)\b/i,
    confidence: 0.95,
    reason: "explicit refusal or opt-out",
  },
  {
    name: "place_call",
    pattern: /\b(please call|place a call|dial|call (my )?(aunty|her|him|them)|make the (phone )?call)\b/i,
    confidence: 0.92,
    reason: "outbound call requested",
  },
  {
    name: "callback",
    pattern: /\b(call( me)? back|not right now|tomorrow|later|this afternoon|callback)\b/i,
    confidence: 0.9,
    reason: "callback window requested",
  },
  {
    name: "operator_request",
    pattern: /\b(talk to a (person|human)|real person|operator|community health worker|chw)\b/i,
    confidence: 0.93,
    reason: "human operator requested",
  },
  {
    name: "memory_recall",
    pattern: /\b(what did (we|i|she) say|remember|last (call|survey)|prior answers?)\b/i,
    confidence: 0.86,
    reason: "memory recall requested",
  },
  {
    name: "survey_assist",
    pattern: /\b(survey|question|next question|i('m| am) ready|yes,? (i have|that works)|go ahead)\b/i,
    confidence: 0.84,
    reason: "survey assistance",
  },
  {
    name: "greeting",
    pattern: /^(hi|hello|hey|good (morning|afternoon|evening))\b/i,
    confidence: 0.8,
    reason: "opening greeting",
  },
];

export function classifyIntent(text: string): AgentIntent {
  const safety = evaluateSafetyText(text);
  if (safety.some((hit) => hit.code === "urgent_safety")) {
    return { name: "distress", confidence: 1, reasons: ["safety-evaluator"] };
  }

  if (containsPii(text)) {
    return { name: "pii_share", confidence: 0.97, reasons: ["email-or-phone-detected"] };
  }

  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return { name: rule.name, confidence: rule.confidence, reasons: [rule.reason] };
    }
  }

  return { name: "unknown", confidence: 0.4, reasons: ["no-rule-matched"] };
}
