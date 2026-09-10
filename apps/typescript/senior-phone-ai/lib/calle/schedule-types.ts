export type ScheduledCallStatus = "pending" | "claimed" | "accepted" | "unknown" | "canceled";

export interface ScheduledCallSummary {
  readonly id: string;
  readonly createdAt: string;
  readonly scheduledFor: string;
  readonly destinationSummary: string;
  readonly purpose: string;
  readonly status: ScheduledCallStatus;
  readonly callReference?: string;
}

export function validateScheduledFor(value: string, now = new Date()): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new Error("scheduled time must be an ISO UTC instant");
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error("scheduled time is invalid");
  if (instant.getTime() < now.getTime() + 5_000) throw new Error("scheduled time must be at least five seconds in the future");
  if (instant.getTime() > now.getTime() + 366 * 24 * 60 * 60 * 1_000) throw new Error("scheduled time is too far in the future");
  return instant.toISOString();
}
