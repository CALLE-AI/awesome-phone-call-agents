import { createHash } from "node:crypto";
import { maskPhone } from "./phone.js";

/** The words a person confirms before a number already called today is called again. */
export const REPEAT_APPROVAL = "I approve calling these numbers again today for a different reason.";

/**
 * Remembers which destination numbers were called on which local day, so each
 * customer is called at most once a day across stops, routes and restarted
 * days on this server. A number is recorded when its call is attempted, so an
 * ambiguous creation counts as a call. Numbers are kept only as hashes, in
 * memory; a server restart forgets them.
 */
export class CallLedger {
  private readonly days = new Map<string, Set<string>>();

  constructor(private readonly clock: () => number = Date.now) {}

  calledToday(phone: string, utcOffsetMinutes: number): boolean {
    return this.days.get(this.day(utcOffsetMinutes))?.has(hash(phone)) ?? false;
  }

  record(phone: string, utcOffsetMinutes: number): void {
    const day = this.day(utcOffsetMinutes);
    for (const old of this.days.keys()) if (old < this.day(utcOffsetMinutes - 36 * 60)) this.days.delete(old);
    const numbers = this.days.get(day) ?? new Set<string>();
    numbers.add(hash(phone));
    this.days.set(day, numbers);
  }

  /** Masked numbers from `phones` that were already called today. */
  alreadyCalled(phones: string[], utcOffsetMinutes: number): string[] {
    return [...new Set(phones)].filter((phone) => this.calledToday(phone, utcOffsetMinutes)).map(maskPhone);
  }

  private day(utcOffsetMinutes: number): string {
    return new Date(this.clock() + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
  }
}

function hash(phone: string): string {
  return createHash("sha256").update(phone).digest("hex");
}
