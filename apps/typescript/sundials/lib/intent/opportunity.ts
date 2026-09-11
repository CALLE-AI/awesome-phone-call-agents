import type {
  FieldSource,
  IntentProfile,
  OpportunityPriority,
  OpportunityProfile,
  SourcedField,
  SundialCallRecord
} from "../types.ts";
import { inferPain, insightText } from "./phrases.ts";
import { INTENT_SCORE_CEILING, intentLevelFromScore } from "./score.ts";

function field<T>(value: T, source: FieldSource, confidence: number): SourcedField<T> {
  return { value, source, confidence };
}

function clampScore(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n * 10) / 10));
}

function corpus(call: SundialCallRecord): string {
  const parts = [
    call.fullTranscript || "",
    call.leadDossier?.triggerPain || "",
    call.leadDossier?.scopeRequirement || "",
    call.leadDossier?.urgencyTimeline || "",
    call.useCase || ""
  ];
  return parts.join("\n").toLowerCase();
}

function findCompetitor(text: string): string[] {
  const known = ["salesforce", "hubspot", "pipedrive", "zoho", "monday", "close.io", "close"];
  const hits: string[] = [];
  for (const name of known) {
    if (text.includes(name)) hits.push(name === "close.io" ? "Close" : name[0].toUpperCase() + name.slice(1));
  }
  return Array.from(new Set(hits));
}

function inferTimeline(text: string): string | undefined {
  if (/1\s*[–-]\s*2\s*month|next month|this quarter|1-2 month/i.test(text)) return "1–2 months";
  if (/this week|immediately|asap/i.test(text)) return "This week";
  if (/3\s*month|quarter/i.test(text)) return "About 3 months";
  if (/next year|no timeline/i.test(text)) return "Unspecified";
  return undefined;
}

function inferUseCase(text: string): string | undefined {
  if (/inbound|lead routing/i.test(text)) return "Inbound lead routing";
  if (/crm migration|replace/i.test(text)) return "CRM replacement";
  if (/sales ops|revops/i.test(text)) return "Sales operations";
  return undefined;
}

export function priorityFromScores(
  intentLevel: IntentProfile["level"],
  overall: number,
  wantsFollowUp: boolean,
  disqualified: boolean
): OpportunityPriority {
  if (disqualified) return "disqualified";
  if (intentLevel === "high" && overall >= 8 && wantsFollowUp) return "very_high";
  if (intentLevel === "high" || overall >= 6) return "high";
  return "nurture";
}

export const MISSED_PICKUP_ACTION = "They did not pick up. Retry the discovery call.";
export const GENERIC_FOLLOW_UP_TODAY = "Follow up today";
export const GENERIC_FOLLOW_UP_HOUR = "Sales rep follow-up within 1 hour";

export function isGenericSalesAction(value?: string): boolean {
  const text = (value || "").trim().toLowerCase();
  return text === GENERIC_FOLLOW_UP_TODAY.toLowerCase() || text === GENERIC_FOLLOW_UP_HOUR.toLowerCase();
}

function hadUserSpeech(call: SundialCallRecord): boolean {
  if (call.transcript?.some((entry) => entry.speaker === "user" && entry.text.trim())) return true;
  return /\[USER\]:\s*\S/i.test(call.fullTranscript || "");
}

export function isMissedPickup(call: SundialCallRecord): boolean {
  if (call.status === "no_answer") return true;
  return call.status === "failed" && !hadUserSpeech(call);
}

