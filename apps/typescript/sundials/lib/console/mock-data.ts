import type { AnalyticsSnapshot, DailyPoint } from "../types.ts";

type Range = "today" | "7d" | "30d";

function daysBack(count: number): DailyPoint[] {
  const out: DailyPoint[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date();
    date.setUTCHours(12, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - i);
    const wave = Math.sin(i / 3) * 8;
    const visitors = Math.max(6, Math.round(28 + wave + (count - i) * 0.4));
    const highIntent = Math.max(2, Math.round(visitors * 0.38));
    const calls = Math.max(1, Math.round(highIntent * 0.55));
    const completed = Math.max(0, Math.round(calls * 0.72));
    out.push({
      date: date.toISOString().slice(0, 10),
      visitors,
      highIntent,
      calls,
      completed
    });
  }
  return out;
}

function sliceSeries(series: DailyPoint[], range: Range): DailyPoint[] {
  const take = range === "today" ? 1 : range === "7d" ? 7 : 30;
  return series.slice(-take);
}

export function mockAnalytics(range: Range = "30d"): AnalyticsSnapshot {
  const series = sliceSeries(daysBack(30), range);
  const visitors = series.reduce((n, d) => n + d.visitors, 0);
  const highIntent = series.reduce((n, d) => n + d.highIntent, 0);
  const calls = series.reduce((n, d) => n + d.calls, 0);
  const completed = series.reduce((n, d) => n + d.completed, 0);
  const sqo = Math.round(completed * 0.58);
  const followUps = Math.round(sqo * 0.71);

  return {
    funnel: {
      inboundVisitors: visitors,
      highIntentVisitors: highIntent,
      callRequests: calls,
      callsCompleted: completed,
      salesQualified: sqo,
      humanFollowUps: followUps
    },
    kpis: {
      inboundLeads: Math.round(highIntent * 0.64),
      highIntentLeads: highIntent,
      callsRequested: calls,
      callsCompleted: completed,
      avgResponseTimeSec: 22.4,
      salesQualifiedLeads: sqo,
      avgIntentScore: 36.2,
      avgOpportunityScore: 7.4
    },
    intelligence: {
      topPainPoints: [
        { label: "Manual CRM admin", count: 18 },
        { label: "Lead routing lag", count: 14 },
        { label: "No call context", count: 11 },
        { label: "Forecast guesswork", count: 7 }
      ],
      commonUseCases: [
        { label: "Inbound qualification", count: 16 },
        { label: "Replace Salesforce", count: 9 },
        { label: "Expansion motion", count: 6 }
      ],
      companySizeDistribution: [
        { label: "51–200", count: 12 },
        { label: "11–50", count: 9 },
        { label: "201–1000", count: 7 },
        { label: "1–10", count: 4 }
      ],
      timelines: [
        { label: "1–2 months", count: 11 },
        { label: "This quarter", count: 8 },
        { label: "This week", count: 5 }
      ],
      competitors: [
        { label: "Salesforce", count: 9 },
        { label: "HubSpot", count: 7 },
        { label: "Pipedrive", count: 3 }
      ],
      objections: [
        { label: "Migration cost", count: 8 },
        { label: "Need security review", count: 5 }
      ]
    },
    series
  };
}
