import {
  callId,
  callSummary,
  failureReason,
  lifecycleStatus,
  providerResult,
  TERMINAL,
  transcript,
  type CallSnapshot,
  type CalleClient,
} from "./calle.ts";
import { FINAL_STATUSES, taskId, type Ledger, type Task } from "./ledger.ts";
import { assertAllowlisted, assertE164, mask } from "./phone.ts";
import { analyzeQuote, completeness, rankQuotes, type RankedQuote } from "./ranking.ts";
import { validateHoldResult, validateQuoteResult } from "./schema.ts";
import { holdCallBody, idempotencyKey, quoteCallBody, type QuoteRequest, type Vendor } from "./task.ts";

export interface Options {
  /** Public HTTPS webhook URL, or null to rely on polling. */
  webhookUrl: string | null;
}

// ---------------------------------------------------------------- preflight

/** Everything the buyer confirms before anything rings. Pure: no network, no key. */
export function planRace(request: QuoteRequest, options: Options) {
  if (request.vendors.length < 2) throw new Error("Select at least two authorized suppliers");
  for (const v of request.vendors) {
    assertE164(v.phone, `${v.name} phone`);
    if (!v.authorizationNote.trim()) throw new Error(`${v.name} needs an authorization note`);
  }
  if (!/^\d+(?:\.\d+)?\s*[a-zA-Z]+$/.test(request.quantity.trim()))
    throw new Error('quantity must look like "20 kg" so quotes can be compared in one unit');
  return {
    representing: `${request.buyerBusiness} · ${request.buyerName}`,
    goal: `confirm ${request.quantity} of ${request.item} before ${request.deadline}`,
    recipients: request.vendors.map((v) => ({ vendor: v.name, phone: mask(v.phone), authorization: v.authorizationNote })),
    boundary: "No purchase, hold, payment, or legal commitment will be made.",
    delivery: options.webhookUrl ? `webhook ${options.webhookUrl} + polling` : "polling GET /v1/calls/{id}",
    calls: request.vendors.map((v) => ({
      vendorId: v.id,
      idempotencyKey: idempotencyKey(request.id, v.id, "quote"),
      body: quoteCallBody(request, v, options.webhookUrl),
    })),
  };
}

// ---------------------------------------------------------------- dispatch

/**
 * Creates one quote call per vendor. Each task keeps a stable idempotency key, so running
 * this twice (a double click, a crash, a retry) never places a second call: a task that
 * already has a provider call id is skipped, and CALL-E returns the original call for a
 * repeated key.
 */
export async function startRace(ledger: Ledger, client: CalleClient, request: QuoteRequest, options: Options & { allowlist: Set<string> }) {
  planRace(request, options);
  for (const v of request.vendors) assertAllowlisted(v.phone, options.allowlist);
  if (ledger.data.request && ledger.data.request.id !== request.id) throw new Error("This ledger belongs to another request");
  ledger.data.request = request;
  ledger.audit(request.buyerName, "race_confirmed", { vendors: request.vendors.map((v) => v.id) });
  for (const vendor of request.vendors) {
    const task = ledger.ensureTask("quote", vendor.id, idempotencyKey(request.id, vendor.id, "quote"));
    if (task.providerCallId) continue;
    try {
      const call = await client.createCall(quoteCallBody(request, vendor, options.webhookUrl), task.idempotencyKey);
      ledger.updateTask(task.id, { providerCallId: callId(call), status: initialStatus(call) });
      ledger.audit(request.buyerName, "quote_call_started", { vendor_id: vendor.id, provider_call_id: callId(call) });
    } catch (error) {
      ledger.updateTask(task.id, { status: "failed", lastError: error instanceof Error ? error.message : String(error) });
    }
  }
  ledger.save();
}

/** Terminal states are only ever applied through the re-fetch path. */
function initialStatus(call: CallSnapshot) {
  const status = lifecycleStatus(call);
  return status === "ringing" || status === "in_progress" ? status : "queued";
}

// ---------------------------------------------------------------- results

/**
 * Applies one authoritative snapshot from GET /v1/calls/{id}. The webhook receiver and the
 * poller both end here, so a result is stored the same way whichever arrives first, and a
 * task that is already final is never processed twice.
 */
