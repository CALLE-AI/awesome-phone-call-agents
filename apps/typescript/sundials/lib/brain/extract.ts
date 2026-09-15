import { maskEmail, maskPhoneNumber } from "../calle/security.ts";
import { isGenericSalesAction, MISSED_PICKUP_ACTION, opportunityFromCall } from "../intent/opportunity.ts";
import { insightText } from "../intent/phrases.ts";
import type { FieldSource, OpportunityProfile, SourcedField, SundialCallRecord } from "../types.ts";
import { generateGeminiJson } from "./gemini.ts";

const PROFILE_KEYS = new Set([
  "companySize",
  "currentUsers",
  "expectedUsers",
  "primaryPain",
  "useCase",
  "timeline",
  "alternatives",
  "decisionMaker",
  "objections",
  "recommendedAction",
  "wantsHumanFollowUp",
  "callSummary",
  "leadWants",
  "nextActions",
  "painCategory"
]);

const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_IN_TEXT = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const TRANSCRIPT_LIMIT = 12_000;
const PROFILE_TIMEOUT_MS = 45_000;
export const MAX_PAIN_CATEGORY_WORDS = 3;
export const MAX_PAIN_CATEGORIES = 40;

export type GeminiCallProfileJson = {
  summary?: unknown;
  wants?: unknown;
  nextActions?: unknown;
  primaryPain?: unknown;
  painCategory?: unknown;
  useCase?: unknown;
  timeline?: unknown;
  alternatives?: unknown;
  companySize?: unknown;
  recommendedAction?: unknown;
};

export type GeminiProfileResult = {
  profile: OpportunityProfile;
  painCategories: string[];
};

function field<T>(value: T, confidence = 0.88): SourcedField<T> {
  return { value, source: "explicit" as FieldSource, confidence };
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return undefined;
}

function asStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.map((item) => asString(item)).filter((item): item is string => Boolean(item));
    return items.length ? items : undefined;
  }
  const single = asString(value);
  if (!single) return undefined;
  return single.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
}

function asUsers(value: unknown): number | string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return asString(value);
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["true", "yes", "y"].includes(lowered)) return true;
    if (["false", "no", "n"].includes(lowered)) return false;
  }
  return undefined;
}

function missingText(value?: string): boolean {
  return !insightText(value);
}

export function sanitizeTranscriptForGemini(text: string): string {
  return text
    .replace(EMAIL_IN_TEXT, (match) => maskEmail(match))
    .replace(PHONE_IN_TEXT, (match) => maskPhoneNumber(match.replace(/\s+/g, "")));
}

export function callTranscriptText(call: {
  fullTranscript?: string;
  transcript?: Array<{ speaker?: string; text: string }>;
}): string {
  if (call.fullTranscript?.trim()) return call.fullTranscript.trim();
  return (call.transcript || [])
    .map((entry) => `${entry.speaker ? `[${entry.speaker.toUpperCase()}]: ` : ""}${entry.text}`)
    .join("\n")
    .trim();
}

export function hasGeminiBriefing(call: { opportunityProfile?: OpportunityProfile }): boolean {
  return Boolean(insightText(call.opportunityProfile?.callSummary?.value));
}

export function clampPainCategory(raw: string | undefined): string | undefined {
  const cleaned = insightText(raw);
  if (!cleaned) return undefined;
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, MAX_PAIN_CATEGORY_WORDS);
  return words.length ? words.join(" ") : undefined;
}

export function hasPainCategory(call: { opportunityProfile?: OpportunityProfile }): boolean {
  return Boolean(clampPainCategory(call.opportunityProfile?.painCategory?.value));
}

export function painCatalogSettled(call: { opportunityProfile?: OpportunityProfile }): boolean {
  if (hasPainCategory(call)) return true;
  return call.opportunityProfile?.extractedGoals?.painCataloged?.value === true;
}

export function mergePainCatalogs(
  ...lists: Array<Iterable<string | undefined | null> | string | undefined | null>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    const items = list == null ? [] : typeof list === "string" ? [list] : Array.from(list);
    for (const item of items) {
      const label = clampPainCategory(item || undefined);
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(label);
      if (out.length >= MAX_PAIN_CATEGORIES) return out;
    }
  }
  return out;
}

export function resolvePainCategory(
  candidate: string | undefined,
  catalog: string[]
): { label?: string; catalog: string[]; isNew: boolean } {
  const normalized = mergePainCatalogs(catalog);
  const clamped = clampPainCategory(candidate);
  if (!clamped) return { catalog: normalized, isNew: false };
  const hit = normalized.find((item) => item.toLowerCase() === clamped.toLowerCase());
  if (hit) return { label: hit, catalog: normalized, isNew: false };
  return { label: clamped, catalog: mergePainCatalogs(normalized, clamped), isNew: true };
}

