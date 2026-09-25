export type ReconciliationFeedbackCopy = {
  synced: string;
  preserved: string;
  fallback: string;
};

export function formatReconciliationFeedback({ syncedCount, preservedCount, serverAvailable, copy }: { syncedCount: number; preservedCount: number; serverAvailable: boolean; copy: ReconciliationFeedbackCopy }) {
  if (!serverAvailable) return copy.fallback;
  if (syncedCount > 0 && preservedCount > 0) return `${syncedCount} ${copy.synced} · ${preservedCount} ${copy.preserved}`;
  if (syncedCount > 0) return `${syncedCount} ${copy.synced}`;
  if (preservedCount > 0) return `${preservedCount} ${copy.preserved}`;
  return copy.synced;
}
