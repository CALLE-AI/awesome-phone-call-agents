import type {
  AnalyticsSnapshot,
  BehaviorSnapshot,
  IntentSignal,
  LeadQueueItem,
  OpportunityPriority,
  SundialCallRecord
} from "@/lib/types";
import { isGenericSalesAction, MISSED_PICKUP_ACTION } from "../intent/opportunity.ts";
import { insightText } from "../intent/phrases.ts";
import { INTENT_SCORE_CEILING } from "../intent/score.ts";

export { INTENT_SCORE_CEILING };

export const EMPTY_ANALYTICS: AnalyticsSnapshot = {
  funnel: {
    inboundVisitors: 0,
    highIntentVisitors: 0,
    callRequests: 0,
    callsCompleted: 0,
    salesQualified: 0,
    humanFollowUps: 0
  },
  kpis: {
    inboundLeads: 0,
    highIntentLeads: 0,
    callsRequested: 0,
    callsCompleted: 0,
    avgResponseTimeSec: 0,
    salesQualifiedLeads: 0,
    avgIntentScore: 0,
    avgOpportunityScore: 0
  },
  intelligence: {
    topPainPoints: [],
    commonUseCases: [],
    companySizeDistribution: [],
    timelines: [],
    competitors: [],
    objections: []
  },
  series: []
};

export type HeatTab = "all" | "very_high" | "high" | "followup" | "nurture";
export type Range = "today" | "7d" | "30d";

export function parseRange(value: string | null | undefined): Range {
  if (value === "today" || value === "7d" || value === "30d") return value;
  return "30d";
}

export function withRange(href: string, range: Range | string | null | undefined): string {
  const next = parseRange(typeof range === "string" ? range : null);
  const url = new URL(href, "http://sundials.local");
  url.searchParams.set("range", next);
  return `${url.pathname}${url.search}`;
}

export function leadPath(leadId: string): string {
  return `/app/lead/${encodeURIComponent(leadId)}`;
}

export function callPath(callId: string): string {
  return `/app/call/${encodeURIComponent(callId)}`;
}

export function priorityLabel(priority: OpportunityPriority): string {
  if (priority === "very_high") return "VERY HIGH";
  if (priority === "high") return "HIGH";
  if (priority === "disqualified") return "DISQUALIFIED";
  return "NURTURE";
}

export function callStatusLabel(status: string): string {
  if (status === "no_answer") return "No answer";
  if (status === "in_progress") return "In progress";
  if (status === "queued") return "Queued";
  if (status === "dialing") return "Dialing";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  return status;
}

