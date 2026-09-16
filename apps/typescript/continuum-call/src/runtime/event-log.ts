import { hashEvent, newId } from "./crypto.js";
import type { Actor, MissionEvent } from "./types.js";

/** Append-only in-memory event log (Phase 1 scaffolding). */
export class EventLog {
  private events: MissionEvent[] = [];

  append(args: {
    mission_id: string;
    event_type: string;
    actor: Actor;
    call_task_id?: string;
    call_intent_id?: string;
    provider_run_id?: string;
    redacted_payload?: Record<string, unknown>;
  }): MissionEvent {
    const missionEvents = this.events.filter(
      (event) => event.mission_id === args.mission_id,
    );
    const prev = missionEvents.at(-1) ?? null;
    const envelope: Omit<MissionEvent, "event_hash"> = {
      hash_version: 2,
      event_id: newId("evt"),
      mission_id: args.mission_id,
      sequence_no: (prev?.sequence_no ?? 0) + 1,
      event_type: args.event_type,
      actor: args.actor,
      occurred_at: new Date().toISOString(),
      call_task_id: args.call_task_id,
      call_intent_id: args.call_intent_id,
      provider_run_id: args.provider_run_id,
      prev_hash: prev?.event_hash ?? null,
      redacted_payload: structuredClone(args.redacted_payload ?? {}),
    };
    const ev: MissionEvent = { ...envelope, event_hash: hashEvent(envelope) };
    this.events.push(ev);
    return structuredClone(ev);
  }

  list(missionId?: string): MissionEvent[] {
    const selected = missionId
      ? this.events.filter((e) => e.mission_id === missionId)
      : [...this.events];
    return structuredClone(selected);
  }

  /** Rebuild from durable store (preserves hashes; does not recompute). */
  replaceAll(events: MissionEvent[]): void {
    this.events = structuredClone(events).sort((a, b) =>
      a.mission_id.localeCompare(b.mission_id) || a.sequence_no - b.sequence_no,
    );
  }

  /**
   * verify_evidence lite: recompute hash chain.
   */
  verify(missionId: string): {
    ok: boolean;
    chainIntact: boolean;
    eventCount: number;
    errors: string[];
  } {
    const events = this.list(missionId).sort(
      (a, b) => a.sequence_no - b.sequence_no,
    );
    const errors: string[] = [];
    let prev: string | null = null;
    const eventIds = new Set<string>();
    for (const [index, ev] of events.entries()) {
      if (ev.sequence_no !== index + 1) {
        errors.push(`seq ${ev.sequence_no}: expected contiguous seq ${index + 1}`);
      }
      if (ev.mission_id !== missionId) {
        errors.push(`seq ${ev.sequence_no}: wrong mission_id`);
      }
      if (eventIds.has(ev.event_id)) {
        errors.push(`seq ${ev.sequence_no}: duplicate event_id`);
      }
      eventIds.add(ev.event_id);
      const { event_hash: _eventHash, ...envelope } = ev;
      const expected = hashEvent(envelope);
      if (ev.prev_hash !== prev) {
        errors.push(`seq ${ev.sequence_no}: bad prev_hash`);
      }
      if (ev.event_hash !== expected) {
        errors.push(`seq ${ev.sequence_no}: bad event_hash`);
      }
      prev = ev.event_hash;
    }
    return {
      ok: errors.length === 0,
      chainIntact: errors.length === 0,
      eventCount: events.length,
      errors,
    };
  }
}
