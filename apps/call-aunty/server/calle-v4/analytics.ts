import type { CalleCall } from "./types";

export function summarize(calls: CalleCall[]) {
  const total = calls.length;
  const completed = calls.filter((call) => call.status === "completed").length;
  const failed = calls.filter((call) => call.status === "failed").length;
  const active = calls.filter((call) => call.status === "queued" || call.status === "in_progress").length;
  return {
    total,
    completed,
    failed,
    active,
    completionRate: total ? completed / total : 0,
    failureRate: total ? failed / total : 0,
  };
}

export function outcomeCounts(calls: CalleCall[], field: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const call of calls) {
    const value = call.structured_result?.[field];
    const key = typeof value === "string" ? value : "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
