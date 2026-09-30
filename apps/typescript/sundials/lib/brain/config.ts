import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HARBOR_ACCOUNT_ID } from "../sdk/public-key.ts";
import type { BrainConfig, BrainGoal, BrainSource, BrainSuggestion } from "../types.ts";
import { HARBOR_COMPANY_ABOUT, HARBOR_DEMO_URL, HARBOR_QUALIFICATION_REPORT } from "./harbor-corpus.ts";

const LEGACY_IDENTITY = "Friendly discovery specialist for Harbor sales";
const LEGACY_TONE = "Warm, consultative, active listener. Listen first, do not recite clickstream, seek context.";

/** Default warmth window: one follow-up ring an hour after a missed pickup. */
export const DEFAULT_RETRY_DELAY_HOURS = 1;
/** Below this, Brain treats X as invalid and skips the retry. */
export const MIN_RETRY_DELAY_HOURS = 0.25;
/** Above this, Brain treats X as invalid and skips the retry. */
export const MAX_RETRY_DELAY_HOURS = 48;

/** Harbor workspace spoken open. Other accounts edit this on /app/brain. */
export const HARBOR_OPENING_SCRIPT =
  "Hi there, thanks for picking up! This is the automated assistant for Harbor Sales, calling you back because you requested a call from our team. Before we get started, just a quick heads-up that this call may be recorded for quality. To get you to the right person, what can we help you with today?";

export const HARBOR_CLOSING_SCRIPT =
  "Thanks so much for your time today. We'll take what you shared and look at customizing a Harbor plan for your company — we're glad to keep helping, and I hope Harbor can make the business a bit easier from here. Goodbye and have a nice day!";

function brainPath(): string {
  const dbPath = process.env.SUNDIALS_DB_PATH || join(process.cwd(), "data", "sundials.db");
  if (dbPath === ":memory:") return join(process.cwd(), "data", "sundials-brain.json");
  return join(dirname(dbPath), "sundials-brain.json");
}

export function defaultBrainGoals(): BrainGoal[] {
  return [
    {
      id: "team_size",
      label: "Team Size & User Count",
      targetField: "companySize",
      priority: "high",
      enabled: true,
      guidance: "Ask naturally when discussing team workflow.",
      naturalTrigger: "If they talk about their team or workflow volume",
      exampleAsk: "How many reps are currently logging in every day?"
    },
    {
      id: "competitors",
      label: "Current Alternatives / Competitors",
      targetField: "alternatives",
      priority: "high",
      enabled: true,
      guidance: "Listen for mentions of HubSpot, spreadsheets, or a custom CRM.",
      naturalTrigger: "When they mention switching or evaluating options",
      exampleAsk: "Are you comparing this with HubSpot or building custom?"
    },
    {
      id: "core_pain",
      label: "Core Pain & Catalyst",
      targetField: "primaryPain",
      priority: "high",
      enabled: true,
      guidance: "Learn why they started looking now, not a generic pain list.",
      naturalTrigger: "When discussing why they filled the form now",
      exampleAsk: "What was the tipping point that made you look today?"
    },
    {
      id: "timeline",
      label: "Urgency & Implementation Timeline",
      targetField: "timeline",
      priority: "medium",
      enabled: true,
      guidance: "Ask toward wrap-up once interest is clear.",
      naturalTrigger: "Towards wrap-up if interest is clear",
      exampleAsk: "When are you aiming to have this rolled out?"
    }
  ];
}

export function defaultBrainSuggestions(): BrainSuggestion[] {
  return [
    {
      id: "sugg_migration_scope",
      type: "new_goal",
      title: "Migration Scope",
      reason: "3 of the last 5 leads mentioned migrating legacy CSV data. Would you like to add Migration Scope to your discovery goals?",
      proposedGoal: {
        label: "Data Migration",
        targetField: "migrationScope",
        priority: "medium",
        enabled: true,
        guidance: "Ask what they need to import and from where.",
        naturalTrigger: "When they mention CSV, spreadsheets, or switching tools",
        exampleAsk: "What does the migration look like — contacts only, or history too?"
      }
    },
    {
      id: "sugg_prompt_team_size",
      type: "prompt_optimization",
      title: "Anchor team size to pain first",
      reason: "Call-E asks about team size too abruptly in minute 1. Suggestion: Anchor team size to their specific pain point first.",
      proposedDirective: "Do not ask team size in the first minute. Anchor seat count to the pain they just described, then ask how many people feel that pain today."
    }
  ];
}

