import type { CalleCall, CalleEvent, CreateCallInput, Provider } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/**
 * In-process CALL-E stand-in used when CALLE_DEMO_MODE is on.
 * Completes with constrained `unknown` outcomes — no live network call.
 */
export class DemoCalleProvider implements Provider {
  private readonly calls = new Map<string, CalleCall>();
  private readonly byKey = new Map<string, string>();
  private readonly events = new Map<string, CalleEvent[]>();
  private readonly fetches = new Map<string, number>();

  async createCall(input: CreateCallInput): Promise<CalleCall> {
    const existingId = this.byKey.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.calls.get(existingId);
      if (existing) return existing;
    }

    const id = newId("demo");
    const call: CalleCall = {
      id,
      object: "call_task",
      status: "queued",
      task: input.task,
      recipients: (input.recipients ?? []).map((recipient, index) => ({
        id: `${id}-r${index}`,
        phones: recipient.phones,
        status: "queued",
        structured_result: null,
        summary: null,
      })),
      structured_result: null,
      summary: null,
      task_completed: null,
      completion_confidence: null,
      evidence: [],
      metadata: input.metadata ?? {},
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    this.calls.set(id, call);
    this.byKey.set(input.idempotencyKey, id);
    this.events.set(id, [
      { id: `${id}-queued`, type: "call.queued", created_at: nowIso(), data: call },
    ]);
    this.fetches.set(id, 0);
    return call;
  }

  async getCall(id: string): Promise<CalleCall> {
    const current = this.calls.get(id);
    if (!current) {
      const error = new Error("CALL-E 404") as Error & { status: number };
      error.status = 404;
      throw error;
    }
    const seen = (this.fetches.get(id) ?? 0) + 1;
    this.fetches.set(id, seen);
    if (current.status === "completed" || current.status === "failed" || current.status === "canceled") {
      return current;
    }
    if (seen === 1) {
      const next: CalleCall = {
        ...current,
        status: "in_progress",
        recipients: current.recipients.map((recipient) => ({ ...recipient, status: "in_progress" })),
        updated_at: nowIso(),
      };
      this.calls.set(id, next);
      this.events.get(id)?.push({
        id: `${id}-in-progress`,
        type: "call.in_progress",
        created_at: nowIso(),
        data: next,
      });
      return next;
    }
    const completed: CalleCall = {
      ...current,
      status: "completed",
      recipients: current.recipients.map((recipient) => ({
        ...recipient,
        status: "completed",
        structured_result: { reached: "unknown", callback_requested: "unknown" },
      })),
      structured_result: {
        reached: "unknown",
        needs_follow_up: "unknown",
        appointment_confirmed: "unknown",
        preferred_window: "unknown",
      },
      summary: "Demo structured result — no live CALL-E call was placed.",
      task_completed: true,
      completion_confidence: 0.5,
      evidence: ["demo_runtime"],
      updated_at: nowIso(),
    };
    this.calls.set(id, completed);
    this.events.get(id)?.push({
      id: `${id}-completed`,
      type: "call.completed",
      created_at: nowIso(),
      data: completed,
    });
    return completed;
  }

  async getEvents(id: string): Promise<{ events: CalleEvent[]; nextCursor?: string }> {
    return { events: this.events.get(id) ?? [] };
  }
}
