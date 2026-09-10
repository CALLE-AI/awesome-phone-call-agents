import { maskPhoneNumber } from "../safety/phone";
import type { DeliveryStatus, SmsDeliveryEvent } from "./contracts";

export interface SmsReservation {
  readonly authorizationId: string;
  readonly correlationId: string;
  readonly destinationE164: string;
  readonly idempotencyKey: string;
  readonly message: string;
  readonly purpose: string;
  readonly seniorId: string;
}

export interface SmsRecord extends SmsReservation {
  readonly createdAt: string;
  readonly lastDeliveryAt?: string;
  readonly processedEventIds: ReadonlySet<string>;
  readonly providerMessageId?: string;
  readonly status: DeliveryStatus;
  readonly updatedAt: string;
}

export type SmsReservationResult =
  | Readonly<{ created: true; record: SmsRecord }>
  | Readonly<{ created: false; record: SmsRecord }>;

export interface SmsStore {
  reserve(reservation: SmsReservation): SmsReservationResult | Promise<SmsReservationResult>;
  updateDispatch(
    idempotencyKey: string,
    status: DeliveryStatus,
    providerMessageId?: string,
  ): SmsRecord | Promise<SmsRecord>;
  applyDelivery(event: SmsDeliveryEvent): SmsRecord | undefined | Promise<SmsRecord | undefined>;
}

interface StoreOptions {
  readonly now?: () => number;
}

function sameReservation(left: SmsReservation, right: SmsReservation): boolean {
  return left.correlationId === right.correlationId
    && left.authorizationId === right.authorizationId
    && left.destinationE164 === right.destinationE164
    && left.idempotencyKey === right.idempotencyKey
    && left.message === right.message
    && left.purpose === right.purpose
    && left.seniorId === right.seniorId;
}

export class InMemorySmsStore implements SmsStore {
  private readonly records = new Map<string, SmsRecord>();
  private readonly now: () => number;

  constructor(options: StoreOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  reserve(reservation: SmsReservation): SmsReservationResult {
    const existing = this.records.get(reservation.idempotencyKey);
    if (existing) {
      if (!sameReservation(existing, reservation)) {
        throw new Error("idempotency key was already used for a different SMS");
      }
      return { created: false, record: existing };
    }
    const timestamp = new Date(this.now()).toISOString();
    const record: SmsRecord = {
      ...reservation,
      createdAt: timestamp,
      processedEventIds: new Set<string>(),
      status: "unknown",
      updatedAt: timestamp,
    };
    this.records.set(reservation.idempotencyKey, record);
    return { created: true, record };
  }

  updateDispatch(
    idempotencyKey: string,
    status: DeliveryStatus,
    providerMessageId?: string,
  ): SmsRecord {
    const record = this.records.get(idempotencyKey);
    if (!record) throw new Error("SMS reservation does not exist");
    if ((status === "queued" || status === "sent") && !providerMessageId) {
      throw new Error("provider message ID is required for a live delivery status");
    }
    const updated: SmsRecord = {
      ...record,
      providerMessageId,
      status,
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.records.set(idempotencyKey, updated);
    return updated;
  }

  applyDelivery(event: SmsDeliveryEvent): SmsRecord | undefined {
    const occurredAtMs = Date.parse(event.occurredAt);
    if (!Number.isFinite(occurredAtMs)
      || event.eventId.length < 1
      || event.eventId.length > 200
      || event.providerMessageId.length < 1
      || event.providerMessageId.length > 200) {
      throw new Error("invalid verified SMS delivery event");
    }
    const entry = [...this.records.entries()].find(
      ([, record]) => record.providerMessageId === event.providerMessageId,
    );
    if (!entry) return undefined;
    const [idempotencyKey, record] = entry;
    if (record.processedEventIds.has(event.eventId)) return record;
    const processedEventIds = new Set(record.processedEventIds);
    processedEventIds.add(event.eventId);
    if (record.lastDeliveryAt && occurredAtMs < Date.parse(record.lastDeliveryAt)) {
      const deduplicated: SmsRecord = { ...record, processedEventIds };
      this.records.set(idempotencyKey, deduplicated);
      return deduplicated;
    }
    const updated: SmsRecord = {
      ...record,
      lastDeliveryAt: event.occurredAt,
      processedEventIds,
      status: event.status,
      updatedAt: event.occurredAt,
    };
    this.records.set(idempotencyKey, updated);
    return updated;
  }
}

export function toSmsOperationalSummary(record: SmsRecord) {
  return {
    correlationId: record.correlationId,
    destination: maskPhoneNumber(record.destinationE164),
    status: record.status,
  } as const;
}
