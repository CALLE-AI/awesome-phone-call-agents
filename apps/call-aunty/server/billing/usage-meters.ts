import type { UsageMeterKey } from "./types";

type UsageRecord = {
  userId: number;
  meter: UsageMeterKey;
  attempted: number;
  successful: number;
  failed: number;
  billable: number;
  idempotencyKeys: Set<string>;
};

const store = new Map<string, UsageRecord>();

function key(userId: number, meter: UsageMeterKey) {
  return `${userId}:${meter}`;
}

export function resetUsageMeters() {
  store.clear();
}

export function getUsageForUser(userId: number, meter: UsageMeterKey): number {
  return store.get(key(userId, meter))?.billable ?? 0;
}

export function getUsageDetail(userId: number, meter: UsageMeterKey) {
  const rec = store.get(key(userId, meter));
  return {
    attempted: rec?.attempted ?? 0,
    successful: rec?.successful ?? 0,
    failed: rec?.failed ?? 0,
    billable: rec?.billable ?? 0,
  };
}

export type UsageIncrementInput = {
  userId: number;
  meter: UsageMeterKey;
  idempotencyKey: string;
  outcome: "attempted" | "successful" | "failed" | "billable";
};

export function incrementUsage(input: UsageIncrementInput): { duplicated: boolean; billable: number } {
  const k = key(input.userId, input.meter);
  let rec = store.get(k);
  if (!rec) {
    rec = {
      userId: input.userId,
      meter: input.meter,
      attempted: 0,
      successful: 0,
      failed: 0,
      billable: 0,
      idempotencyKeys: new Set(),
    };
    store.set(k, rec);
  }
  if (rec.idempotencyKeys.has(input.idempotencyKey)) {
    return { duplicated: true, billable: rec.billable };
  }
  rec.idempotencyKeys.add(input.idempotencyKey);
  if (input.outcome === "attempted") rec.attempted += 1;
  if (input.outcome === "successful") rec.successful += 1;
  if (input.outcome === "failed") rec.failed += 1;
  if (input.outcome === "billable") rec.billable += 1;
  return { duplicated: false, billable: rec.billable };
}

export function listUsageForUser(userId: number): Record<UsageMeterKey, ReturnType<typeof getUsageDetail>> {
  const meters: UsageMeterKey[] = [
    "calle_calls",
    "calle_calls_billable",
    "ai_generations",
    "ai_advanced",
    "exports",
    "automation_runs",
    "active_seats",
  ];
  return Object.fromEntries(meters.map((m) => [m, getUsageDetail(userId, m)])) as Record<
    UsageMeterKey,
    ReturnType<typeof getUsageDetail>
  >;
}
