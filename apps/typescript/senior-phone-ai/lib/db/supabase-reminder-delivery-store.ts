import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ReminderClaim, ReminderDeliveryStore } from "../scheduler/reminder-delivery";
import type { ReminderRecord, ReminderStatus } from "../tools/reminders";

function parseClaim(value: unknown): ReminderClaim {
  if (!value || typeof value !== "object") throw new Error("invalid reminder delivery claim");
  const claim = value as { state?: unknown; reminderId?: unknown; reminder?: unknown };
  if (claim.state === "none") return { state: "none" };
  if (claim.state === "expired" && typeof claim.reminderId === "string") {
    return { state: "expired", reminderId: claim.reminderId };
  }
  if (claim.state === "claimed" && claim.reminder && typeof claim.reminder === "object") {
    return { state: "claimed", reminder: claim.reminder as ReminderRecord };
  }
  throw new Error("invalid reminder delivery claim");
}

export class SupabaseReminderDeliveryStore implements ReminderDeliveryStore {
  constructor(private readonly client: SupabaseClient) {}

  async claimNext(now: Date, maximumLatenessMs: number): Promise<ReminderClaim> {
    const { data, error } = await this.client.rpc("claim_due_reminder_delivery", {
      p_now: now.toISOString(),
      p_maximum_lateness_seconds: Math.floor(maximumLatenessMs / 1_000),
    });
    if (error) throw new Error("could not claim reminder delivery");
    return parseClaim(data);
  }

  async finish(
    reminderId: string,
    status: Extract<ReminderStatus, "queued" | "completed" | "failed" | "unknown">,
    providerReference?: string,
  ): Promise<void> {
    const { data, error } = await this.client.rpc("finish_reminder_delivery", {
      p_reminder_id: reminderId,
      p_status: status,
      p_provider_reference: providerReference ?? null,
    });
    if (error || data !== true) throw new Error("could not finish reminder delivery");
  }
}