export function defaultBrainSources(): BrainSource[] {
  return [
    {
      id: "src_harbor_demo",
      kind: "url",
      label: "Harbor demo site",
      url: HARBOR_DEMO_URL,
      ingestedAt: "2026-09-01T00:00:00.000Z",
      excerpt: "The CRM built for high-ticket teams. Harbor gives marketing, sales, and success one record of the account."
    }
  ];
}

export function defaultBrainConfig(accountId = HARBOR_ACCOUNT_ID): BrainConfig {
  return {
    accountId,
    productName: "Harbor CRM",
    companyAbout: HARBOR_COMPANY_ABOUT,
    qualificationReport: HARBOR_QUALIFICATION_REPORT,
    sources: defaultBrainSources(),
    agentIdentity: "Warm, welcoming discovery host for Harbor sales",
    tonePersona:
      "Warm, welcoming, unhurried host. Grateful they picked up. Curious, not interrogative. One question at a time. Never screening language.",
    openingScript: HARBOR_OPENING_SCRIPT,
    closingScript: HARBOR_CLOSING_SCRIPT,
    playbookNotes: "",
    goals: defaultBrainGoals(),
    suggestions: defaultBrainSuggestions(),
    lastClusteredCompletedCount: 0,
    painCategories: [],
    retryDelayHours: DEFAULT_RETRY_DELAY_HOURS
  };
}

function asPriority(value: unknown): BrainGoal["priority"] {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function normalizeGoal(raw: Partial<BrainGoal>, index: number): BrainGoal | null {
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  const targetField = typeof raw.targetField === "string" ? raw.targetField.trim() : "";
  if (!label || !targetField) return null;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `goal_${index + 1}`;
  return {
    id,
    label,
    targetField,
    priority: asPriority(raw.priority),
    enabled: raw.enabled !== false,
    guidance: typeof raw.guidance === "string" ? raw.guidance : "",
    naturalTrigger: typeof raw.naturalTrigger === "string" ? raw.naturalTrigger : undefined,
    exampleAsk: typeof raw.exampleAsk === "string" ? raw.exampleAsk : undefined
  };
}

function normalizeSuggestion(raw: Partial<BrainSuggestion>, index: number): BrainSuggestion | null {
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (!title || !reason) return null;
  const type = raw.type === "prompt_optimization" ? "prompt_optimization" : "new_goal";
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `sugg_${index + 1}`,
    type,
    title,
    reason,
    proposedGoal: raw.proposedGoal,
    proposedDirective: typeof raw.proposedDirective === "string" ? raw.proposedDirective : undefined
  };
}

function normalizeSource(raw: Partial<BrainSource>, index: number): BrainSource | null {
  const kind = raw.kind === "file" ? "file" : raw.kind === "url" ? "url" : null;
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (!kind || !label) return null;
  const excerpt = typeof raw.excerpt === "string" ? raw.excerpt.trim() : "";
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `src_${index + 1}`,
    kind,
    label,
    url: typeof raw.url === "string" && raw.url.trim() ? raw.url.trim() : undefined,
    fileName: typeof raw.fileName === "string" && raw.fileName.trim() ? raw.fileName.trim() : undefined,
    ingestedAt:
      typeof raw.ingestedAt === "string" && raw.ingestedAt.trim() ? raw.ingestedAt.trim() : "2026-09-01T00:00:00.000Z",
    excerpt
  };
}

