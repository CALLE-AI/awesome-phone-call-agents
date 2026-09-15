import { randomUUID } from "node:crypto";
import { maskPhoneNumber, redactPhoneNumbers, toE164FromNationalNumber } from "../safety/phone";
import type { JsonTransaction } from "../storage/encrypted-json";
import type { SmsAdapter, SmsDeliveryEvent } from "../tools/contracts";
import type { WebSearchResult } from "../tools/search-web";
import { assertCalleCallId, type CalleCallSnapshot } from "./status";
import { verifiedCallSummary, verifiedPreviewSearchRequest, verifiedSearchRequest } from "./followup-evidence";
import type { TwilioSmsReceipt } from "../tools/twilio-sms";

type Status = "previewed" | "waiting" | "checking" | "searching" | "no_permission" | "search_failed" | "cancelled" | "expired" | "unknown" | "queued" | "sent" | "failed";
interface Record {
  id: string; callId: string; destination: string; createdAt: number; expiresAt: number;
  status: Status; nextCheck: number; query: string; message: string;
  previewOnly?: boolean;
  providerMessageId?: string; deliveryEvents: string[];
  dispatchedAt?: number; checkedAt?: number; nextDeliveryCheck?: number;
  receipt?: TwilioSmsReceipt; checkFailed?: boolean;
  priorAttempt?: { status: "failed"; message: string; attemptedAt?: number; errorCode?: string };
}
export interface CalleFollowupState { version: 1; calls: Record[] }
export const emptyCalleFollowups = (): CalleFollowupState => ({ version: 1, calls: [] });
const pending = (record: Record) => ["waiting", "checking", "searching"].includes(record.status);
const view = (record: Record) => ({ id: record.id, callId: record.callId, callReference: `${record.callId.slice(0, 14)}…`, destination: maskPhoneNumber(record.destination),
  status: record.status, query: record.query, message: record.message, createdAt: record.createdAt,
  dispatchedAt: record.dispatchedAt, checkedAt: record.checkedAt, receipt: record.receipt,
  checkFailed: record.checkFailed, priorAttempt: record.priorAttempt });
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
    readSmsStatus?(sid: string): Promise<TwilioSmsReceipt | undefined>;
    recipients: readonly string[];
    enabled(): boolean;
    preview?(): boolean;
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
        previewOnly: this.dependencies.preview?.() ?? false, status: "waiting", nextCheck: 0, query: "", message: "", deliveryEvents: [] };
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
  async retry(id: string) {
    await this.store.transact((state) => {
      const record = state.calls.find((call) => call.id === id);
      if (!record || !["no_permission", "search_failed"].includes(record.status)) throw new Error("Follow-up cannot be retried");
      record.status = "waiting";
      record.nextCheck = 0;
      record.query = "";
      record.message = "";
    });
  }
  async runOnce() {
    if (!this.dependencies.enabled()) return;
    await this.list();
    await this.checkDelivery();
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
    const preview = claimed.previewOnly || this.dependencies.preview?.() === true;
    const query = verifiedSearchRequest(call, preview) ?? (preview ? verifiedPreviewSearchRequest(call) : undefined);
    const summary = verifiedCallSummary(call, preview);
    if (!query && !summary) { await update("checking", (record) => { record.status = "no_permission"; }); return; }
    if (!await update("checking", (record) => { record.status = "searching"; record.query = query ?? ""; record.nextCheck = this.time() + 120_000; })) return;
    let message = summary ? `Senior Phone AI: ${summary}` : "";
    if (query) {
      try {
        // A search request needs a customer-facing answer. The conversational recap
        // and provider summary are audit context, not useful SMS content.
        message = composeCalleSearchSms(await this.dependencies.search(query, claimed.id, call.createdAt!));
      } catch {
        await update("searching", (record) => { record.status = "search_failed"; }); return;
      }
    }
    if (!this.dependencies.recipients.includes(claimed.destination)) return;
    // Persist a single send claim before contacting Twilio. Cancellation and disable win before this point.
    if (!await update("searching", (record) => { record.status = "unknown"; record.message = message; record.dispatchedAt = this.time(); })) return;
    try {
      const result = preview || this.dependencies.preview?.() === true ? { status: "previewed" as const, providerMessageId: undefined } : await this.dependencies.sms.send({ destinationE164: claimed.destination, message, idempotencyKey: `calle-followup:${claimed.id}` });
      await this.store.transact((state) => {
        const record = state.calls.find((item) => item.id === claimed.id)!;
        record.status = result.status;
        record.providerMessageId = result.providerMessageId;
      });
    } catch { /* A persisted unknown outcome must never be retried automatically. */ }
  }
  async checkDelivery() {
    if (!this.dependencies.enabled() || !this.dependencies.readSmsStatus) return;
    const claimed = await this.store.transact((state) => {
      const record = state.calls.find((item) => item.status === "queued" && item.providerMessageId
        && this.time() - item.createdAt <= 86_400_000 && (item.nextDeliveryCheck ?? 0) <= this.time());
      if (!record) return;
      record.nextDeliveryCheck = this.time() + 30_000;
      return structuredClone(record);
    });
    if (!claimed) return;
    let receipt: TwilioSmsReceipt | undefined;
    try { receipt = await this.dependencies.readSmsStatus(claimed.providerMessageId!); } catch { /* Read-only retry on the next interval. */ }
    await this.store.transact((state) => {
      const record = state.calls.find((item) => item.id === claimed.id)!;
      // A signed callback may already have finalized the message during this lookup.
      if (record.status !== "queued") return;
      record.checkedAt = this.time(); record.checkFailed = !receipt;
      if (!receipt) return;
      // Do not regress a carrier-accepted message to an older queued response.
      if (record.receipt?.status === "sent" && ["queued", "sending"].includes(receipt.status)) return;
      record.receipt = receipt;
      if (receipt.status === "delivered") record.status = "sent";
      if (["failed", "undelivered"].includes(receipt.status)) record.status = "failed";
    });
  }
  async applyDelivery(event: SmsDeliveryEvent) {
    return this.store.transact((state) => {
      const record = state.calls.find((call) => call.providerMessageId === event.providerMessageId);
      if (!record) return;
      if (!record.deliveryEvents.includes(event.eventId) && !["previewed", "sent", "failed"].includes(record.status)) {
        record.deliveryEvents.push(event.eventId); record.status = event.status;
        record.checkedAt = this.time(); record.checkFailed = false;
        record.receipt = { status: event.status === "sent" ? "delivered" : "failed" };
      }
      return true;
    });
  }
}
