import { RescueRequest } from '../types';

export interface IRescueStore {
  create(request: RescueRequest): Promise<RescueRequest>;
  get(id: string): Promise<RescueRequest | null>;
  getByCallId(callId: string): Promise<RescueRequest | null>;
  update(id: string, updates: Partial<RescueRequest>): Promise<RescueRequest | null>;
  getAll(): Promise<RescueRequest[]>;
}

export class InMemoryRescueStore implements IRescueStore {
  private requests: Map<string, RescueRequest> = new Map();
  private callIdIndex: Map<string, string> = new Map(); // callId -> requestId

  async create(request: RescueRequest): Promise<RescueRequest> {
    this.requests.set(request.id, { ...request });
    if (request.callId) {
      this.callIdIndex.set(request.callId, request.id);
    }
    return { ...request };
  }

  async get(id: string): Promise<RescueRequest | null> {
    const req = this.requests.get(id);
    return req ? { ...req } : null;
  }

  async getByCallId(callId: string): Promise<RescueRequest | null> {
    const requestId = this.callIdIndex.get(callId);
    if (requestId) {
      return this.get(requestId);
    }
    // Fallback scan if index not updated yet
    for (const req of this.requests.values()) {
      if (req.callId === callId) {
        return { ...req };
      }
    }
    return null;
  }

  async update(id: string, updates: Partial<RescueRequest>): Promise<RescueRequest | null> {
    const existing = this.requests.get(id);
    if (!existing) {
      return null;
    }

    const updated: RescueRequest = {
      ...existing,
      ...updates,
      id, // ensure ID is invariant
    };

    this.requests.set(id, updated);
    if (updated.callId) {
      this.callIdIndex.set(updated.callId, id);
    }

    return { ...updated };
  }

  async getAll(): Promise<RescueRequest[]> {
    return Array.from(this.requests.values()).map((r) => ({ ...r }));
  }
}

// Global singleton instance for the app
export const rescueStore: IRescueStore = new InMemoryRescueStore();
