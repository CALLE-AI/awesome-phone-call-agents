import { randomUUID } from "node:crypto";
import {
  AccountEventSchema,
  type AccountEvent,
  type RawFixture,
  RawFixtureSchema,
} from "../schemas.js";

/**
 * Normalize a raw cue (fixture, stdin event, or webhook payload) into a typed AccountEvent.
 * Accepts either fixture shape (`fixture_id`) or event shape (`event_id`).
 */
export function normalizeEvent(raw: unknown): AccountEvent {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.event_id === "string" && obj.event_id.length > 0 && !obj.fixture_id) {
      return AccountEventSchema.parse({
        ...obj,
        metadata: obj.metadata ?? {},
      });
    }
  }
  const fixture = RawFixtureSchema.parse(raw);
  return toAccountEvent(fixture);
}

export function toAccountEvent(fixture: RawFixture): AccountEvent {
  const occurredAt =
    fixture.occurred_at ?? new Date().toISOString();

  return AccountEventSchema.parse({
    event_id: `evt_${fixture.fixture_id}_${randomUUID().slice(0, 8)}`,
    trigger_id: fixture.trigger_id,
    account: fixture.account,
    cs_owner: fixture.cs_owner,
    severity: fixture.severity,
    summary: fixture.summary,
    brief: fixture.brief,
    ticket_id: fixture.ticket_id,
    option_set: fixture.option_set,
    occurred_at: occurredAt.includes("T")
      ? occurredAt
      : new Date(occurredAt).toISOString(),
    metadata: {
      fixture_id: fixture.fixture_id,
      ...(fixture.metadata ?? {}),
    },
  });
}