export function mergeBrainExtraction(
  profile: OpportunityProfile,
  extracted: Record<string, unknown>
): OpportunityProfile {
  const next: OpportunityProfile = {
    ...profile,
    extractedGoals: { ...profile.extractedGoals }
  };

  for (const [key, raw] of Object.entries(extracted)) {
    if (raw == null || raw === "") continue;
    if (key === "currentUsers" || key === "expectedUsers") {
      const value = asUsers(raw);
      if (value !== undefined) next[key] = field(value);
      continue;
    }
    if (key === "alternatives" || key === "objections" || key === "nextActions") {
      const value = asStringList(raw);
      if (value) {
        if (key === "alternatives") next.alternatives = field(value);
        else if (key === "objections") next.objections = field(value);
        else next.nextActions = field(value);
      }
      continue;
    }
    if (key === "wantsHumanFollowUp") {
      const value = asBoolean(raw);
      if (value !== undefined) next.wantsHumanFollowUp = field(value);
      continue;
    }
    const text = asString(raw);
    if (!text) continue;
    if (key === "companySize") next.companySize = field(text);
    else if (key === "primaryPain") {
      const pain = insightText(text);
      if (pain) next.primaryPain = field(pain);
    } else if (key === "useCase") next.useCase = field(text);
    else if (key === "timeline") {
      const timeline = insightText(text);
      if (timeline) next.timeline = field(timeline);
    } else if (key === "decisionMaker") next.decisionMaker = field(text);
    else if (key === "recommendedAction") next.recommendedAction = field(text);
    else if (key === "callSummary") next.callSummary = field(text);
    else if (key === "leadWants") next.leadWants = field(text);
    else if (key === "painCategory") {
      const category = clampPainCategory(text);
      if (category) next.painCategory = field(category);
    }
    else if (!PROFILE_KEYS.has(key)) next.extractedGoals![key] = field(text);
  }

  if (next.extractedGoals && Object.keys(next.extractedGoals).length === 0) {
    delete next.extractedGoals;
  }
  return next;
}

export function applyGeminiCallProfile(
  profile: OpportunityProfile,
  extracted: GeminiCallProfileJson,
  catalog: string[] = []
): OpportunityProfile {
  return applyGeminiCallProfileResult(profile, extracted, catalog).profile;
}

