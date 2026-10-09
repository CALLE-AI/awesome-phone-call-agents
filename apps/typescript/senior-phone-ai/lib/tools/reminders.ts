import { randomUUID } from "node:crypto";

import type { ActionAuthorizationStore, ActionRequest } from "../safety/authorization";
import { assertStrictE164 } from "../safety/phone";
import type { ReminderClaim, ReminderDeliveryStore } from "../scheduler/reminder-delivery";
import { isIanaTimezone } from "./discovery";

export type ReminderChannel = "sms" | "call";
export type ReminderStatus = "pending" | "queued" | "in_progress" | "completed" | "failed" | "canceled" | "unknown";

export interface ReminderRequest {
  readonly authorizationId: string;
  readonly channel: ReminderChannel;
  readonly destinationE164: string;
  readonly idempotencyKey: string;
  readonly message: string;
  readonly principalId: string;
  readonly scheduledFor: string;
  readonly seniorId: string;
  readonly timezone: string;
}

export interface ReminderRecord extends ReminderRequest {
  readonly canceledAt?: string;
  readonly createdAt: string;
  readonly id: string;
  readonly status: ReminderStatus;
}

export interface ReminderStore {
  reserve(request: ReminderRequest): Promise<{ created: boolean; record: ReminderRecord }> | { created: boolean; record: ReminderRecord };
  list(seniorId: string, principalId: string): Promise<ReminderRecord[]> | ReminderRecord[];
  cancel(id: string, seniorId: string, principalId: string): Promise<"canceled" | "already_started" | "not_found"> | "canceled" | "already_started" | "not_found";
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function reminderActionRequest(request: ReminderRequest): ActionRequest {
  return {
    action: "create_reminder",
    destinationE164: request.destinationE164,
    details: {
      channel: request.channel,
      idempotencyKey: request.idempotencyKey,
      message: request.message,
      scheduledFor: request.scheduledFor,
      timezone: request.timezone,
    },
    principalId: request.principalId,
    purpose: `Create ${request.channel} reminder for ${request.scheduledFor}`,
    seniorId: request.seniorId,
  };
}

function validate(request: ReminderRequest): void {
  assertStrictE164(request.destinationE164);
  if (!IDEMPOTENCY_KEY.test(request.idempotencyKey)) throw new Error("invalid idempotency key");
  if (request.message.trim() !== request.message || request.message.length < 1 || request.message.length > 500) {
    throw new Error("reminder message must be non-empty, bounded, and trimmed");
  }
  if (!isIanaTimezone(request.timezone)) throw new Error("timezone must be a valid IANA timezone");
  if (!Number.isFinite(Date.parse(request.scheduledFor))) throw new Error("scheduledFor must be an ISO instant");
}

function sameRequest(left: ReminderRequest, right: ReminderRequest): boolean {
  return JSON.stringify(reminderActionRequest(left)) === JSON.stringify(reminderActionRequest(right));
}

export class InMemoryReminderStore implements ReminderStore, ReminderDeliveryStore {
  private readonly records = new Map<string, ReminderRecord>();
  constructor(
    private readonly canAccess: (seniorId: string, principalId: string) => boolean,
    private readonly now: () => number = Date.now,
  ) {}

  reserve(request: ReminderRequest) {
    validate(request);
    const existing = [...this.records.values()].find((record) => record.idempotencyKey === request.idempotencyKey);
    if (existing) {
      if (!sameRequest(existing, request)) throw new Error("idempotency key was already used for a different reminder");
      return { created: false, record: existing };
    }
    if (!this.canAccess(request.seniorId, request.principalId)) throw new Error("reminder access denied");
    const record: ReminderRecord = {
      ...request,
      createdAt: new Date(this.now()).toISOString(),
      id: randomUUID(),
      status: "pending",
    };
    this.records.set(record.id, record);
    return { created: true, record };
  }

  list(seniorId: string, principalId: string): ReminderRecord[] {
    if (!this.canAccess(seniorId, principalId)) throw new Error("reminder access denied");
    return [...this.records.values()]
      .filter((record) => record.seniorId === seniorId)
      .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
  }

  cancel(id: string, seniorId: string, principalId: string) {
    if (!this.canAccess(seniorId, principalId)) throw new Error("reminder access denied");
    const record = this.records.get(id);
    if (!record || record.seniorId !== seniorId || record.status === "canceled") return "not_found" as const;
    if (record.status !== "pending") return "already_started" as const;
    this.records.set(id, { ...record, canceledAt: new Date(this.now()).toISOString(), status: "canceled" });
    return "canceled" as const;
  }

  setStatus(id: string, status: ReminderStatus): void {
    const record = this.records.get(id);
    if (!record) throw new Error("reminder does not exist");
    this.records.set(id, { ...record, status });
  }

  claimNext(now: Date, maximumLatenessMs: number): ReminderClaim {
    const record = [...this.records.values()]
      .filter((item) => item.status === "pending" && Date.parse(item.scheduledFor) <= now.getTime())
      .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor))[0];
    if (!record) return { state: "none" };
    if (now.getTime() - Date.parse(record.scheduledFor) > maximumLatenessMs) {
      this.records.set(record.id, { ...record, status: "failed" });
      return { state: "expired", reminderId: record.id };
    }
    const claimed = { ...record, status: "in_progress" as const };
    this.records.set(record.id, claimed);
    return { state: "claimed", reminder: claimed };
  }

  finish(id: string, status: Extract<ReminderStatus, "queued" | "completed" | "failed" | "unknown">): void {
    const record = this.records.get(id);
    if (!record || record.status !== "in_progress") throw new Error("reminder delivery is not claimed");
    this.records.set(id, { ...record, status });
  }
}

export class ReminderService {
  constructor(
    private readonly authorizations: ActionAuthorizationStore,
    private readonly store: ReminderStore,
  ) {}

  async create(request: ReminderRequest): Promise<ReminderRecord> {
    validate(request);
    const reservation = await this.store.reserve(request);
    if (!reservation.created) {
      if (reservation.record.status === "canceled") {
        throw new Error("reminder reservation is canceled");
      }
      return reservation.record;
    }
    const decision = await this.authorizations.consume(request.authorizationId, reminderActionRequest(request));
    if (!decision.allowed) {
      await this.store.cancel(reservation.record.id, request.seniorId, request.principalId);
      throw new Error(`reminder authorization ${decision.reason}`);
    }
    return reservation.record;
  }

  async list(seniorId: string, principalId: string): Promise<ReminderRecord[]> {
    return this.store.list(seniorId, principalId);
  }

  async cancel(id: string, seniorId: string, principalId: string) {
    return this.store.cancel(id, seniorId, principalId);
  }
}
