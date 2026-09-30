import type { CalleCall, CalleEvent } from "./types";

export interface CallRepository {
  putCall(call: CalleCall, userId?: string): Promise<void>;
  getCall(id: string): Promise<CalleCall | null>;
  listCalls(userId?: string): Promise<CalleCall[]>;
  putEvent(event: CalleEvent): Promise<boolean>;
  listEvents(callId: string): Promise<CalleEvent[]>;
  putIdempotency(key: string, callId: string, requestHash: string): Promise<boolean>;
  getIdempotency(key: string): Promise<{ callId: string; requestHash: string } | null>;
}

export class MemoryCallRepository implements CallRepository {
  private readonly calls = new Map<string, CalleCall>();
  private readonly events = new Map<string, CalleEvent>();
  private readonly owners = new Map<string, string>();
  private readonly idempotency = new Map<string, { callId: string; requestHash: string }>();

  async putCall(call: CalleCall, userId?: string): Promise<void> {
    this.calls.set(call.id, call);
    if (userId) this.owners.set(call.id, userId);
  }

  async getCall(id: string): Promise<CalleCall | null> {
    return this.calls.get(id) ?? null;
  }

  async listCalls(userId?: string): Promise<CalleCall[]> {
    const all = [...this.calls.values()];
    if (!userId) return all;
    return all.filter((call) => this.owners.get(call.id) === userId);
  }

  async putEvent(event: CalleEvent): Promise<boolean> {
    if (this.events.has(event.id)) return false;
    this.events.set(event.id, event);
    return true;
  }

  async listEvents(callId: string): Promise<CalleEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.data.id === callId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async putIdempotency(key: string, callId: string, requestHash: string): Promise<boolean> {
    if (this.idempotency.has(key)) return false;
    this.idempotency.set(key, { callId, requestHash });
    return true;
  }

  async getIdempotency(key: string): Promise<{ callId: string; requestHash: string } | null> {
    return this.idempotency.get(key) ?? null;
  }
}
