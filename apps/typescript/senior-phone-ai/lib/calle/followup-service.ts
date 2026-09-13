import { randomUUID } from "node:crypto";
import { maskPhoneNumber, redactPhoneNumbers, toE164FromNationalNumber } from "../safety/phone";
import type { JsonTransaction } from "../storage/encrypted-json";
import type { SmsAdapter, SmsDeliveryEvent } from "../tools/contracts";
import type { WebSearchResult } from "../tools/search-web";
import { assertCalleCallId, type CalleCallSnapshot } from "./status";
import { verifiedCallSummary, verifiedSearchRequest } from "./followup-evidence";

type Status = "waiting" | "checking" | "searching" | "no_permission" | "search_failed" | "cancelled" | "expired" | "unknown" | "queued" | "sent" | "failed";
interface Record {
  id: string; callId: string; destination: string; createdAt: number; expiresAt: number;
  status: Status; nextCheck: number; query: string; message: string;
  providerMessageId?: string; deliveryEvents: string[];
}
export interface CalleFollowupState { version: 1; calls: Record[] }
export const emptyCalleFollowups = (): CalleFollowupState => ({ version: 1, calls: [] });
const pending = (record: Record) => ["waiting", "checking", "searching"].includes(record.status);
const view = (record: Record) => ({ id: record.id, callReference: `${record.callId.slice(0, 14)}…`, destination: maskPhoneNumber(record.destination),
  status: record.status, query: record.query, message: record.message });
export type CalleFollowupView = ReturnType<typeof view>;

/** Never truncate a factual answer mid-sentence: an overlong result is a failed search. */
export function composeCalleSearchSms(result: WebSearchResult): string {
  if (result.status !== "completed" || !result.answer.trim() || !Number.isFinite(Date.parse(result.retrievedAt))) throw new Error("No verified result");
  const source = result.sources.find((item) => {
    try { const url = new URL(item.url); return url.protocol === "https:" && !url.username && !url.password && item.url.length <= 220; } catch { return false; }
  });
  if (!source) throw new Error("No suitable source");
  const answer = redactPhoneNumbers(result.answer).replace(/\s+/g, " ").trim();
  const message = `Senior Phone AI: ${answer}\nSource: ${source.url}`;
  if (message.length > 480) throw new Error("Search answer is too long for a complete SMS");
  return message;
}