export function harborFixtureOpportunity(intent?: IntentProfile): OpportunityProfile {
  const intentScore = clampScore((intent?.score ?? 47) / (INTENT_SCORE_CEILING / 10));
  return {
    priority: "very_high",
    scores: {
      intent: field(intentScore >= 8 ? 9 : intentScore, "score", 0.9),
      pain: field(8, "inferred", 0.88),
      urgency: field(9, "explicit", 0.95),
      fit: field(9, "inferred", 0.84),
      potentialValue: field(10, "inferred", 0.86),
      overall: field(9, "score", 0.9)
    },
    currentUsers: field(80, "explicit", 0.99),
    expectedUsers: field(150, "explicit", 0.99),
    companySize: field("80 current users, planning 150", "explicit", 0.99),
    primaryPain: field("Manual administration", "explicit", 0.99),
    useCase: field("Replace spreadsheets with a shared CRM", "explicit", 0.97),
    timeline: field("1–2 months", "explicit", 0.96),
    alternatives: field(["Salesforce"], "explicit", 0.95),
    decisionMaker: field("Unknown — asking VP Sales to join follow-up", "inferred", 0.7),
    objections: field(["Migration effort", "Need security review"], "explicit", 0.9),
    recommendedAction: field("Sales rep follow-up within 1 hour", "inferred", 0.9),
    wantsHumanFollowUp: field(true, "explicit", 0.99)
  };
}

export function opportunityFromCall(call: SundialCallRecord, intent?: IntentProfile): OpportunityProfile {
  if (call.opportunityProfile) return call.opportunityProfile;

  const text = corpus(call);
  const rawIntent = intent?.score ?? call.intentSnapshot?.score ?? 10;
  const intentScore = clampScore(rawIntent / (INTENT_SCORE_CEILING / 10) || 2);
  const painText = inferPain(text) || insightText(call.leadDossier?.triggerPain);
  const timeline = inferTimeline(text) || insightText(call.leadDossier?.urgencyTimeline);
  const useCase = inferUseCase(text) || call.useCase;
  const competitors = findCompetitor(text);
  const missedPickup = isMissedPickup(call);
  const wantsFollowUp =
    missedPickup || /follow[- ]up|human|rep/i.test(text) || call.leadDossier?.intentTier === "hot";
  const disqualified = call.leadDossier?.intentTier === "disqualified";

  const painScore = painText ? 8 : 4;
  const urgencyScore = timeline && /week|month|asap/i.test(timeline) ? 8 : 5;
  const fitScore = call.leadDossier?.intentTier === "hot" ? 8 : 5;
  const valueScore = /enterprise|150|80/i.test(text) ? 8 : 5;
  const overall = clampScore((intentScore + painScore + urgencyScore + fitScore + valueScore) / 5);
  const intentLevel = intentLevelFromScore(rawIntent);

  return {
    priority: priorityFromScores(intentLevel, overall, wantsFollowUp, disqualified),
    scores: {
      intent: field(intentScore, "score", 0.85),
      pain: field(painScore, painText ? "inferred" : "score", 0.7),
      urgency: field(urgencyScore, timeline ? "inferred" : "score", 0.7),
      fit: field(fitScore, "inferred", 0.7),
      potentialValue: field(valueScore, "inferred", 0.65),
      overall: field(overall, "score", 0.75)
    },
    primaryPain: painText ? field(painText, "inferred", 0.75) : undefined,
    useCase: useCase ? field(useCase, "inferred", 0.7) : undefined,
    timeline: timeline ? field(timeline, "inferred", 0.7) : undefined,
    alternatives: competitors.length ? field(competitors, "inferred", 0.8) : undefined,
    decisionMaker: call.leadDossier?.decisionAuthority
      ? field(call.leadDossier.decisionAuthority, "inferred", 0.6)
      : undefined,
    recommendedAction: field(
      missedPickup ? MISSED_PICKUP_ACTION : overall >= 8 ? GENERIC_FOLLOW_UP_HOUR : GENERIC_FOLLOW_UP_TODAY,
      "inferred",
      missedPickup ? 0.9 : 0.75
    ),
    wantsHumanFollowUp: field(wantsFollowUp, "inferred", missedPickup ? 0.85 : 0.7)
  };
}

export function queuePriority(
  intent: IntentProfile,
  opportunity?: OpportunityProfile
): OpportunityPriority {
  if (opportunity?.priority === "disqualified") return "disqualified";
  const level = intentLevelFromScore(intent.score);
  if (level === "high") return opportunity?.priority === "very_high" ? "very_high" : "high";
  if (opportunity?.priority === "very_high") return "very_high";
  return "nurture";
}