export function initials(lead: LeadQueueItem): string {
  const source = lead.lead.company || lead.lead.name || lead.lead.email || "NA";
  const parts = source.replace(/@.*/, "").split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function companyLabel(lead: LeadQueueItem): string {
  return lead.lead.company?.trim() || "Unknown company";
}

export function contactLabel(lead: LeadQueueItem): string {
  return lead.lead.name?.trim() || "No point of contact";
}

export function avatarTone(id: string): string {
  const tones = ["#e86b24", "#4f7cff", "#1f9d6c", "#7c5cbf", "#dc3d3d"];
  let hash = 0;
  for (const ch of id) hash = (hash + ch.charCodeAt(0)) % tones.length;
  return tones[hash] || "#e86b24";
}

export function inRange(iso: string | undefined, range: Range): boolean {
  if (!iso) return true;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return true;
  const windowMs = range === "today" ? 86_400_000 : range === "7d" ? 7 * 86_400_000 : 30 * 86_400_000;
  return Date.now() - t <= windowMs;
}

export function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export function displayField(value?: string): string {
  return insightText(value) || "—";
}

export function displayPain(value?: string): string {
  return displayField(value);
}

export function displayAction(value?: string): string {
  const text = insightText(value);
  if (!text || isGenericSalesAction(text)) return "—";
  return text;
}

function recommendedAction(lead: LeadQueueItem): string | undefined {
  const value = lead.opportunity?.recommendedAction?.value;
  const text = typeof value === "string" ? insightText(value) : undefined;
  if (!text || isGenericSalesAction(text)) {
    const steps = (lead.opportunity?.nextActions?.value || [])
      .map((item) => insightText(item))
      .filter((item): item is string => Boolean(item));
    return steps[0];
  }
  return text;
}

export function leadStatusSummary(
  lead: LeadQueueItem,
  call?: SundialCallRecord
): { headline: string; detail: string } {
  const action = recommendedAction(lead);
  const status = lead.latestCallStatus;

  if (lead.priority === "disqualified") {
    return { headline: "Disqualified", detail: action || "Do not pursue from this conversation." };
  }
  if (!lead.latestCallId && !status) {
    return {
      headline: "No discovery call yet",
      detail:
        lead.intent.level === "high"
          ? "High intent — waiting for a Talk to sales dispatch."
          : "Identified visitor; no CALL-E dispatch yet."
    };
  }
  if (call?.needsReconciliation) {
    return {
      headline: "Needs review",
      detail: call.errorReason || "Ambiguous provider outcome. No automatic follow-up."
    };
  }
  if (status === "queued") {
    if (call?.retryOfCallId || call?.retryDueAt) {
      const due = formatDateTime(call.retryDueAt);
      return {
        headline: "Retry scheduled",
        detail: due ? `One follow-up ring at ${due}.` : "One follow-up ring is queued."
      };
    }
    return { headline: "Queued", detail: "Waiting to dial." };
  }
  if (status === "dialing") {
    const ring = formatDuration(call?.speedToDialSec);
    return {
      headline: "Dialing",
      detail: ring ? `Ringing after ${ring}.` : "Ringing now."
    };
  }
  if (status === "in_progress") {
    return { headline: "Call in progress", detail: "Discovery conversation underway." };
  }
  if (status === "no_answer") {
    return { headline: "No answer", detail: action || MISSED_PICKUP_ACTION };
  }
  if (status === "failed") {
    return {
      headline: "Call failed",
      detail: call?.errorReason || action || "Review the call details."
    };
  }
  if (status === "completed") {
    const follow = lead.opportunity?.wantsHumanFollowUp?.value ? "Human follow-up recommended. " : "";
    return {
      headline: "Discovery complete",
      detail: `${follow}${action || "Review transcript and next step."}`.trim()
    };
  }
  return {
    headline: callStatusLabel(status || "queued"),
    detail: action || "See call telemetry."
  };
}

export function leadStatusSearchText(lead: LeadQueueItem, call?: SundialCallRecord): string {
  const status = leadStatusSummary(lead, call);
  return `${status.headline} ${status.detail} ${leadProfileSummary(lead)}`;
}

function asOppText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return insightText(value);
}

function capitalizeSentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type DiscoveryFact = { label: string; value: string };

const NARRATIVE_FACT_LABELS = new Set(["Next for sales"]);

export function splitDiscoveryFacts(facts: DiscoveryFact[]) {
  return {
    narrative: facts.filter((fact) => NARRATIVE_FACT_LABELS.has(fact.label)),
    meta: facts.filter((fact) => !NARRATIVE_FACT_LABELS.has(fact.label))
  };
}
export type SignalTier = "high" | "medium" | "low";
export type PageEngagementRow = { path: string; views: number; hoverSec: number; barPct: number };

export function formatChipLabel(raw: string): string {
  const key = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const compact = raw.trim().toLowerCase();
  if (compact.startsWith("plan_")) {
    const plan = compact.slice(5).replace(/_/g, " ");
    return `${capitalizeSentence(plan)} plan`;
  }
  if (compact.startsWith("faq_")) {
    const topic = compact.slice(4).replace(/_/g, " ");
    return `FAQ: ${topic}`;
  }
  const words = key.split(" ").filter(Boolean);
  if (words.length === 0) return raw;
  return words.map((word, index) => (index === 0 ? capitalizeSentence(word) : word)).join(" ");
}

const HIGH_SIGNALS = new Set([
  "email_provided",
  "phone_provided",
  "returning_visitor",
  "sales_intent",
  "talk_to_sales",
  "get_demo",
  "demo_requested",
  "demo_completed",
  "plan_enterprise"
]);

const LOW_SIGNALS = new Set(["page_hover", "page_interest"]);

export function signalTier(type: string): SignalTier {
  const key = type.trim().toLowerCase();
  if (HIGH_SIGNALS.has(key)) return "high";
  if (LOW_SIGNALS.has(key)) return "low";
  return "medium";
}

