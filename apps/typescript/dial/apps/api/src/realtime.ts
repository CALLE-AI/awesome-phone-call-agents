import type { RealtimeEvent } from '@dial/orchestrator';

/**
 * Server-Sent Events hub.
 *
 * SSE rather than WebSockets: the traffic is one-directional (server -> client),
 * it survives the Next.js BFF proxy without an upgrade dance, and browsers
 * reconnect on their own. Mobile uses the same endpoint with a polling fallback.
 *
 * Subscriptions are per user, and every published event is checked against the
 * task's owner before it is written -- a subscriber cannot receive another
 * user's task activity.
 */

export interface Subscriber {
  userId: string;
  taskId: string | null;
  send: (event: RealtimeEvent) => void;
}

export class RealtimeHub {
  private readonly subscribers = new Map<string, Subscriber>();
  /** taskId -> owning userId, so publishes can be authorised without a query. */
  private readonly taskOwners = new Map<string, string>();

  subscribe(id: string, subscriber: Subscriber): () => void {
    this.subscribers.set(id, subscriber);
    return () => this.subscribers.delete(id);
  }

  registerTaskOwner(taskId: string, userId: string): void {
    this.taskOwners.set(taskId, userId);
    // Bounded so a long-lived process cannot grow this map without limit.
    if (this.taskOwners.size > 10_000) {
      const oldest = this.taskOwners.keys().next().value;
      if (oldest) this.taskOwners.delete(oldest);
    }
  }

  publish(taskId: string, event: RealtimeEvent): void {
    const owner = this.taskOwners.get(taskId);
    for (const subscriber of this.subscribers.values()) {
      if (owner && subscriber.userId !== owner) continue;
      if (subscriber.taskId && subscriber.taskId !== taskId) continue;
      try {
        subscriber.send(event);
      } catch {
        // A dead connection is not the publisher's problem; the request
        // handler removes it when the socket closes.
      }
    }
  }

  get size(): number {
    return this.subscribers.size;
  }
}
