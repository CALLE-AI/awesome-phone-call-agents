import { newEntityId } from "../ids.ts";
import { generateGeminiJson, geminiConfigured } from "./gemini.ts";
import { goalFromSentence } from "./goals.ts";
import type { BrainConfig, BrainGoal, BrainSuggestion } from "../types.ts";

export interface CopilotResult {
  reply: string;
  config: BrainConfig;
}

interface GeminiCopilotJson {
  reply?: unknown;
  productName?: unknown;
  companyAbout?: unknown;
  qualificationReport?: unknown;
  openingScript?: unknown;
  closingScript?: unknown;
  retryDelayHours?: unknown;
  addGoal?: unknown;
  removeGoalLabel?: unknown;
  pauseGoalLabel?: unknown;
  resumeGoalLabel?: unknown;
  applySuggestionTitle?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function matchGoal(config: BrainConfig, needle: string): BrainGoal | undefined {
  const key = needle.trim().toLowerCase();
  if (!key) return undefined;
  return config.goals.find(
    (goal) => goal.label.toLowerCase().includes(key) || goal.targetField.toLowerCase() === key.replace(/\s+/g, "")
  );
}

export function applySuggestionToConfig(config: BrainConfig, suggestion: BrainSuggestion): BrainConfig {
  if (suggestion.type === "new_goal" && suggestion.proposedGoal) {
    const proposed = suggestion.proposedGoal;
    const goal: BrainGoal = {
      id: `goal_${newEntityId().slice(0, 8)}`,
      label: proposed.label,
      targetField: proposed.targetField,
      priority: proposed.priority || "medium",
      enabled: true,
      guidance: proposed.guidance || "",
      naturalTrigger: proposed.naturalTrigger,
      exampleAsk: proposed.exampleAsk
    };
    return {
      ...config,
      goals: [...config.goals, goal],
      suggestions: config.suggestions.filter((item) => item.id !== suggestion.id)
    };
  }
  if (suggestion.type === "prompt_optimization" && suggestion.proposedDirective) {
    const note = config.qualificationReport.trim()
      ? `${config.qualificationReport.trim()}\n\n${suggestion.proposedDirective}`
      : suggestion.proposedDirective;
    return {
      ...config,
      qualificationReport: note,
      suggestions: config.suggestions.filter((item) => item.id !== suggestion.id)
    };
  }
  return {
    ...config,
    suggestions: config.suggestions.filter((item) => item.id !== suggestion.id)
  };
}

export function applyCopilotHeuristics(config: BrainConfig, message: string): CopilotResult | null {
  const text = message.trim();
  if (!text) return { reply: "Tell me what to change in the qualification report or call policy.", config };

  const skipRetry = /\b(don'?t|do not|skip|no)\s+(retry|call back|callback|follow[- ]?up)\b/i.test(text);
  if (skipRetry) {
    return {
      reply: "Retry is locked for this hackathon demo. Failed and no-speech outcomes stay in the inbox for a human to reconcile.",
      config
    };
  }

  const delay = text.match(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i);
  if (delay && /\b(retry|call back|callback|follow[- ]?up|wait)\b/i.test(text)) {
    return {
      reply: "Retry delay is locked for this hackathon demo. Sundials will not schedule another call automatically.",
      config
    };
  }

  const opening = text.match(/\bopening(?: script)?\s*[:-]\s*([\s\S]+)/i);
  if (opening?.[1] && !/\bclos(?:e|ing)\b/i.test(text)) {
    return { reply: "Updated the opening script.", config: { ...config, openingScript: opening[1].trim() } };
  }

  const closing = text.match(/\bclos(?:e|ing)(?: script)?\s*[:-]\s*([\s\S]+)/i);
  if (closing?.[1]) {
    return { reply: "Updated the closing script.", config: { ...config, closingScript: closing[1].trim() } };
  }

  const company = text.match(/\b(?:company|product)\s+(?:is|name(?:\s+is)?|:)\s+(.+)/i);
  if (company?.[1]) {
    const productName = company[1].trim().replace(/[.]+$/, "");
    return { reply: `Company is now ${productName}.`, config: { ...config, productName } };
  }

  const about = text.match(/\b(?:about|company about|we are)\s*[:-]\s*([\s\S]+)/i);
  if (about?.[1] && !/\badd (?:a )?goal\b/i.test(text)) {
    return { reply: "Updated the company summary.", config: { ...config, companyAbout: about[1].trim() } };
  }

  const pause = text.match(/\b(?:pause|stop asking(?: about)?|disable|turn off)\s+(.+)/i);
  if (pause?.[1]) {
    const goal = matchGoal(config, pause[1]);
    if (goal) {
      return {
        reply: `Paused “${goal.label}”. CALL-E will not target it on the next call.`,
        config: {
          ...config,
          goals: config.goals.map((item) => (item.id === goal.id ? { ...item, enabled: false } : item))
        }
      };
    }
  }

  const resume = text.match(/\b(?:resume|listen for|enable|turn on)\s+(.+)/i);
  if (resume?.[1]) {
    const goal = matchGoal(config, resume[1]);
    if (goal) {
      return {
        reply: `Listening for “${goal.label}” again.`,
        config: {
          ...config,
          goals: config.goals.map((item) => (item.id === goal.id ? { ...item, enabled: true } : item))
        }
      };
    }
  }

  const addGoal = text.match(/\badd (?:a )?(?:goal|intent)(?:\s+for)?\s+(.+)/i);
  if (addGoal?.[1]) {
    const goal = goalFromSentence(addGoal[1]);
    if (goal) {
      if (config.goals.some((item) => item.targetField.toLowerCase() === goal.targetField.toLowerCase())) {
        return { reply: `“${goal.label}” is already a listening intent.`, config };
      }
      return { reply: `Added “${goal.label}” as a listening intent.`, config: { ...config, goals: [...config.goals, goal] } };
    }
  }

  const apply = text.match(/\bapply\s+(.+)/i);
  if (apply?.[1]) {
    const needle = apply[1].trim().toLowerCase();
    const suggestion = config.suggestions.find(
      (item) => item.title.toLowerCase() === needle || item.title.toLowerCase().includes(needle)
    );
    if (suggestion) {
      return { reply: `Applied “${suggestion.title}”.`, config: applySuggestionToConfig(config, suggestion) };
    }
  }

  return null;
}

function applyGeminiPatch(config: BrainConfig, parsed: GeminiCopilotJson): BrainConfig {
  let next = { ...config };
  const productName = asString(parsed.productName);
  if (productName) next.productName = productName;
  const companyAbout = asString(parsed.companyAbout);
  if (companyAbout) next.companyAbout = companyAbout;
  const qualificationReport = asString(parsed.qualificationReport);
  if (qualificationReport) next.qualificationReport = qualificationReport;
  const openingScript = asString(parsed.openingScript);
  if (openingScript) next.openingScript = openingScript;
  const closingScript = asString(parsed.closingScript);
  if (closingScript) next.closingScript = closingScript;
  const addGoal = asString(parsed.addGoal);
  if (addGoal) {
    const goal = goalFromSentence(addGoal);
    if (goal && !next.goals.some((item) => item.targetField.toLowerCase() === goal.targetField.toLowerCase())) {
      next.goals = [...next.goals, goal];
    }
  }
  const remove = asString(parsed.removeGoalLabel);
  if (remove) {
    const goal = matchGoal(next, remove);
    if (goal) next.goals = next.goals.filter((item) => item.id !== goal.id);
  }
  const pause = asString(parsed.pauseGoalLabel);
  if (pause) {
    const goal = matchGoal(next, pause);
    if (goal) next.goals = next.goals.map((item) => (item.id === goal.id ? { ...item, enabled: false } : item));
  }
  const resume = asString(parsed.resumeGoalLabel);
  if (resume) {
    const goal = matchGoal(next, resume);
    if (goal) next.goals = next.goals.map((item) => (item.id === goal.id ? { ...item, enabled: true } : item));
  }
  const applyTitle = asString(parsed.applySuggestionTitle);
  if (applyTitle) {
    const suggestion = next.suggestions.find((item) => item.title.toLowerCase().includes(applyTitle.toLowerCase()));
    if (suggestion) next = applySuggestionToConfig(next, suggestion);
  }
  return next;
}

export async function runBrainCopilot(config: BrainConfig, message: string): Promise<CopilotResult> {
  const heuristic = applyCopilotHeuristics(config, message);
  if (heuristic) return heuristic;
  if (!geminiConfigured()) {
    const qualificationReport = config.qualificationReport.trim()
      ? `${config.qualificationReport.trim()}\n\n${message.trim()}`
      : message.trim();
    return {
      reply: "I added that to the qualification report. Voice and tone stay with CALL-E — Brain only edits company context, goals, script, and retry.",
      config: { ...config, qualificationReport }
    };
  }

  const raw: unknown = await generateGeminiJson(
    `You edit a Sundials Brain qualification brief. Never change voice, tone, persona, manner, or agent identity.

Current config:
${JSON.stringify(
  {
    productName: config.productName,
    companyAbout: config.companyAbout,
    qualificationReport: config.qualificationReport,
    openingScript: config.openingScript,
    closingScript: config.closingScript,
    retryDelayHours: config.retryDelayHours ?? null,
    goals: config.goals.map((goal) => ({ id: goal.id, label: goal.label, enabled: goal.enabled, targetField: goal.targetField })),
    suggestions: config.suggestions.map((item) => ({ title: item.title, type: item.type }))
  },
  null,
  2
)}

User: ${message.trim()}

Return JSON with a short "reply" and only the fields that should change:
productName, companyAbout, qualificationReport, openingScript, closingScript,
addGoal (one sentence), removeGoalLabel, pauseGoalLabel, resumeGoalLabel, applySuggestionTitle.`,
    45_000
  );
  if (raw == null || typeof raw !== "object") {
    return {
      reply: "I could not apply that yet. Try a concrete change such as “add a goal for budget” or edit the report directly.",
      config
    };
  }

  const patch = raw as GeminiCopilotJson;
  const next = applyGeminiPatch(config, patch);
  const reply = asString(patch.reply) || "Updated the Brain brief.";
  return { reply, config: next };
}
