import type { ReminderChannel, ReminderRecord, ReminderStatus } from "../tools/reminders";

export interface ReminderDeliveryResult {
  readonly providerReference?: string;
  readonly retryable?: boolean;
  readonly status: "queued" | "completed" | "failed";
}

export interface ReminderDeliveryAdapter {
  deliver(reminder: ReminderRecord): Promise<ReminderDeliveryResult>;
}

export type ReminderClaim =
  | { readonly state: "none" }
  | { readonly state: "expired"; readonly reminderId: string }
  | { readonly state: "claimed"; readonly reminder: ReminderRecord };

export interface ReminderDeliveryStore {
  claimNext(now: Date, maximumLatenessMs: number): Promise<ReminderClaim> | ReminderClaim;
  finish(reminderId: string, status: Extract<ReminderStatus, "queued" | "completed" | "failed" | "unknown">, providerReference?: string): Promise<void> | void;
}

export interface ReminderDeliveryPolicy {
  allows(reminder: ReminderRecord): Promise<boolean> | boolean;
}

export interface ReminderDeliveryRun {
  readonly blocked: number;
  readonly delivered: number;
  readonly expired: number;
  readonly unknown: number;
}

export class ReminderDeliveryScheduler {
  constructor(
    private readonly store: ReminderDeliveryStore,
    private readonly adapters: Readonly<Record<ReminderChannel, ReminderDeliveryAdapter>>,
    private readonly policy: ReminderDeliveryPolicy,
    private readonly maximumLatenessMs = 15 * 60 * 1_000,
    private readonly maximumKnownRetries = 2,
  ) {}

  async runDue(now = new Date()): Promise<ReminderDeliveryRun> {
    let delivered = 0;
    let blocked = 0;
    let expired = 0;
    let unknown = 0;
    for (;;) {
      const claim = await this.store.claimNext(now, this.maximumLatenessMs);
      if (claim.state === "none") return { blocked, delivered, expired, unknown };
      if (claim.state === "expired") {
        expired += 1;
        continue;
      }
      if (!await this.policy.allows(claim.reminder)) {
        await this.store.finish(claim.reminder.id, "failed");
        blocked += 1;
        continue;
      }
      try {
        let result: ReminderDeliveryResult;
        let retries = 0;
        do {
          result = await this.adapters[claim.reminder.channel].deliver(claim.reminder);
          if (result.retryable && result.status !== "failed") throw new Error("only a definite failure can be retryable");
          if (!(result.status === "failed" && result.retryable && retries < this.maximumKnownRetries)) break;
          retries += 1;
        } while (true);
        await this.store.finish(claim.reminder.id, result.status, result.providerReference);
        delivered += 1;
      } catch {
        await this.store.finish(claim.reminder.id, "unknown");
        unknown += 1;
      }
    }
  }
}
