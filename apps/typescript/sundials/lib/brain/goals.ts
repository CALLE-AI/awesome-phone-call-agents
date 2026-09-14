import { newEntityId } from "../ids.ts";
import type { BrainGoal, BrainGoalPriority } from "../types.ts";

export function fieldSlug(label: string): string {
  const parts = label.trim().split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length === 0) return "customField";
  return parts.map((part, index) => (index === 0 ? part.toLowerCase() : part[0].toUpperCase() + part.slice(1).toLowerCase())).join("");
}

export function goalFromSentence(sentence: string, priority: BrainGoalPriority = "medium"): BrainGoal | null {
  const label = sentence.trim().replace(/[.?!]+$/, "");
  if (!label) return null;
  const shortLabel = label.split(/[:]/)[0].slice(0, 72).trim() || label.slice(0, 72);
  const targetField = fieldSlug(shortLabel) || "customField";
  return {
    id: `goal_${newEntityId().slice(0, 8)}`,
    label: shortLabel,
    targetField,
    priority,
    enabled: true,
    guidance: label,
    naturalTrigger: undefined,
    exampleAsk: undefined
  };
}
