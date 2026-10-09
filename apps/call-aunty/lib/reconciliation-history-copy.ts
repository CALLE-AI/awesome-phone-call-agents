import type { ReconciliationHistoryEntry } from "./reconciliation-history";
import type { AppLanguage } from "./language";

const localeByLanguage: Record<AppLanguage, string> = {
  bn: "bn-BD",
  en: "en-US",
  hi: "hi-IN",
  ur: "ur-PK",
  ta: "ta-IN",
  te: "te-IN",
};

export function formatReconciliationHistory(entry: ReconciliationHistoryEntry | undefined, language: AppLanguage, copy: { label: string; server: string; fallback: string; decisionKept?: string; decisionAccepted?: string }) {
  if (!entry) return null;
  const locale = localeByLanguage[language] ?? localeByLanguage.en;
  const date = new Date(entry.timestamp).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
  const time = new Date(entry.timestamp).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const state = entry.serverAvailable ? copy.server : copy.fallback;
  const decision = entry.decision === "kept_local" ? copy.decisionKept : entry.decision === "accepted_server" ? copy.decisionAccepted : undefined;
  const reviewedLabel = language === "bn" ? "টি আইটেম দেখা হয়েছে" : language === "hi" ? "आइटम देखे गए" : language === "ur" ? "آئٹمز دیکھے گئے" : language === "ta" ? "உருப்படிகள் மதிப்பாய்வு செய்யப்பட்டன" : language === "te" ? "అంశాలు సమీక్షించబడ్డాయి" : "items reviewed";
  return `${copy.label}: ${date}, ${time} · ${state}${decision ? ` · ${decision}` : ""} · ${entry.syncedCount + entry.preservedCount} ${reviewedLabel}`;
}