export function applySnapshot(ledger: Ledger, task: Task, call: CallSnapshot, via: "poll" | "webhook"): string {
  if (FINAL_STATUSES.includes(task.status)) return task.status;
  const status = lifecycleStatus(call);
  if (!TERMINAL.includes(status)) {
    if (status && status !== task.status) ledger.updateTask(task.id, { status });
    return status;
  }
  const label = (call.completion_confidence as { label?: unknown } | null)?.label;
  const evidence = {
    summary: callSummary(call),
    transcript: transcript(call),
    confidence: typeof label === "string" ? label : "",
  };
  let final = status;
  if (status !== "completed") {
    ledger.updateTask(task.id, { ...evidence, status, lastError: failureReason(call) });
  } else {
    try {
      const result = task.kind === "hold" ? validateHoldResult(providerResult(call)) : validateQuoteResult(providerResult(call));
      ledger.updateTask(task.id, { ...evidence, status: "completed", result });
    } catch (error) {
      final = "result_validation_failed";
      ledger.updateTask(task.id, { ...evidence, status: final, lastError: error instanceof Error ? error.message : String(error) });
    }
  }
  ledger.audit(`CALL-E ${via}`, `call_${final}`, { provider_call_id: task.providerCallId, kind: task.kind, vendor_id: task.vendorId });
  ledger.save();
  return final;
}

/** Polling fallback: re-reads every open call. Read-only, so a timeout can never redial. */
export async function syncRace(ledger: Ledger, client: CalleClient): Promise<void> {
  for (const task of ledger.openTasks()) {
    try {
      applySnapshot(ledger, task, await client.getCall(task.providerCallId!), "poll");
    } catch (error) {
      ledger.audit("poller", "poll_failed", { task: task.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

export async function waitForRace(ledger: Ledger, client: CalleClient, { intervalMs = 5000, timeoutMs = 15 * 60_000, onChange = (_: string) => {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (ledger.openTasks().length && Date.now() < deadline) {
    await syncRace(ledger, client);
    const now = Object.values(ledger.data.tasks).map((t) => `${t.vendorId}:${t.status}`).join(" ");
    if (now !== last) onChange(now);
    last = now;
    if (ledger.openTasks().length) await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ---------------------------------------------------------------- board

export function board(ledger: Ledger) {
  const request = ledger.data.request;
  if (!request) throw new Error("No race in this ledger");
  const vendorName = (id: string) => request.vendors.find((v) => v.id === id)?.name ?? id;
  const quotes: RankedQuote[] = Object.values(ledger.data.tasks)
    .filter((t) => t.kind === "quote" && t.status === "completed" && t.result)
    .map((t) => {
      const quote = validateQuoteResult(t.result);
      return { vendorId: t.vendorId, vendorName: vendorName(t.vendorId), quote, completeness: completeness(quote), ...analyzeQuote(quote, request.quantity) };
    });
  const hold = ledger.data.decision ? ledger.data.tasks[taskId("hold", ledger.data.decision.vendorId)] ?? null : null;
  return {
    request,
    tasks: Object.values(ledger.data.tasks).filter((t) => t.kind === "quote").map((t) => ({ ...t, vendorName: vendorName(t.vendorId) })),
    quotes,
    rankings: rankQuotes(quotes),
    decision: ledger.data.decision,
    hold,
  };
}

// ---------------------------------------------------------------- human decisions

/** Internal record only: no order, no payment, no reservation. */
export function approveVendor(ledger: Ledger, vendorId: string, { humanApproved }: { humanApproved: boolean }) {
  if (!humanApproved) throw new Error("Explicit human approval is required");
  const quote = board(ledger).quotes.find((q) => q.vendorId === vendorId);
  if (!quote) throw new Error("Only a vendor with a validated quote from a real call can be approved");
  if (quote.status === "excluded") throw new Error("This supplier did not provide an available quote");
  ledger.data.decision = { vendorId, approvedAt: new Date().toISOString(), holdApproved: false };
  ledger.audit(ledger.data.request!.buyerName, "vendor_approved_internally", { vendor_id: vendorId });
  ledger.save();
  return ledger.data.decision;
}

/** A second, separate approval and a second call that states it is not a purchase. */
export async function requestHold(ledger: Ledger, client: CalleClient, options: Options & { allowlist: Set<string>; humanApproved: boolean }) {
  if (!options.humanApproved) throw new Error("Explicit human approval is required for a hold request");
  const decision = ledger.data.decision;
  const request = ledger.data.request;
  if (!decision || !request) throw new Error("Approve a vendor internally before requesting a hold");
  const vendor = request.vendors.find((v) => v.id === decision.vendorId) as Vendor;
  assertAllowlisted(vendor.phone, options.allowlist);
  const task = ledger.ensureTask("hold", vendor.id, idempotencyKey(request.id, vendor.id, "hold"));
  if (task.providerCallId) return task;
  const call = await client.createCall(holdCallBody(request, vendor, options.webhookUrl), task.idempotencyKey);
  decision.holdApproved = true;
  ledger.updateTask(task.id, { providerCallId: callId(call), status: initialStatus(call) });
  ledger.audit(request.buyerName, "hold_call_started", { vendor_id: vendor.id, provider_call_id: callId(call) });
  ledger.save();
  return task;
}