export function signalChipClass(tier: SignalTier): string {
  if (tier === "high") return "border-transparent bg-primary text-primary-foreground";
  if (tier === "low") return "border-transparent bg-muted text-muted-foreground";
  return "border-transparent bg-accent text-accent-foreground";
}

export function uniqueIntentSignals(signals: IntentSignal[]): IntentSignal[] {
  const seen = new Set<string>();
  const unique: IntentSignal[] = [];
  for (const signal of signals) {
    if (seen.has(signal.type)) continue;
    seen.add(signal.type);
    unique.push(signal);
  }
  const rank: Record<SignalTier, number> = { high: 0, medium: 1, low: 2 };
  return unique.sort((a, b) => rank[signalTier(a.type)] - rank[signalTier(b.type)]);
}

export function pageEngagementRows(behavior: BehaviorSnapshot): PageEngagementRow[] {
  const hover = behavior.hoverSecByPath || {};
  const views = behavior.pageViewCounts || {};
  const paths = new Set<string>([...(behavior.pagesViewed || []), ...Object.keys(hover), ...Object.keys(views)]);
  const rows = [...paths]
    .filter(Boolean)
    .map((path) => ({
      path,
      views: views[path] || 0,
      hoverSec: hover[path] || 0
    }))
    .sort((a, b) => b.hoverSec - a.hoverSec || b.views - a.views || a.path.localeCompare(b.path));
  const max = Math.max(0, ...rows.map((row) => (row.hoverSec > 0 ? row.hoverSec : row.views)));
  return rows.map((row) => {
    const weight = row.hoverSec > 0 ? row.hoverSec : row.views;
    return {
      ...row,
      barPct: max === 0 || weight <= 0 ? 0 : Math.max(8, Math.round((weight / max) * 100))
    };
  });
}

export const SIGNAL_TIER_LABELS: Record<SignalTier, string> = {
  high: "High intent",
  medium: "Medium",
  low: "Page interest"
};

export function groupIntentSignalsByTier(
  signals: IntentSignal[]
): Array<{ tier: SignalTier; label: string; signals: IntentSignal[] }> {
  const unique = uniqueIntentSignals(signals);
  const groups: Record<SignalTier, IntentSignal[]> = { high: [], medium: [], low: [] };
  for (const signal of unique) {
    groups[signalTier(signal.type)].push(signal);
  }
  return (["high", "medium", "low"] as const)
    .filter((tier) => groups[tier].length > 0)
    .map((tier) => ({ tier, label: SIGNAL_TIER_LABELS[tier], signals: groups[tier] }));
}

const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T/;

function clockToSeconds(raw: string): number | undefined {
  const clock = raw.match(/^(\d+):([0-5]\d)$/);
  if (!clock) return undefined;
  return Number(clock[1]) * 60 + Number(clock[2]);
}

/**
 * CALL-E `offset_seconds` on `TranscriptEntry.timestamp` (`"1"` / `"8"`), or an
 * ISO datetime relative to `baseIso` (call `requestedAt` / `dialedAt`).
 */
export function transcriptOffsetSeconds(timestamp?: string, baseIso?: string): number | undefined {
  if (timestamp == null || !timestamp.trim()) return undefined;
  const raw = timestamp.trim();
  if (ISO_TIMESTAMP_RE.test(raw)) {
    if (!baseIso) return undefined;
    const t = Date.parse(raw);
    const b = Date.parse(baseIso);
    if (!Number.isFinite(t) || !Number.isFinite(b)) return undefined;
    return Math.max(0, Math.round((t - b) / 1000));
  }
  const clock = clockToSeconds(raw);
  if (clock != null) return clock;
  const sec = Number(raw);
  if (!Number.isFinite(sec) || sec < 0) return undefined;
  return Math.round(sec);
}

export function asOffsetTimestamp(timestamp?: string, baseIso?: string): string | undefined {
  const sec = transcriptOffsetSeconds(timestamp, baseIso);
  return sec == null ? undefined : String(sec);
}

export function callTranscriptBaseIso(call: {
  requestedAt?: string;
  dialedAt?: string;
  connectedAt?: string;
}): string | undefined {
  return call.requestedAt || call.dialedAt || call.connectedAt;
}

