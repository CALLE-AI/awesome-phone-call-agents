import type { IntentLevel, IntentProfile, IntentSignal, SundialEvent } from "../types.ts";

/** Intent score is out of 100. High/medium cutoffs are 60/30 (same ratios as the old 50-point 30/15 bands). */
export const INTENT_SCORE_CEILING = 100;
export const INTENT_HIGH_MIN = 60;
export const INTENT_MEDIUM_MIN = 30;

const CTA_POINTS: Record<string, number> = {
  talk_to_sales: 15,
  get_demo: 12,
  learn_more: 4
};

const PATH_POINTS: Record<string, number> = {
  "/demo/pricing": 3,
  "/pricing": 3,
  "/demo/contact": 4,
  "/contact": 4,
  "/contact-sales": 6,
  "/demo/reviews": 2,
  "/demo/faq": 1,
  "/integrations": 2
};

function normalizePath(path: string): string {
  const raw = path.split("?")[0] || "/";
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw || "/";
}

function pathPoints(path: string): { points: number; type: string } | null {
  const p = normalizePath(path).toLowerCase();
  if (PATH_POINTS[p] != null) {
    return { points: PATH_POINTS[p], type: p.includes("pricing") ? "pricing_interest" : p.includes("contact") ? "contact_intent" : "page_interest" };
  }
  if (p.includes("enterprise")) return { points: 5, type: "enterprise_interest" };
  if (p.includes("security")) return { points: 4, type: "security_interest" };
  if (p.includes("pricing")) return { points: 3, type: "pricing_interest" };
  return null;
}

function slugTag(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function planFromProps(properties: Record<string, unknown>): string {
  return slugTag(properties.plan);
}

const PLAN_POINTS: Record<string, number> = {
  starter: 4,
  professional: 5,
  enterprise: 6
};

function ctaName(properties: Record<string, unknown>): string {
  const name = properties.name ?? properties.cta ?? properties.label;
  return typeof name === "string" ? name.trim().toLowerCase().replace(/\s+/g, "_") : "";
}

function eventPath(properties: Record<string, unknown>): string {
  const path = properties.path ?? properties.page ?? properties.landingUrl;
  return typeof path === "string" ? path : "";
}

export function intentLevelFromScore(score: number): IntentLevel {
  if (score >= INTENT_HIGH_MIN) return "high";
  if (score >= INTENT_MEDIUM_MIN) return "medium";
  return "low";
}

export function scoreEvents(events: SundialEvent[]): IntentProfile {
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  let score = 0;
  const signals: IntentSignal[] = [];
  const ctaOnce = new Set<string>();
  const pathApplications = new Map<string, number>();
  const sessionIds = new Set<string>();
  const hoverByPath = new Map<string, number>();
  let returningApplied = false;
  let phoneApplied = false;
  let emailApplied = false;

  for (const item of sorted) {
    sessionIds.add(item.sessionId);
    const props = item.properties || {};

    if (item.event === "page_view") {
      const path = eventPath(props);
      const hit = pathPoints(path);
      if (hit) {
        const applied = pathApplications.get(hit.type) || 0;
        if (applied < 2) {
          pathApplications.set(hit.type, applied + 1);
          score += hit.points;
          signals.push({ type: hit.type, source: "page_view", confidence: 0.85 });
        }
      }
    }

    if (item.event === "cta_clicked") {
      const name = ctaName(props);
      if (name && !ctaOnce.has(name)) {
        ctaOnce.add(name);
        const points = CTA_POINTS[name] ?? 3;
        score += points;
        signals.push({
          type: name === "talk_to_sales" ? "sales_intent" : name,
          source: "cta_clicked",
          confidence: name === "talk_to_sales" ? 0.98 : 0.9
        });
      }
      const plan = planFromProps(props);
      if (plan && !ctaOnce.has(`plan:${plan}`)) {
        ctaOnce.add(`plan:${plan}`);
        score += PLAN_POINTS[plan] ?? 3;
        signals.push({
          type: `plan_${plan}`,
          source: "cta_clicked",
          confidence: 0.9
        });
      }
    }

    if (item.event === "faq_opened") {
      const topic = slugTag(props.topic) || slugTag(props.question);
      if (topic && !ctaOnce.has(`faq:${topic}`)) {
        ctaOnce.add(`faq:${topic}`);
        score += 2;
        signals.push({ type: `faq_${topic}`, source: "faq_opened", confidence: 0.75 });
      }
    }

    if (item.event === "enterprise_interest") {
      score += 5;
      signals.push({ type: "enterprise_interest", source: "track", confidence: 0.92 });
    }

    if (item.event === "demo_requested" || item.event === "demo_completed") {
      score += 7;
      signals.push({ type: item.event, source: "track", confidence: 0.93 });
    }

    if (item.event === "identify" || item.event === "phone_provided") {
      const phone = props.phone;
      const email = props.email;
      if (!phoneApplied && typeof phone === "string" && phone.trim()) {
        phoneApplied = true;
        score += 10;
        signals.push({ type: "phone_provided", source: "identify", confidence: 0.99 });
      }
      if (!emailApplied && typeof email === "string" && email.trim()) {
        emailApplied = true;
        score += 5;
        signals.push({ type: "email_provided", source: "identify", confidence: 0.99 });
      }
    }

    if (item.event === "page_hover") {
      const path = eventPath(props);
      const hoverSec = props.hoverSec;
      if (path && typeof hoverSec === "number" && Number.isFinite(hoverSec) && hoverSec > 0) {
        hoverByPath.set(path, (hoverByPath.get(path) || 0) + hoverSec);
      }
    }
  }

  for (const [path, hoverSec] of hoverByPath) {
    if (hoverSec < 8) continue;
    const hit = pathPoints(path);
    if (!hit) continue;
    const key = `hover:${hit.type}`;
    if (pathApplications.has(key)) continue;
    pathApplications.set(key, 1);
    score += 2;
    signals.push({ type: "page_hover", source: "page_hover", confidence: 0.7 });
  }

  if (!returningApplied && sessionIds.size > 1) {
    returningApplied = true;
    score += 3;
    signals.push({ type: "returning_visitor", source: "session", confidence: 0.8 });
  }

  const uniqueSignals: IntentSignal[] = [];
  const seen = new Set<string>();
  for (const signal of signals) {
    const key = `${signal.type}:${signal.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueSignals.push(signal);
  }

  return {
    score,
    level: intentLevelFromScore(score),
    signals: uniqueSignals
  };
}
