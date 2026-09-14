export type OutcomeItem = { label: string; value: string; tone?: "confirmed" | "unresolved" };
export type ResolutionReport = { outcome: { confirmed: OutcomeItem[]; unresolved: OutcomeItem[]; nextAction: string; humanEscalation: boolean; notes: string } };
// Retained for the reusable card components used by earlier prototype views.
export type Risk = { title: string; severity: "High" | "Moderate"; impact?: string };
export type RecommendedAction = { action: string; owner: string };
