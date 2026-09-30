import { behaviorFromEvents, declaredInterestFromEvents } from "./profile.ts";
import { queuePriority } from "./opportunity.ts";
import { companySizeChartLabel, insightText, wordCount } from "./phrases.ts";
import { scoreEvents } from "./score.ts";
import type {
  AnalyticsSnapshot,
  CountBucket,
  DailyPoint,
  IdentifiedLead,
  LeadQueueItem,
  OpportunityProfile,
  SundialCallRecord,
  SundialEvent,
  VisitorRecord
} from "../types.ts";

function analyticsPainLabel(opp: OpportunityProfile): string | undefined {
  const category = insightText(typeof opp.painCategory?.value === "string" ? opp.painCategory.value : undefined);
  if (category && wordCount(category) < 4) return category;
  const pain = insightText(typeof opp.primaryPain?.value === "string" ? opp.primaryPain.value : undefined);
  if (pain && wordCount(pain) < 4) return pain;
  return undefined;
}

function bump(map: Map<string, number>, label?: string) {
  if (!label || !label.trim()) return;
  const key = label.trim();
  map.set(key, (map.get(key) || 0) + 1);
}

function buckets(map: Map<string, number>, limit = 8): CountBucket[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function leadFromVisitor(visitor: VisitorRecord): IdentifiedLead {
  return {
    email: visitor.email,
    phone: visitor.phone,
    company: visitor.company,
    name: visitor.name,
    companySize: visitor.companySize,
    useCase: visitor.useCase
  };
}

export function buildLeadQueue(
  visitors: VisitorRecord[],
  eventsByVisitor: Map<string, SundialEvent[]>,
  calls: SundialCallRecord[]
): LeadQueueItem[] {
  const latestCall = new Map<string, SundialCallRecord>();
  for (const call of calls) {
    const id = call.visitorId;
    if (!id) continue;
    const prev = latestCall.get(id);
    if (!prev || Date.parse(call.requestedAt) > Date.parse(prev.requestedAt)) {
      latestCall.set(id, call);
    }
  }

  const items: LeadQueueItem[] = [];
  for (const visitor of visitors) {
    const events = eventsByVisitor.get(visitor.visitorId) || [];
    const intent = scoreEvents(events);
    const behavior = behaviorFromEvents(events);
    const call = latestCall.get(visitor.visitorId);
    const identified = Boolean(visitor.identifiedAt || visitor.email || visitor.phone);
    if (!identified && intent.level === "low" && !call) continue;

    const opportunity = call?.opportunityProfile;
    items.push({
      visitorId: visitor.visitorId,
      accountId: visitor.accountId,
      lead: leadFromVisitor(visitor),
      intent,
      behavior,
      declaredInterest: declaredInterestFromEvents(events),
      latestCallId: call?.id,
      latestCallStatus: call?.status,
      opportunity,
      priority: queuePriority(intent, opportunity),
      lastSeenAt: visitor.lastSeenAt
    });
  }

  const rank: Record<string, number> = { very_high: 0, high: 1, nurture: 2, disqualified: 3 };
  return items.sort((a, b) => {
    const pr = (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9);
    if (pr !== 0) return pr;
    return b.intent.score - a.intent.score;
  });
}

export function buildAnalytics(
  visitors: VisitorRecord[],
  events: SundialEvent[],
  calls: SundialCallRecord[]
): AnalyticsSnapshot {
  const eventsByVisitor = new Map<string, SundialEvent[]>();
  for (const event of events) {
    const list = eventsByVisitor.get(event.visitorId) || [];
    list.push(event);
    eventsByVisitor.set(event.visitorId, list);
  }

  const visitorIds = new Set(visitors.map((v) => v.visitorId));
  for (const id of eventsByVisitor.keys()) visitorIds.add(id);

  let highIntent = 0;
  let intentSum = 0;
  let intentCount = 0;
  for (const id of visitorIds) {
    const profile = scoreEvents(eventsByVisitor.get(id) || []);
    intentSum += profile.score;
    intentCount += 1;
    if (profile.level === "high") highIntent += 1; // score >= INTENT_HIGH_MIN (60/100)
  }

  const identified = visitors.filter((v) => v.identifiedAt || v.email);
  const completed = calls.filter((c) => c.status === "completed");
  const sqo = completed.filter(
    (c) =>
      c.opportunityProfile?.priority === "very_high" ||
      c.opportunityProfile?.priority === "high" ||
      c.leadDossier?.intentTier === "hot"
  );
  const followUps = completed.filter((c) => c.opportunityProfile?.wantsHumanFollowUp?.value);

  const speeds = completed.map((c) => c.speedToDialSec).filter((n): n is number => typeof n === "number");
  const oppScores = completed
    .map((c) => c.opportunityProfile?.scores.overall.value)
    .filter((n): n is number => typeof n === "number");

  const pains = new Map<string, number>();
  const uses = new Map<string, number>();
  const sizes = new Map<string, number>();
  const timelines = new Map<string, number>();
  const competitors = new Map<string, number>();
  const objections = new Map<string, number>();

  const takeOpp = (opp?: OpportunityProfile) => {
    if (!opp) return;
    bump(pains, analyticsPainLabel(opp));
    bump(uses, insightText(typeof opp.useCase?.value === "string" ? opp.useCase.value : undefined));
    bump(sizes, companySizeChartLabel(typeof opp.companySize?.value === "string" ? opp.companySize.value : undefined));
    bump(timelines, insightText(typeof opp.timeline?.value === "string" ? opp.timeline.value : undefined));
    for (const name of opp.alternatives?.value || []) bump(competitors, name);
    for (const obj of opp.objections?.value || []) bump(objections, obj);
  };

  for (const call of completed) takeOpp(call.opportunityProfile);

  const inboundVisitors = visitorIds.size;
  const avgIntent = intentCount ? intentSum / intentCount : 0;
  const avgOpp = oppScores.length ? oppScores.reduce((a, b) => a + b, 0) / oppScores.length : 0;
  const avgSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;

  return {
    funnel: {
      inboundVisitors,
      highIntentVisitors: highIntent,
      callRequests: calls.length,
      callsCompleted: completed.length,
      salesQualified: sqo.length,
      humanFollowUps: followUps.length
    },
    kpis: {
      inboundLeads: identified.length,
      highIntentLeads: highIntent,
      callsRequested: calls.length,
      callsCompleted: completed.length,
      avgResponseTimeSec: parseFloat(avgSpeed.toFixed(1)),
      salesQualifiedLeads: sqo.length,
      avgIntentScore: parseFloat(avgIntent.toFixed(1)),
      avgOpportunityScore: parseFloat(avgOpp.toFixed(1))
    },
    intelligence: {
      topPainPoints: buckets(pains),
      commonUseCases: buckets(uses),
      companySizeDistribution: buckets(sizes),
      timelines: buckets(timelines),
      competitors: buckets(competitors),
      objections: buckets(objections)
    },
    series: buildDailySeries(events, calls, eventsByVisitor)
  };
}

export function buildDailySeries(
  events: SundialEvent[],
  calls: SundialCallRecord[],
  eventsByVisitor?: Map<string, SundialEvent[]>
): DailyPoint[] {
  const byVisitor = eventsByVisitor || new Map<string, SundialEvent[]>();
  if (!eventsByVisitor) {
    for (const event of events) {
      const list = byVisitor.get(event.visitorId) || [];
      list.push(event);
      byVisitor.set(event.visitorId, list);
    }
  }

  const dayKey = (iso: string) => iso.slice(0, 10);
  const days = new Map<string, DailyPoint>();
  const ensure = (key: string): DailyPoint => {
    const existing = days.get(key);
    if (existing) return existing;
    const created: DailyPoint = { date: key, visitors: 0, highIntent: 0, calls: 0, completed: 0 };
    days.set(key, created);
    return created;
  };

  const visitorsByDay = new Map<string, Set<string>>();
  for (const event of events) {
    const key = dayKey(event.timestamp);
    const set = visitorsByDay.get(key) || new Set<string>();
    set.add(event.visitorId);
    visitorsByDay.set(key, set);
    ensure(key);
  }
  for (const [key, set] of visitorsByDay) {
    const row = ensure(key);
    row.visitors = set.size;
    let hot = 0;
    for (const visitorId of set) {
      const dayEvents = (byVisitor.get(visitorId) || []).filter((item) => dayKey(item.timestamp) === key);
      if (scoreEvents(dayEvents).level === "high") hot += 1;
    }
    row.highIntent = hot;
  }

  for (const call of calls) {
    const key = dayKey(call.requestedAt);
    const row = ensure(key);
    row.calls += 1;
    if (call.status === "completed") row.completed += 1;
  }

  return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));
}
