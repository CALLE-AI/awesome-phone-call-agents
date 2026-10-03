export type SyncReachability = "online" | "offline" | "unknown";

export type SyncDiagnosticCounts = {
  queued: number;
  retrying: number;
  synced: number;
  exhausted: number;
};

export type SyncDiagnosticCopy = {
  online: string;
  offline: string;
  unknown: string;
  queued: string;
  retrying: string;
  synced: string;
  exhausted: string;
};

export function normalizeReachability(value: boolean | null | undefined): SyncReachability {
  if (value === true) return "online";
  if (value === false) return "offline";
  return "unknown";
}

export function formatSyncDiagnostic(reachability: SyncReachability, counts: SyncDiagnosticCounts, copy: SyncDiagnosticCopy) {
  const connection = reachability === "online" ? copy.online : reachability === "offline" ? copy.offline : copy.unknown;
  return `${connection}\n${counts.queued} ${copy.queued} · ${counts.retrying} ${copy.retrying} · ${counts.synced} ${copy.synced}${counts.exhausted > 0 ? ` · ${counts.exhausted} ${copy.exhausted}` : ""}`;
}
