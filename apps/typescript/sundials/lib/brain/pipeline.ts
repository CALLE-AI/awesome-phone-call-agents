import type { SundialCallRecord } from "../types.ts";
import type { SundialsDatabase } from "../db.ts";
import { readBrainConfig, writeBrainConfig } from "./config.ts";
import { clusterBrainSuggestions } from "./cluster.ts";
import { geminiConfigured } from "./gemini.ts";
import { hasGeminiBriefing, mergePainCatalogs, painCatalogSettled, profileCallWithGemini } from "./extract.ts";
import { insightText } from "../intent/phrases.ts";
import { HARBOR_ACCOUNT_ID } from "../sdk/public-key.ts";

const CLUSTER_EVERY = 5;
const PROFILE_COOLDOWN_MS = 120_000;
const inFlight = new Set<string>();
const lastAttempt = new Map<string, number>();

export function transcriptReady(call: {
  fullTranscript?: string;
  transcript?: Array<{ text: string }>;
}): boolean {
  return Boolean(call.fullTranscript?.trim() || call.transcript?.some((entry) => entry.text.trim()));
}

export function needsGeminiProfile(call: SundialCallRecord): boolean {
  if (!geminiConfigured()) return false;
  if (call.status !== "completed") return false;
  if (!transcriptReady(call)) return false;
  return !hasGeminiBriefing(call) || !painCatalogSettled(call);
}

function recentlyAttempted(callId: string): boolean {
  const at = lastAttempt.get(callId);
  return Boolean(at && Date.now() - at < PROFILE_COOLDOWN_MS);
}

export function scheduleMissingBriefings(store: SundialsDatabase, calls: SundialCallRecord[], limit = 3): void {
  let queued = 0;
  for (const call of calls) {
    if (!needsGeminiProfile(call)) continue;
    scheduleBrainAfterCall(store, call.id);
    queued += 1;
    if (queued >= limit) break;
  }
}

function persistPainCatalog(store: SundialsDatabase, accountId: string, extra: string[] = []): void {
  const latest = readBrainConfig(accountId);
  const fromCalls = store
    .getAllCalls()
    .filter((call) => (call.session?.accountId || HARBOR_ACCOUNT_ID) === accountId)
    .map((call) => call.opportunityProfile?.painCategory?.value);
  const merged = mergePainCatalogs(latest.painCategories, extra, fromCalls);
  if (JSON.stringify(merged) !== JSON.stringify(latest.painCategories || [])) {
    writeBrainConfig({ ...latest, painCategories: merged });
  }
}

export function syncPainCatalogFromCalls(store: SundialsDatabase, accountId = HARBOR_ACCOUNT_ID): void {
  persistPainCatalog(store, accountId);
}

export function scheduleBrainAfterCall(store: SundialsDatabase, callId: string): void {
  if (!geminiConfigured()) return;
  if (inFlight.has(callId) || recentlyAttempted(callId)) return;
  void runBrainAfterCall(store, callId).catch(() => {
    inFlight.delete(callId);
  });
}

export async function runBrainAfterCall(store: SundialsDatabase, callId: string): Promise<void> {
  if (!geminiConfigured()) return;
  if (inFlight.has(callId) || recentlyAttempted(callId)) return;
  inFlight.add(callId);
  lastAttempt.set(callId, Date.now());
  try {
    const call = store.getCall(callId);
    if (!call || call.status !== "completed") return;
    if (!transcriptReady(call)) return;

    let next = call;
    const accountId = call.session.accountId || HARBOR_ACCOUNT_ID;
    if (!hasGeminiBriefing(call) || !painCatalogSettled(call)) {
      const config = readBrainConfig(accountId);
      const result = await profileCallWithGemini(call, config.productName, config.painCategories || []);
      const profile = result?.profile;
      const dossier = call.leadDossier
        ? {
            ...call.leadDossier,
            triggerPain: insightText(call.leadDossier.triggerPain) || profile?.painCategory?.value || profile?.primaryPain?.value || "",
            scopeRequirement: insightText(call.leadDossier.scopeRequirement) || profile?.useCase?.value || "",
            urgencyTimeline: insightText(call.leadDossier.urgencyTimeline) || profile?.timeline?.value || "",
            decisionAuthority: insightText(call.leadDossier.decisionAuthority) || profile?.decisionMaker?.value || ""
          }
        : call.leadDossier;
      next = {
        ...call,
        opportunityProfile: profile || call.opportunityProfile,
        leadDossier: dossier,
        brainExtractedAt: new Date().toISOString()
      };
      store.saveCall(next);
      persistPainCatalog(store, accountId, result?.painCategories || []);
    } else if (!call.brainExtractedAt) {
      next = { ...call, brainExtractedAt: new Date().toISOString() };
      store.saveCall(next);
    }

    const clusteredAccountId = next.session.accountId || HARBOR_ACCOUNT_ID;
    const config = readBrainConfig(clusteredAccountId);
    const completed = store.getAllCalls().filter((item) => item.status === "completed" && transcriptReady(item));
    if (completed.length > 0 && completed.length % CLUSTER_EVERY === 0 && completed.length !== (config.lastClusteredCompletedCount || 0)) {
      const suggestions = await clusterBrainSuggestions(config, completed);
      if (suggestions.length > 0) {
        writeBrainConfig({
          ...config,
          suggestions: [...suggestions, ...config.suggestions].slice(0, 8),
          lastClusteredCompletedCount: completed.length
        });
      } else {
        writeBrainConfig({ ...config, lastClusteredCompletedCount: completed.length });
      }
    }
  } finally {
    inFlight.delete(callId);
  }
}