export function normalizeBrainConfig(raw: Partial<BrainConfig> | null | undefined, accountId = HARBOR_ACCOUNT_ID): BrainConfig {
  const fallback = defaultBrainConfig(accountId);
  if (!raw || typeof raw !== "object") return fallback;
  const goals = Array.isArray(raw.goals)
    ? raw.goals.map((goal, index) => normalizeGoal(goal, index)).filter((goal): goal is BrainGoal => Boolean(goal))
    : fallback.goals;
  const suggestions = Array.isArray(raw.suggestions)
    ? raw.suggestions
        .map((suggestion, index) => normalizeSuggestion(suggestion, index))
        .filter((suggestion): suggestion is BrainSuggestion => Boolean(suggestion))
    : fallback.suggestions;
  const sources = Array.isArray(raw.sources)
    ? raw.sources.map((source, index) => normalizeSource(source, index)).filter((source): source is BrainSource => Boolean(source))
    : fallback.sources;
  return {
    accountId: typeof raw.accountId === "string" && raw.accountId.trim() ? raw.accountId.trim() : accountId,
    productName: typeof raw.productName === "string" && raw.productName.trim() ? raw.productName.trim() : fallback.productName,
    companyAbout: typeof raw.companyAbout === "string" ? raw.companyAbout.trim() : fallback.companyAbout,
    qualificationReport: typeof raw.qualificationReport === "string" ? raw.qualificationReport.trim() : fallback.qualificationReport,
    sources,
    agentIdentity:
      typeof raw.agentIdentity === "string" && raw.agentIdentity.trim() && raw.agentIdentity.trim() !== LEGACY_IDENTITY
        ? raw.agentIdentity.trim()
        : fallback.agentIdentity,
    tonePersona:
      typeof raw.tonePersona === "string" && raw.tonePersona.trim() && raw.tonePersona.trim() !== LEGACY_TONE
        ? raw.tonePersona.trim()
        : fallback.tonePersona,
    openingScript: typeof raw.openingScript === "string" ? raw.openingScript.trim() : fallback.openingScript,
    closingScript: typeof raw.closingScript === "string" ? raw.closingScript.trim() : fallback.closingScript,
    playbookNotes: typeof raw.playbookNotes === "string" ? raw.playbookNotes : "",
    goals: goals.length > 0 ? goals : fallback.goals,
    suggestions: suggestions.length > 0 ? suggestions : fallback.suggestions,
    lastClusteredCompletedCount:
      typeof raw.lastClusteredCompletedCount === "number" && Number.isFinite(raw.lastClusteredCompletedCount)
        ? raw.lastClusteredCompletedCount
        : 0,
    painCategories: normalizePainCategories(raw.painCategories),
    retryDelayHours: normalizeRetryDelayHours(raw.retryDelayHours, !("retryDelayHours" in raw))
  };
}

function normalizePainCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const words = item.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).slice(0, 3);
    const label = words.join(" ");
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(label);
    if (next.length >= 40) break;
  }
  return next;
}

/**
 * Missing key → Harbor default (1 hour).
 * Explicit null / empty / non-finite / outside 0.25–48 → skip retry (undefined).
 * Does not clamp or inject a live-binding fallback.
 */
export function normalizeRetryDelayHours(value: unknown, missingUsesDefault = false): number | undefined {
  if (value === undefined && missingUsesDefault) return DEFAULT_RETRY_DELAY_HOURS;
  if (value === undefined || value === null || value === "") return undefined;
  const hours = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(hours) || hours < MIN_RETRY_DELAY_HOURS || hours > MAX_RETRY_DELAY_HOURS) {
    return undefined;
  }
  return hours;
}

/** `undefined` means do not schedule a retry. Config should already be normalized. */
export function retryDelayHoursOrSkip(config: BrainConfig): number | undefined {
  return typeof config.retryDelayHours === "number" ? config.retryDelayHours : undefined;
}

export function readBrainConfig(accountId = HARBOR_ACCOUNT_ID): BrainConfig {
  try {
    const raw = JSON.parse(readFileSync(brainPath(), "utf8")) as Partial<BrainConfig>;
    const config = normalizeBrainConfig(raw, accountId);
    if (config.accountId !== accountId) return defaultBrainConfig(accountId);
    return config;
  } catch {
    return defaultBrainConfig(accountId);
  }
}

export function writeBrainConfig(next: BrainConfig): BrainConfig {
  const config = normalizeBrainConfig(next, next.accountId || HARBOR_ACCOUNT_ID);
  mkdirSync(dirname(brainPath()), { recursive: true });
  const serialized = {
    ...config,
    retryDelayHours: config.retryDelayHours ?? null
  };
  writeFileSync(brainPath(), `${JSON.stringify(serialized, null, 2)}\n`);
  return config;
}

export function enabledGoals(config: BrainConfig): BrainGoal[] {
  const rank = { high: 0, medium: 1, low: 2 };
  return config.goals.filter((goal) => goal.enabled).sort((a, b) => rank[a.priority] - rank[b.priority]);
}

/** Voice stays on CALL-E defaults. Brain injects company context, qualification, opening, and goals. */
export function brainCallDirectives(config: BrainConfig) {
  const playbook = [config.companyAbout, config.qualificationReport, config.playbookNotes]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join("\n\n");
  return {
    productName: config.productName,
    agentIdentity: config.agentIdentity,
    tonePersona: config.tonePersona,
    playbookNotes: playbook,
    openingScript: config.openingScript,
    closingScript: config.closingScript,
    activeGoals: enabledGoals(config)
  };
}

export function getBrainConfigForAccount(accountId: string): BrainConfig {
  return readBrainConfig(accountId);
}