export class CalleFollowupService {
  constructor(private readonly store: JsonTransaction<CalleFollowupState>, private readonly dependencies: {
    readCall(callId: string, destination: string): Promise<CalleCallSnapshot>;
    search(query: string, correlationId: string, requestedAt: string): Promise<WebSearchResult>;
    sms: SmsAdapter;
    recipients: readonly string[];
    enabled(): boolean;
    now?: () => number;
  }) {}
  private time() { return (this.dependencies.now ?? Date.now)(); }
  async register(callId: string, inputDestination: string, authorized: boolean) {
    assertCalleCallId(callId);
    if (!authorized || !this.dependencies.enabled()) throw new Error("Follow-up authorization required");
    const destination = toE164FromNationalNumber("+61", inputDestination, true);
    if (!this.dependencies.recipients.includes(destination) || !/^\+614\d{8}$/.test(destination)) throw new Error("Recipient is not enabled");
    return this.store.transact((state) => {
      const existing = state.calls.find((call) => call.callId === callId);
      if (existing) {
        if (existing.destination !== destination) throw new Error("Call is bound to another recipient");
        return view(existing);
      }
      if (state.calls.length >= 100) throw new Error("Local follow-up limit reached");
      const record: Record = { id: randomUUID(), callId, destination, createdAt: this.time(), expiresAt: this.time() + 2 * 60 * 60_000,
        status: "waiting", nextCheck: 0, query: "", message: "", deliveryEvents: [] };
      state.calls.push(record);
      return view(record);
    });
  }
  async list() {
    return this.store.transact((state) => {
      for (const record of state.calls) {
        if (record.expiresAt <= this.time() && pending(record)) record.status = "expired";
        if (this.time() - record.createdAt > 86_400_000) { record.query = ""; record.message = ""; record.destination = ""; }
      }
      return state.calls.map(view).reverse();
    });
  }
  async cancel(id: string) {
    await this.store.transact((state) => {
      const record = state.calls.find((call) => call.id === id);
      if (!record) throw new Error("Follow-up not found");
      if (!pending(record) && record.status !== "cancelled") throw new Error("Follow-up cannot be cancelled after dispatch");
      record.status = "cancelled";
    });
  }
  async runOnce() {
    if (!this.dependencies.enabled()) return;
    await this.list();
    const claimed = await this.store.transact((state) => {
      // Checking is read-only and can recover after a crash; an interrupted search never resends.
      for (const record of state.calls) {
        if (record.status === "checking" && record.nextCheck <= this.time()) record.status = "waiting";
        if (record.status === "searching" && record.nextCheck <= this.time()) record.status = "search_failed";
      }
      const record = state.calls.find((call) => call.status === "waiting" && call.nextCheck <= this.time());
      if (!record) return;
      record.status = "checking"; record.nextCheck = this.time() + 120_000;
      return structuredClone(record);
    });
    if (!claimed) return;
    const update = async (expected: Status, change: (record: Record) => void) => this.store.transact((state) => {
      const record = state.calls.find((call) => call.id === claimed.id)!;
      if (record.status !== expected || record.expiresAt <= this.time() || !this.dependencies.enabled()) return false;
      change(record); return true;
    });
    let call: CalleCallSnapshot;
    try { call = await this.dependencies.readCall(claimed.callId, claimed.destination); }
    catch { await update("checking", (record) => { record.status = "waiting"; record.nextCheck = this.time() + 30_000; }); return; }
    if (call.callId !== claimed.callId) { await update("checking", (record) => { record.status = "no_permission"; }); return; }
    if (call.outcome === "pending") {
      await update("checking", (record) => { record.status = "waiting"; record.nextCheck = this.time() + 30_000; }); return;
    }
    const callTime = Date.parse(call.createdAt ?? "");
    if (!Number.isFinite(callTime) || callTime > this.time() + 60_000 || this.time() - callTime > 2 * 60 * 60_000) {
      await update("checking", (record) => { record.status = "expired"; }); return;
    }
    const query = verifiedSearchRequest(call);
    const summary = verifiedCallSummary(call);
    if (!query && !summary) { await update("checking", (record) => { record.status = "no_permission"; }); return; }
    if (!await update("checking", (record) => { record.status = "searching"; record.query = query ?? ""; record.nextCheck = this.time() + 120_000; })) return;
    let message = summary ? `Senior Phone AI: ${summary}` : "";
    if (query) {
      try {
        const answer = composeCalleSearchSms(await this.dependencies.search(query, claimed.id, call.createdAt!));
        const combined = summary ? `${message}\n${answer.replace(/^Senior Phone AI: /, "")}` : answer;
        // Keep a complete sourced answer when both cannot fit into the SMS limit.
        message = combined.length <= 480 ? combined : answer;
      } catch {
        if (!summary) { await update("searching", (record) => { record.status = "search_failed"; }); return; }
        message += "\nI could not verify the requested search results.";
      }
    }
    if (!this.dependencies.recipients.includes(claimed.destination)) return;
    // Persist a single send claim before contacting Twilio. Cancellation and disable win before this point.
    if (!await update("searching", (record) => { record.status = "unknown"; record.message = message; })) return;
    try {
      const result = await this.dependencies.sms.send({ destinationE164: claimed.destination, message, idempotencyKey: `calle-followup:${claimed.id}` });
      await this.store.transact((state) => {
        const record = state.calls.find((item) => item.id === claimed.id)!;
        record.status = result.status === "previewed" ? "unknown" : result.status;
        record.providerMessageId = result.providerMessageId;
      });
    } catch { /* A persisted unknown outcome must never be retried automatically. */ }
  }
  async applyDelivery(event: SmsDeliveryEvent) {
    return this.store.transact((state) => {
      const record = state.calls.find((call) => call.providerMessageId === event.providerMessageId);
      if (!record) return;
      if (!record.deliveryEvents.includes(event.eventId)) { record.deliveryEvents.push(event.eventId); record.status = event.status; }
      return true;
    });
  }
}
