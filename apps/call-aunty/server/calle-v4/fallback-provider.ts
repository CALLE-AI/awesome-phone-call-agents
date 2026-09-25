import type { CalleCall, CalleEvent, CreateCallInput, Provider } from "./types";
import { isMockFallbackEligible } from "../calle/mock-fallback";

function withSource(call: CalleCall, reason: string): CalleCall {
  return {
    ...call,
    metadata: {
      ...call.metadata,
      calle_source: "mock_fallback",
      calle_fallback_reason: reason,
    },
  };
}

/** Live CALL-E provider with demo fixtures when the remote API is unreachable. */
export class FallbackCalleProvider implements Provider {
  constructor(
    private readonly live: Provider,
    private readonly fallback: Provider,
  ) {}

  async createCall(input: CreateCallInput, signal?: AbortSignal): Promise<CalleCall> {
    try {
      return await this.live.createCall(input, signal);
    } catch (error) {
      if (!isMockFallbackEligible(error)) throw error;
      return withSource(await this.fallback.createCall(input, signal), "provider_unavailable");
    }
  }

  async getCall(id: string, signal?: AbortSignal): Promise<CalleCall> {
    try {
      return await this.live.getCall(id, signal);
    } catch (error) {
      if (!isMockFallbackEligible(error)) throw error;
      try {
        return withSource(await this.fallback.getCall(id, signal), "provider_unavailable");
      } catch {
        const stamp = new Date().toISOString();
        return {
          id,
          object: "call_task",
          status: "completed",
          task: "Mock CALL-E fallback lookup",
          recipients: [],
          structured_result: {
            reached: "unknown",
            needs_follow_up: "unknown",
            appointment_confirmed: "unknown",
            preferred_window: "unknown",
          },
          summary: "Mock fallback — live CALL-E was unreachable.",
          task_completed: true,
          completion_confidence: 0.5,
          evidence: ["mock_fallback"],
          metadata: {
            calle_source: "mock_fallback",
            calle_fallback_reason: "provider_unavailable",
          },
          created_at: stamp,
          updated_at: stamp,
        };
      }
    }
  }

  async getEvents(
    id: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<{ events: CalleEvent[]; nextCursor?: string }> {
    try {
      return await this.live.getEvents(id, cursor, signal);
    } catch (error) {
      if (!isMockFallbackEligible(error)) throw error;
      return this.fallback.getEvents(id, cursor, signal);
    }
  }
}
