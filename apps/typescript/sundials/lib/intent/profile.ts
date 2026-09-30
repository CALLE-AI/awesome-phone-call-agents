import type { BehaviorSnapshot, SundialEvent } from "../types.ts";

function normalizePath(path: string): string {
  const raw = (path.split("?")[0] || "/").trim() || "/";
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw;
}

function eventPath(properties: Record<string, unknown>): string | undefined {
  const path = properties.path ?? properties.page ?? properties.landingUrl;
  return typeof path === "string" && path.trim() ? normalizePath(path) : undefined;
}

export function declaredInterestFromEvents(events: SundialEvent[]): string[] {
  const tags = new Set<string>();
  for (const item of events) {
    if (item.event === "cta_clicked") {
      const name = item.properties?.name;
      if (typeof name === "string" && name.trim()) tags.add(name.trim().toLowerCase().replace(/\s+/g, "_"));
      const plan = item.properties?.plan;
      if (typeof plan === "string" && plan.trim()) {
        tags.add(`plan_${plan.trim().toLowerCase().replace(/\s+/g, "_")}`);
      }
    }
    if (item.event === "faq_opened") {
      const topic =
        (typeof item.properties?.topic === "string" && item.properties.topic.trim()) ||
        (typeof item.properties?.question === "string" && item.properties.question.trim()) ||
        "";
      if (topic) tags.add(`faq_${topic.toLowerCase().replace(/\s+/g, "_")}`);
    }
    if (item.event === "enterprise_interest") tags.add("enterprise");
    if (item.event === "demo_requested" || item.event === "demo_completed") tags.add("demo");
    if (item.event === "page_view") {
      const path = eventPath(item.properties || {}) || "";
      if (path.includes("pricing")) tags.add("pricing");
      if (path.includes("enterprise")) tags.add("enterprise");
      if (path.includes("security")) tags.add("security");
      if (path.includes("reviews")) tags.add("reviews");
      if (path.includes("faq")) tags.add("faq");
      if (path.includes("contact")) tags.add("contact");
    }
  }
  return Array.from(tags);
}

export function behaviorFromEvents(events: SundialEvent[], sessionId?: string): BehaviorSnapshot {
  const pageViewCounts: Record<string, number> = {};
  const pagesViewed: string[] = [];
  const hoverSecByPath: Record<string, number> = {};
  const sessionIds = new Set<string>();
  const sessionTimes: number[] = [];

  for (const item of events) {
    sessionIds.add(item.sessionId);
    const t = Date.parse(item.timestamp);
    if (Number.isFinite(t) && (!sessionId || item.sessionId === sessionId)) {
      sessionTimes.push(t);
    }
    if (item.event === "page_view") {
      const path = eventPath(item.properties || {});
      if (!path) continue;
      if (!pageViewCounts[path]) {
        pagesViewed.push(path);
        pageViewCounts[path] = 0;
      }
      pageViewCounts[path] += 1;
    }
    if (item.event === "page_hover") {
      const path = eventPath(item.properties || {});
      const hoverSec = item.properties?.hoverSec;
      if (!path || typeof hoverSec !== "number" || !Number.isFinite(hoverSec)) continue;
      hoverSecByPath[path] = (hoverSecByPath[path] || 0) + Math.max(0, Math.round(hoverSec));
    }
  }

  const sessionDurationSec =
    sessionTimes.length >= 2
      ? Math.max(0, Math.round((Math.max(...sessionTimes) - Math.min(...sessionTimes)) / 1000))
      : 0;

  return {
    pagesViewed,
    pageViewCounts,
    hoverSecByPath,
    returningVisitor: sessionIds.size > 1,
    sessionDurationSec,
    visitCount: Math.max(1, sessionIds.size)
  };
}

function themeLabel(tag: string): string {
  if (tag.startsWith("plan_")) return `${tag.slice(5).replace(/_/g, " ")} plan`;
  if (tag.startsWith("faq_")) return `FAQ ${tag.slice(4).replace(/_/g, " ")}`;
  return tag.replace(/_/g, " ");
}

export function interestThemes(declaredInterest: string[]): string[] {
  return declaredInterest
    .filter(
      (tag) =>
        ["pricing", "enterprise", "security", "demo", "talk_to_sales", "get_demo", "reviews", "faq"].includes(tag) ||
        tag.startsWith("plan_") ||
        tag.startsWith("faq_")
    )
    .map(themeLabel);
}