export function applyGeminiCallProfileResult(
  profile: OpportunityProfile,
  extracted: GeminiCallProfileJson,
  catalog: string[] = []
): GeminiProfileResult {
  const summary = insightText(asString(extracted.summary));
  const wants = insightText(asString(extracted.wants));
  const nextActions = (asStringList(extracted.nextActions) || [])
    .map((item) => insightText(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 5);
  const useCase = insightText(asString(extracted.useCase));
  const timeline = insightText(asString(extracted.timeline));
  const alternatives = asStringList(extracted.alternatives);
  const companySize = insightText(asString(extracted.companySize));
  const action = insightText(asString(extracted.recommendedAction));
  const resolved = resolvePainCategory(
    asString(extracted.painCategory) || asString(extracted.primaryPain),
    catalog
  );

  const next: OpportunityProfile = { ...profile };

  if (summary) next.callSummary = field(summary, 0.9);
  if (wants) next.leadWants = field(wants, 0.9);
  if (nextActions.length) next.nextActions = field(nextActions, 0.9);
  if (resolved.label) {
    next.painCategory = field(resolved.label, 0.92);
    next.primaryPain = field(resolved.label, 0.92);
  }
  next.extractedGoals = {
    ...next.extractedGoals,
    painCataloged: field(true, 1)
  };

  if (useCase && missingText(next.useCase?.value)) next.useCase = field(useCase, 0.86);
  if (timeline) {
    if (missingText(next.timeline?.value)) next.timeline = field(timeline, 0.86);
  } else if (missingText(next.timeline?.value)) {
    delete next.timeline;
  }
  if (companySize && missingText(next.companySize?.value)) next.companySize = field(companySize, 0.84);
  if (alternatives?.length && !(next.alternatives?.value || []).length) {
    next.alternatives = field(alternatives, 0.84);
  }

  const currentAction = next.recommendedAction?.value;
  if (currentAction !== MISSED_PICKUP_ACTION && action && (missingText(currentAction) || isGenericSalesAction(currentAction))) {
    next.recommendedAction = field(action, 0.9);
  } else if (currentAction !== MISSED_PICKUP_ACTION && nextActions.length && isGenericSalesAction(currentAction)) {
    next.recommendedAction = field(nextActions[0], 0.88);
  }

  return { profile: next, painCategories: resolved.catalog };
}

function tagLine(label: string, value?: string): string {
  return `${label}: ${insightText(value) || "(empty)"}`;
}

function leadContextBlock(call: SundialCallRecord): string {
  const bits = [
    call.intentSnapshot ? `Site intent: ${Math.round(call.intentSnapshot.score)}/100 (${call.intentSnapshot.level})` : "",
    call.declaredInterest?.length ? `Declared interest: ${call.declaredInterest.join(", ")}` : "",
    call.declaredCta ? `CTA: ${call.declaredCta}` : "",
    call.useCase ? `Form use case: ${call.useCase}` : "",
    call.companySize ? `Form company size: ${call.companySize}` : ""
  ].filter(Boolean);
  return bits.length ? `Lead context:\n${bits.join("\n")}` : "Lead context: (none)";
}

function catalogBlock(categories: string[]): string {
  if (!categories.length) {
    return "Known pain categories for this account: (none yet — propose the first category, at most 3 words).";
  }
  return [
    "Known pain categories for this account (reuse one of these if it fits; add a new 1-3 word label only if none fit):",
    ...categories.map((item) => `- ${item}`)
  ].join("\n");
}

export function buildCallProfilePrompt(
  call: SundialCallRecord,
  productName: string,
  painCategories: string[] = []
): string | null {
  const raw = callTranscriptText(call);
  if (!raw) return null;
  const transcript = sanitizeTranscriptForGemini(raw).slice(0, TRANSCRIPT_LIMIT);
  const opp = call.opportunityProfile;
  const product = productName.trim() || "Harbor CRM";
  const company = call.company?.trim() || "Unknown company";
  const contact = call.contactName?.trim() || "the visitor";

  return `You are briefing a human salesperson after an AI discovery call for ${product}.
Company: ${company}
Contact: ${contact}
${leadContextBlock(call)}

Existing tags (may be incomplete; fill gaps from the transcript, do not invent):
${tagLine("Pain", opp?.painCategory?.value || opp?.primaryPain?.value)}
${tagLine("Use case", opp?.useCase?.value)}
${tagLine("Timeline", opp?.timeline?.value)}
${tagLine("Alternatives", (opp?.alternatives?.value || []).join(", "))}
${tagLine("Company size", opp?.companySize?.value)}

${catalogBlock(painCategories)}

Transcript (PII masked):
${transcript}

Return JSON with:
{
  "summary": "2-4 sentences: what this call was about, in the lead's terms. Name the product they use today, what is broken, and the buying context.",
  "wants": "1-3 sentences: the outcome they asked for — what they want Harbor (or the salesperson) to do next.",
  "nextActions": ["Do X with Y by Z", "Another concrete follow-up a rep can finish in 24 hours"],
  "painCategory": "1-3 words. Reuse a known category when it fits. Otherwise a new 1-3 word label.",
  "useCase": "what they want the product for, short phrase or empty string",
  "timeline": "buying or rollout timing if they said one, else empty string",
  "alternatives": ["named tools they use or are evaluating"],
  "companySize": "team or seat count if stated, else empty string",
  "recommendedAction": "one headline next step for the salesperson"
}

Rules:
- Cite only what they said or clearly implied. If the transcript is thin, say so.
- Write for a salesperson who did not hear the call. Be specific: names of tools, team size, dates, and objections.
- nextActions must be 2-4 imperative steps a human rep can do in the next 24 hours (email, demo, comparison, intro). Not generic 'follow up'.
- If they named a competitor or current tool, include a next action on our edge versus that tool and how migration would work.
- painCategory is for analytics: at most 3 words, never a sentence, never 'see live transcript'.
- Never include phone numbers or email addresses.
- Empty string, not a placeholder, when a tag was not discussed.`;
}

export async function profileCallWithGemini(
  call: SundialCallRecord,
  productName: string,
  painCategories: string[] = []
): Promise<GeminiProfileResult | null> {
  const prompt = buildCallProfilePrompt(call, productName, painCategories);
  if (!prompt) return null;
  const parsed = await generateGeminiJson<GeminiCallProfileJson>(prompt, PROFILE_TIMEOUT_MS);
  if (!parsed || typeof parsed !== "object") return null;
  const summary = insightText(asString(parsed.summary));
  if (!summary) return null;
  const base = call.opportunityProfile || opportunityFromCall(call, call.intentSnapshot);
  return applyGeminiCallProfileResult(base, parsed, painCategories);
}