/** Rewrite ISO (or `m:ss`) transcript clocks to CALL-E offset strings. */
export function normalizeCallTranscript(call: SundialCallRecord): SundialCallRecord {
  if (!call.transcript?.length) return call;
  const base = callTranscriptBaseIso(call);
  let changed = false;
  const transcript = call.transcript.map((entry) => {
    const next = asOffsetTimestamp(entry.timestamp, base);
    if (next == null || next === entry.timestamp) return entry;
    changed = true;
    return { ...entry, timestamp: next };
  });
  return changed ? { ...call, transcript } : call;
}

/**
 * CALL-E `offset_seconds` stored on `TranscriptEntry.timestamp` as `"1"` / `"8"`.
 * Renders `m:ss` (e.g. `0:01`). ISO datetimes without a call-start base are omitted.
 */
export function formatTranscriptOffset(timestamp?: string, baseIso?: string): string {
  if (timestamp == null || !timestamp.trim()) return "0:00";
  const sec = transcriptOffsetSeconds(timestamp, baseIso);
  if (sec == null) return "";
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function transcriptAgentName(agentIdentity?: string, productName?: string): string {
  const identity = agentIdentity?.trim() ?? "";
  const product = productName?.trim() ?? "";
  if (identity) {
    const words = identity.split(/\s+/).filter(Boolean);
    if (identity.length <= 40 && words.length <= 5 && !/[.,;:]/.test(identity)) {
      return identity;
    }
    if (/\bharbor sales\b/i.test(identity)) return "Harbor Sales";
    if (/\bharbor\b/i.test(identity)) return "Harbor";
  }
  if (product) return product;
  return "Harbor";
}

export function transcriptSpeakerName(
  speaker: string,
  ctx: {
    contactName?: string;
    leadName?: string;
    agentIdentity?: string;
    productName?: string;
  }
): string {
  const role = speaker.trim().toLowerCase();
  if (role === "user") {
    return ctx.contactName?.trim() || ctx.leadName?.trim() || "Caller";
  }
  if (role === "system") return "System";
  return transcriptAgentName(ctx.agentIdentity, ctx.productName);
}

/** Compact unit labels from seconds: `12s`, `2m 42s`, or `1h 2m 3s`. */
export function formatDuration(sec?: number): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return "";
  const total = Math.round(sec);
  if (total <= 0) return "";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

export function formatHoverByPath(hover?: Record<string, number>): string {
  if (!hover) return "";
  return Object.entries(hover)
    .filter(([, value]) => value > 0)
    .map(([path, value]) => `${path} ${formatDuration(value)}`)
    .join(", ");
}

export function formatDateOnly(iso?: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(t);
}

export function callWhenIso(call: SundialCallRecord): string | undefined {
  if (call.status === "queued" && call.retryDueAt) return call.retryDueAt;
  return call.dialedAt || call.requestedAt;
}

export function sortCallsForJourney(calls: SundialCallRecord[]): SundialCallRecord[] {
  return [...calls].sort((a, b) => {
    const left = Date.parse(callWhenIso(a) || "") || 0;
    const right = Date.parse(callWhenIso(b) || "") || 0;
    return right - left;
  });
}

export function callJourneyBlurb(call: SundialCallRecord): string {
  const opp = call.opportunityProfile;
  const summary = asOppText(opp?.callSummary?.value);
  const wants = asOppText(opp?.leadWants?.value);
  const pain = insightText(asOppText(opp?.painCategory?.value)) || insightText(asOppText(opp?.primaryPain?.value));
  const useCase = asOppText(opp?.useCase?.value);
  const evidence = asOppText(opp?.extractedGoals?.evidenceSummary?.value);

  if (call.status === "no_answer") return MISSED_PICKUP_ACTION;
  if (call.status === "failed") return call.errorReason || "Call failed before a conversation.";
  if (call.status === "queued" && call.retryOfCallId) {
    const due = formatDateTime(call.retryDueAt);
    return due ? `Follow-up discovery call scheduled for ${due}.` : "Follow-up discovery call scheduled.";
  }
  if (call.status === "queued") return "Discovery call queued.";
  if (call.status === "dialing") return "Dialing now.";
  if (call.status === "in_progress") return "Discovery conversation in progress.";
  if (summary) return summary;
  if (wants) return wants;
  if (evidence) return evidence;
  if (useCase && pain && pain !== "—") return `${useCase}; pain: ${pain}.`;
  if (useCase) return useCase;
  if (pain && pain !== "—") return `Discussed ${pain}.`;
  if (call.status === "completed") return "Discovery call completed.";
  return callStatusLabel(call.status);
}

export function leadDiscoveryFacts(lead: LeadQueueItem): DiscoveryFact[] {
  const opp = lead.opportunity;
  const facts: DiscoveryFact[] = [];
  const nextActions = (opp?.nextActions?.value || [])
    .map((item) => asOppText(item))
    .filter((item): item is string => Boolean(item));
  const action = displayAction(opp?.recommendedAction?.value);
  if (nextActions.length === 0 && action !== "—") nextActions.push(action);
  const useCase = asOppText(opp?.useCase?.value) || lead.lead.useCase?.trim();
  const size = asOppText(opp?.companySize?.value) || lead.lead.companySize?.trim();
  const alternatives = (opp?.alternatives?.value || []).filter((item) => asOppText(item));
  const timeline = asOppText(opp?.timeline?.value);
  const pain = insightText(asOppText(opp?.painCategory?.value)) || insightText(asOppText(opp?.primaryPain?.value));

  if (useCase) facts.push({ label: "Use case", value: useCase });
  if (size) facts.push({ label: "Size", value: size });
  if (alternatives.length) facts.push({ label: "Alternatives", value: alternatives.join(", ") });
  if (timeline) facts.push({ label: "Timeline", value: timeline });
  if (pain && pain !== "—") facts.push({ label: "Pain point", value: pain });
  if (nextActions.length) facts.push({ label: "Next for sales", value: nextActions.join(" · ") });
  return facts;
}

export function leadProfileSummary(lead: LeadQueueItem): string {
  const summary = asOppText(lead.opportunity?.callSummary?.value);
  if (summary) return summary;
  const wants = asOppText(lead.opportunity?.leadWants?.value);
  if (wants) return wants;

  const companyDoes = asOppText(lead.opportunity?.companyDescription?.value);
  const useCase = asOppText(lead.opportunity?.useCase?.value) || lead.lead.useCase?.trim();
  const pain = insightText(asOppText(lead.opportunity?.painCategory?.value)) || insightText(asOppText(lead.opportunity?.primaryPain?.value));
  const size = asOppText(lead.opportunity?.companySize?.value) || lead.lead.companySize?.trim();
  const timeline = asOppText(lead.opportunity?.timeline?.value);
  const interest = lead.declaredInterest
    .filter((tag) =>
      ["pricing", "enterprise", "security", "demo", "get_demo", "talk_to_sales", "reviews"].includes(tag) ||
      tag.startsWith("plan_")
    )
    .slice(0, 3)
    .map((tag) => tag.replace(/_/g, " "));

  const bits: string[] = [];
  if (companyDoes) bits.push(companyDoes);
  if (useCase) bits.push(useCase);
  if (pain && pain.toLowerCase() !== useCase?.toLowerCase()) bits.push(pain);
  if (size) bits.push(size);
  if (timeline) bits.push(timeline);
  if (bits.length === 0 && interest.length) bits.push(`Interest in ${interest.join(", ")}`);

  if (bits.length === 0) {
    return lead.intent.level === "high"
      ? "High-intent inbound contact; no discovery notes yet."
      : "Identified inbound contact; no discovery notes yet.";
  }
  if (bits.length === 1) return `${capitalizeSentence(bits[0])}.`;
  return `${capitalizeSentence(bits[0])}; ${bits.slice(1).join(", ")}.`;
}

export function formatDateTime(iso?: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(t);
}

export function callWhenLabel(call: SundialCallRecord): string {
  if (call.status === "queued" && call.retryDueAt) {
    return formatDateTime(call.retryDueAt) || "Time not recorded";
  }
  return formatDateTime(call.dialedAt || call.requestedAt) || "Time not recorded";
}

export function warmthWidth(score: number): number {
  return Math.max(6, Math.min(100, (score / INTENT_SCORE_CEILING) * 100));
}

export function intentScoreLabel(score: number): string {
  return `${Math.max(0, Math.round(score))}/${INTENT_SCORE_CEILING}`;
}

export function warmthHeadline(score: number, priority: OpportunityPriority): string {
  return `${intentScoreLabel(score)} · ${priorityLabel(priority)}`;
}

export function callForLead(lead: LeadQueueItem, calls: SundialCallRecord[]): SundialCallRecord | undefined {
  return calls.find((c) => c.id === lead.latestCallId);
}

export type LeadTableSortKey = "company" | "warmth" | "profile" | "status";
export type SortDirection = "asc" | "desc";

function collateLabel(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

export function defaultLeadSortDirection(key: LeadTableSortKey): SortDirection {
  return key === "warmth" ? "desc" : "asc";
}

export function leadStatusSortRank(lead: LeadQueueItem, call?: SundialCallRecord): number {
  if (lead.priority === "disqualified") return 80;
  const status = lead.latestCallStatus;
  if (status === "in_progress") return 10;
  if (status === "dialing") return 20;
  if (status === "queued" && (call?.retryOfCallId || call?.retryDueAt)) return 30;
  if (status === "queued") return 40;
  if (status === "no_answer") return 50;
  if (status === "failed") return 60;
  if (!lead.latestCallId && !status) return 70;
  if (status === "completed") return 75;
  return 90;
}

export function compareLeadsByColumn(
  a: LeadQueueItem,
  b: LeadQueueItem,
  key: LeadTableSortKey,
  calls: SundialCallRecord[] = []
): number {
  if (key === "company") {
    const company = collateLabel(companyLabel(a), companyLabel(b));
    if (company !== 0) return company;
    return collateLabel(contactLabel(a), contactLabel(b));
  }
  if (key === "warmth") return a.intent.score - b.intent.score;
  if (key === "profile") return collateLabel(leadProfileSummary(a), leadProfileSummary(b));
  const leftCall = callForLead(a, calls);
  const rightCall = callForLead(b, calls);
  const rank = leadStatusSortRank(a, leftCall) - leadStatusSortRank(b, rightCall);
  if (rank !== 0) return rank;
  const left = leadStatusSummary(a, leftCall);
  const right = leadStatusSummary(b, rightCall);
  const headline = collateLabel(left.headline, right.headline);
  if (headline !== 0) return headline;
  return collateLabel(left.detail, right.detail);
}

export function sortLeadQueue(
  leads: LeadQueueItem[],
  key: LeadTableSortKey | null,
  direction: SortDirection,
  calls: SundialCallRecord[] = []
): LeadQueueItem[] {
  if (!key) return leads;
  const signed = direction === "asc" ? 1 : -1;
  return [...leads].sort((a, b) => {
    const cmp = compareLeadsByColumn(a, b, key, calls);
    if (cmp !== 0) return cmp * signed;
    return a.visitorId.localeCompare(b.visitorId);
  });
}

export const SQD_HINT =
  "Sales-qualified discovery: the call met BANT (budget, authority, need, and timeline), so this is a real opportunity, not just a chat.";

/** Harvard Business Review lead-response window: call a warm inbound lead within 5 minutes. */
export const SPEED_TO_RING_SLA_SEC = 5 * 60;

export function speedToRingSlaMet(avgResponseTimeSec: number): boolean {
  return avgResponseTimeSec > 0 && avgResponseTimeSec <= SPEED_TO_RING_SLA_SEC;
}

export const FUNNEL: Array<{
  key: keyof AnalyticsSnapshot["funnel"];
  n: string;
  title: string;
  hint?: string;
  meta: (a: AnalyticsSnapshot) => string;
}> = [
  { key: "inboundVisitors", n: "01", title: "Site Visitors", meta: () => "Raw ingest" },
  {
    key: "highIntentVisitors",
    n: "02",
    title: "High Intent",
    meta: (a) => `${pct(a.funnel.highIntentVisitors, a.funnel.inboundVisitors)} of traffic`
  },
  {
    key: "callRequests",
    n: "03",
    title: "Dispatched",
    meta: (a) => `${pct(a.funnel.callRequests, a.funnel.highIntentVisitors)} of intent`
  },
  {
    key: "callsCompleted",
    n: "04",
    title: "Connected",
    meta: (a) => `${pct(a.funnel.callsCompleted, a.funnel.callRequests)} pickup`
  },
  {
    key: "salesQualified",
    n: "05",
    title: "Valid SQD",
    hint: SQD_HINT,
    meta: (a) => `${pct(a.funnel.salesQualified, a.funnel.callsCompleted)} BANT met`
  },
  {
    key: "humanFollowUps",
    n: "06",
    title: "Human follow-up",
    meta: (a) => `${pct(a.funnel.humanFollowUps, a.funnel.salesQualified)} recommended`
  }
];
