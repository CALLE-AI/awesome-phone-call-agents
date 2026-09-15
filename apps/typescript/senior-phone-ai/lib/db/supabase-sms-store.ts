import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DeliveryStatus, SmsDeliveryEvent } from "../tools/contracts";
import type {
  SmsRecord,
  SmsReservation,
  SmsReservationResult,
  SmsStore,
} from "../tools/sms-store";

interface SmsRow {
  readonly authorization_id: string;
  readonly correlation_id: string;
  readonly created_at: string;
  readonly destination_e164: string;
  readonly idempotency_key: string;
  readonly last_delivery_at: string | null;
  readonly message: string;
  readonly provider_message_id: string | null;
  readonly purpose: string;
  readonly senior_id: string;
  readonly status: DeliveryStatus;
  readonly updated_at: string;
}

function mapRow(row: SmsRow): SmsRecord {
  return {
    authorizationId: row.authorization_id,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    destinationE164: row.destination_e164,
    idempotencyKey: row.idempotency_key,
    lastDeliveryAt: row.last_delivery_at ?? undefined,
    message: row.message,
    processedEventIds: new Set<string>(),
    providerMessageId: row.provider_message_id ?? undefined,
    purpose: row.purpose,
    seniorId: row.senior_id,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function sameReservation(row: SmsRow, reservation: SmsReservation): boolean {
  return row.authorization_id === reservation.authorizationId
    && row.correlation_id === reservation.correlationId
    && row.destination_e164 === reservation.destinationE164
    && row.idempotency_key === reservation.idempotencyKey
    && row.message === reservation.message
    && row.purpose === reservation.purpose
    && row.senior_id === reservation.seniorId;
}

export class SupabaseSmsStore implements SmsStore {
  constructor(private readonly client: SupabaseClient) {}

  async reserve(reservation: SmsReservation): Promise<SmsReservationResult> {
    const { data, error } = await this.client
      .from("sms_messages")
      .insert({
        authorization_id: reservation.authorizationId,
        correlation_id: reservation.correlationId,
        destination_e164: reservation.destinationE164,
        destination_last4: reservation.destinationE164.slice(-4),
        idempotency_key: reservation.idempotencyKey,
        message: reservation.message,
        purpose: reservation.purpose,
        senior_id: reservation.seniorId,
        status: "unknown",
      })
      .select("*")
      .maybeSingle();
    if (!error && data) return { created: true, record: mapRow(data as SmsRow) };
    if (error?.code !== "23505") throw new Error("could not reserve SMS delivery");
    const { data: existing, error: readError } = await this.client
      .from("sms_messages")
      .select("*")
      .eq("idempotency_key", reservation.idempotencyKey)
      .maybeSingle();
    if (readError || !existing) throw new Error("could not read SMS reservation");
    const row = existing as SmsRow;
    if (!sameReservation(row, reservation)) {
      throw new Error("idempotency key was already used for a different SMS");
    }
    return { created: false, record: mapRow(row) };
  }

  async updateDispatch(
    idempotencyKey: string,
    status: DeliveryStatus,
    providerMessageId?: string,
  ): Promise<SmsRecord> {
    if ((status === "queued" || status === "sent") && !providerMessageId) {
      throw new Error("provider message ID is required for a live delivery status");
    }
    const { data, error } = await this.client
      .from("sms_messages")
      .update({ provider_message_id: providerMessageId ?? null, status })
      .eq("idempotency_key", idempotencyKey)
      .select("*")
      .maybeSingle();
    if (error || !data) throw new Error("SMS reservation does not exist");
    return mapRow(data as SmsRow);
  }

  async applyDelivery(event: SmsDeliveryEvent): Promise<SmsRecord | undefined> {
    const { data, error } = await this.client.rpc("apply_sms_delivery_event", {
      p_event_id: event.eventId,
      p_occurred_at: event.occurredAt,
      p_provider_message_id: event.providerMessageId,
      p_status: event.status,
    });
    if (error) throw new Error("could not apply verified SMS delivery event");
    const row = Array.isArray(data) ? data[0] : data;
    return row ? mapRow(row as SmsRow) : undefined;
  }
}
