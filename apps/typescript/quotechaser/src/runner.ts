import fs from "node:fs";
import { CalleClient } from "@call-e/calle";
import { buildTask, resultSchema } from "./script.js";
import type { CalleCallResult, QuoteOutcome, QuoteReport, QuoteRequest, Vendor, VendorQuote } from "./types.js";

interface CallePort {
  createAndWait(input: {
    task: string;
    resultSchema: Record<string, unknown>;
    metadata: Record<string, string>;
  }): Promise<CalleCallResult>;
}

export function createSdkPort(apiKey: string): CallePort {
  const client = new CalleClient({ apiKey });
  return {
    createAndWait(input) {
      return client.calls.createAndWait(input) as Promise<CalleCallResult>;
    }
  };
}

export async function runQuotes(request: QuoteRequest, port: CallePort): Promise<QuoteReport> {
  const quotes: VendorQuote[] = [];
  for (const vendor of request.vendors) {
    const call = await port.createAndWait({
      task: buildTask(request, vendor),
      resultSchema: resultSchema(),
      metadata: {
        app: "quotechaser",
        request_id: request.request_id,
        vendor_name: vendor.name
      }
    });
    quotes.push(toVendorQuote(vendor, call));
  }
  return {
    request_id: request.request_id,
    generated_at: new Date().toISOString(),
    calls_placed: request.vendors.length,
    quotes
  };
}

export function toVendorQuote(vendor: Vendor, call: CalleCallResult): VendorQuote {
  const structured = objectOrNull(call.structuredResult ?? call.structured_result);
  const status = typeof call.status === "string" ? call.status : "unknown";
  const completed = call.taskCompleted ?? call.task_completed ?? false;
  const outcome = normalizeOutcome(structured?.outcome, status, completed);
  return {
    vendor_name: vendor.name,
    outcome,
    unit_price: numberOrNull(structured?.unit_price),
    total_price: numberOrNull(structured?.total_price),
    currency: stringOrNull(structured?.currency),
    availability: stringOrDefault(structured?.availability, "unknown"),
    lead_time: stringOrDefault(structured?.lead_time, "unknown"),
    minimum_order: stringOrDefault(structured?.minimum_order, "unknown"),
    callback_required: Boolean(structured?.callback_required ?? outcome === "callback_needed"),
    evidence: evidenceList(call.evidence)
  };
}

export function writeReport(path: string, report: QuoteReport): void {
  fs.writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

function normalizeOutcome(value: unknown, status: string, completed: boolean): QuoteOutcome {
  if (
    value === "quote_received" ||
    value === "not_available" ||
    value === "callback_needed" ||
    value === "unreachable" ||
    value === "outcome_unknown"
  ) {
    return value;
  }
  if (status === "completed" && completed) {
    return "quote_received";
  }
  if (status === "failed" || status === "canceled") {
    return "unreachable";
  }
  return "outcome_unknown";
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function evidenceList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
