import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ReminderRecord, ReminderRequest, ReminderStatus, ReminderStore } from "../tools/reminders";

interface ReminderRow {
  authorization_id: string;
  canceled_at: string | null;
  channel: ReminderRequest["channel"];
  created_at: string;
  destination_e164: string;
  id: string;
  idempotency_key: string;
  message: string;
  principal_user_id: string;
  scheduled_for: string;
  senior_id: string;
  status: ReminderStatus;
  timezone: string;
}

function mapRow(row: ReminderRow): ReminderRecord {
  return {
    authorizationId: row.authorization_id,
    canceledAt: row.canceled_at ?? undefined,
    channel: row.channel,
    createdAt: row.created_at,
    destinationE164: row.destination_e164,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    message: row.message,
    principalId: row.principal_user_id,
    scheduledFor: row.scheduled_for,
    seniorId: row.senior_id,
    status: row.status,
    timezone: row.timezone,
  };
}

function same(left: ReminderRow, right: ReminderRequest): boolean {
  return left.authorization_id === right.authorizationId
    && left.channel === right.channel
    && left.destination_e164 === right.destinationE164
    && left.idempotency_key === right.idempotencyKey
    && left.message === right.message
    && left.principal_user_id === right.principalId
    && Date.parse(left.scheduled_for) === Date.parse(right.scheduledFor)
    && left.senior_id === right.seniorId
    && left.timezone === right.timezone;
}

export class SupabaseReminderStore implements ReminderStore {
  constructor(private readonly client: SupabaseClient) {}

  private async assertAccess(seniorId: string, principalId: string): Promise<void> {
    const { data, error } = await this.client.from("senior_memberships")
      .select("senior_id")
      .eq("senior_id", seniorId)
      .eq("user_id", principalId)
      .eq("can_manage_reminders", true)
      .is("revoked_at", null)
      .maybeSingle();
    if (error || !data) throw new Error("reminder access denied");
  }

  async reserve(request: ReminderRequest) {
    await this.assertAccess(request.seniorId, request.principalId);
    const { data, error } = await this.client.from("reminders").insert({
      authorization_id: request.authorizationId,
      channel: request.channel,
      destination_e164: request.destinationE164,
      idempotency_key: request.idempotencyKey,
      message: request.message,
      principal_user_id: request.principalId,
      scheduled_for: request.scheduledFor,
      senior_id: request.seniorId,
      timezone: request.timezone,
    }).select("*").maybeSingle();
    if (!error && data) return { created: true, record: mapRow(data as ReminderRow) };
    if (error?.code !== "23505") throw new Error("could not reserve reminder");
    const existing = await this.client.from("reminders").select("*")
      .eq("idempotency_key", request.idempotencyKey).maybeSingle();
    if (existing.error || !existing.data) throw new Error("could not read reminder reservation");
    const row = existing.data as ReminderRow;
    if (!same(row, request)) throw new Error("idempotency key was already used for a different reminder");
    return { created: false, record: mapRow(row) };
  }

  async list(seniorId: string, principalId: string): Promise<ReminderRecord[]> {
    await this.assertAccess(seniorId, principalId);
    const { data, error } = await this.client.from("reminders").select("*")
      .eq("senior_id", seniorId).order("scheduled_for", { ascending: true });
    if (error) throw new Error("could not list reminders");
    return (data as ReminderRow[]).map(mapRow);
  }

  async cancel(id: string, seniorId: string, principalId: string) {
    await this.assertAccess(seniorId, principalId);
    const { data, error } = await this.client.from("reminders")
      .update({ canceled_at: new Date().toISOString(), status: "canceled" })
      .eq("id", id).eq("senior_id", seniorId).eq("status", "pending")
      .select("id").maybeSingle();
    if (error) throw new Error("could not cancel reminder");
    if (data) return "canceled" as const;
    const existing = await this.client.from("reminders").select("status")
      .eq("id", id).eq("senior_id", seniorId).maybeSingle();
    if (existing.error || !existing.data || existing.data.status === "canceled") return "not_found" as const;
    return "already_started" as const;
  }
}
