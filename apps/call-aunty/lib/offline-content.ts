import type { AppLanguage } from "@/lib/language";

export type OfflineContentTopic = "warning_signs" | "care_visits" | "nutrition" | "privacy";

export type OfflineContentPack = {
  language: AppLanguage;
  topics: readonly OfflineContentTopic[];
  version: string;
  bundled: boolean;
};

const CORE_TOPICS: readonly OfflineContentTopic[] = ["warning_signs", "care_visits", "nutrition", "privacy"];

export function getOfflineContentPack(language: AppLanguage): OfflineContentPack {
  return { language, topics: CORE_TOPICS, version: "2026.08", bundled: true };
}

export function isOfflineContentAvailable(language: AppLanguage, topic: OfflineContentTopic): boolean {
  return getOfflineContentPack(language).bundled && getOfflineContentPack(language).topics.includes(topic);
}

export function getOfflineContentTopicCount(language: AppLanguage): number {
  return getOfflineContentPack(language).topics.length;
}
