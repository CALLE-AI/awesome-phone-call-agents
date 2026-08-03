import { maskPhone } from "./config.js";
import type { QuoteReport, QuoteRequest } from "./types.js";

export function renderReport(report: QuoteReport, request: QuoteRequest): string {
  const lines = [`QuoteChaser report for ${report.request_id}`, `Calls placed: ${report.calls_placed}`, ""];
  for (const quote of report.quotes) {
    const vendor = request.vendors.find((item) => item.name === quote.vendor_name);
    const price = quote.total_price === null ? "unknown" : `${quote.currency ?? "currency unknown"} ${quote.total_price}`;
    lines.push(
      `${quote.vendor_name}${vendor ? ` ${maskPhone(vendor.phone)}` : ""}`,
      `  outcome: ${quote.outcome}`,
      `  total: ${price}`,
      `  availability: ${quote.availability}`,
      `  lead time: ${quote.lead_time}`,
      `  minimum order: ${quote.minimum_order}`,
      `  callback required: ${quote.callback_required ? "yes" : "no"}`,
      ""
    );
  }
  return lines.join("\n").trimEnd();
}
