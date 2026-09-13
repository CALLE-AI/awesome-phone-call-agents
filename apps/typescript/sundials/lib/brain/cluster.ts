import { newEntityId } from "../ids.ts";
import type { BrainConfig, BrainGoal, BrainSuggestion, SundialCallRecord } from "../types.ts";
import { generateGeminiJson } from "./gemini.ts";

interface ClusterResponse {
  suggestions?: Array<{
    type?: string;
    title?: string;
    reason?: string;
    proposedGoal?: Partial<BrainGoal> & { label?: string; targetField?: string };
    proposedDirective?: string;
  }>;
}

function callBlurb(call: SundialCallRecord): string {
  const transcript = (call.fullTranscript || call.transcript?.map((entry) => entry.text).join(" ") || "").slice(0, 1800);
  const pain = call.opportunityProfile?.primaryPain?.value || "";
  const alternatives = (call.opportunityProfile?.alternatives?.value || []).join(", ");
  return [`Call ${call.id}`, pain ? `Pain: ${pain}` : "", alternatives ? `Alternatives: ${alternatives}` : "", transcript]
    .filter(Boolean)
    .join("\n");
}

export async function clusterBrainSuggestions(
  config: BrainConfig,
  completedCalls: SundialCallRecord[]
): Promise<BrainSuggestion[]> {
  if (completedCalls.length === 0) return [];

  const goalSummary = config.goals
    .map((goal) => `${goal.enabled ? "[on]" : "[off]"} ${goal.label} (${goal.targetField})`)
    .join("\n");
  const blurbs = completedCalls.slice(0, 8).map(callBlurb).join("\n---\n");

  const prompt = `You are helping a sales manager improve CALL-E discovery goals.
Current goals:
${goalSummary}

Recent completed calls:
${blurbs}

Suggest 1-2 items that are NOT already covered by current goals.
Return JSON: { "suggestions": [ { "type": "new_goal" | "prompt_optimization", "title": string, "reason": string, "proposedGoal": { "label": string, "targetField": camelCase, "priority": "high"|"medium"|"low", "guidance": string, "naturalTrigger": string, "exampleAsk": string }, "proposedDirective": string } ] }.
For prompt_optimization, set proposedDirective and omit proposedGoal.
Keep reasons specific (e.g. "3 of the last 5 leads mentioned..."). No phone numbers or emails.`;

  const parsed = await generateGeminiJson<ClusterResponse>(prompt);
  const incoming = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  const existingTitles = new Set(config.suggestions.map((item) => item.title.toLowerCase()));
  const existingFields = new Set(config.goals.map((goal) => goal.targetField.toLowerCase()));
  const next: BrainSuggestion[] = [];

  for (const item of incoming) {
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const reason = typeof item.reason === "string" ? item.reason.trim() : "";
    if (!title || !reason) continue;
    if (existingTitles.has(title.toLowerCase())) continue;
    const type = item.type === "prompt_optimization" ? "prompt_optimization" : "new_goal";
    if (type === "new_goal") {
      const label = item.proposedGoal?.label?.trim();
      const targetField = item.proposedGoal?.targetField?.trim();
      if (!label || !targetField || existingFields.has(targetField.toLowerCase())) continue;
      next.push({
        id: `sugg_${newEntityId().slice(0, 8)}`,
        type,
        title,
        reason,
        proposedGoal: {
          label,
          targetField,
          priority: item.proposedGoal?.priority === "high" || item.proposedGoal?.priority === "low" ? item.proposedGoal.priority : "medium",
          enabled: true,
          guidance: item.proposedGoal?.guidance || "",
          naturalTrigger: item.proposedGoal?.naturalTrigger,
          exampleAsk: item.proposedGoal?.exampleAsk
        }
      });
    } else if (item.proposedDirective?.trim()) {
      next.push({
        id: `sugg_${newEntityId().slice(0, 8)}`,
        type,
        title,
        reason,
        proposedDirective: item.proposedDirective.trim()
      });
    }
    if (next.length >= 2) break;
  }

  return next;
}
