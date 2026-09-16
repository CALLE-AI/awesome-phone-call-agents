import { randomUUID } from "node:crypto";
import { healthPrompt, localClock, officialDomains, researchQuery, type DailyBriefing, type SeniorProfile, type BriefingSection } from "./model";
import type { WebSearchResult } from "../tools/search-web";

export type Search = (query: string, correlationId: string, domains: string[]) => Promise<WebSearchResult>;

export async function prepareBriefing(profile: SeniorProfile, fingerprint: string, search: Search, now = new Date(), previous: DailyBriefing[] = []): Promise<DailyBriefing> {
  if (!profile.consentToPersonalization) throw new Error("Personalization consent is required");
  const localDate = localClock(profile.timezone, now).date;
  const sections = await Promise.all(profile.topics.map(async (topic): Promise<BriefingSection> => {
    const unavailable = { topic, status: "unavailable" as const, answer: "No fresh verified information is available for this topic.", sources: [] };
    const domains = officialDomains(profile, topic);
    if ((topic === "benefits" || topic === "retirement") && !domains.length) return { ...unavailable, answer: "Official sources for this country have not been configured." };
    const recent = previous.filter((brief) => brief.profileId === profile.id).slice(0, 7)
      .flatMap((brief) => brief.sections.filter((section) => section.topic === topic && section.status === "ready").map((section) => ({ date: brief.localDate, summary: section.answer.slice(0, 700) })));
    try {
      const result = await search(`${researchQuery(profile, topic, localDate)}\nPREVIOUS_PREPARED_BRIEFS=${JSON.stringify(recent)}\nPrefer meaningful updates over repeating unchanged guidance. Previous briefs are not evidence of delivery or current truth.`, randomUUID(), domains);
      if (!result.answer.trim() || !result.sources.length) return unavailable;
      if (domains.length && result.sources.some((source) => {
        const hostname = new URL(source.url).hostname;
        return !domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
      })) return unavailable;
      return { topic, status: "ready", answer: result.answer, sources: result.sources };
    } catch { return unavailable; }
  }));
  const ready = sections.filter((section) => section.status === "ready").length;
  return { id: randomUUID(), profileId: profile.id, profileFingerprint: fingerprint, localDate, timezone: profile.timezone,
    preparedAt: now.toISOString(), status: ready === sections.length ? "ready" : ready ? "partial" : "unavailable", sections, healthPrompt: healthPrompt(profile, localDate) };
}
