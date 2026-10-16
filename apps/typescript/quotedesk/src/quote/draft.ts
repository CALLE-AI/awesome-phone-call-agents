// Draft customer quote email. GENERATED, NEVER SENT: margin approval and the
// send button belong to a human. The customer-facing reply is an email, not
// a call — forcing a call where another channel fits better is a mistake.

import type { MarketConfig, QuoteRow, RequestedSpec } from '../types.js';
import { formatMoney } from './margin.js';

export function draftCustomerQuote(
  spec: RequestedSpec,
  rows: QuoteRow[],
  market: MarketConfig,
  companyName: string,
): string {
  const eligible = rows
    .filter((r) => r.eligibleForQuote && r.customerPrice !== undefined)
    .sort((a, b) => (a.customerPrice ?? Infinity) - (b.customerPrice ?? Infinity));

  if (eligible.length === 0) {
    return [
      `[INTERNAL DRAFT — NOT SENT]`,
      ``,
      `No distributor quote passed verification for ${spec.rfqId}.`,
      `Do not quote the customer yet. Review reasons per distributor:`,
      ...rows.map((r) => `  - ${r.distributorId}: ${r.humanReviewReason ?? r.verdict}`),
    ].join('\n');
  }

  const best = eligible[0];
  const config = [
    spec.gpu,
    spec.ramGb ? `${spec.ramGb}GB RAM` : undefined,
    spec.storageGb ? (spec.storageGb % 1024 === 0 ? `${spec.storageGb / 1024}TB` : `${spec.storageGb}GB`) + ' SSD' : undefined,
  ].filter(Boolean).join(' / ');

  const total = (best.customerPrice ?? 0) * spec.quantity;

  return [
    `[DRAFT — requires human review and send. Never auto-sent.]`,
    ``,
    `Subject: Quotation ${spec.rfqId} — ${spec.family} x ${spec.quantity}`,
    ``,
    `Dear Customer,`,
    ``,
    `Thank you for your enquiry. We are pleased to quote as follows:`,
    ``,
    `  Item: ${spec.family} (${config})`,
    `  Verified part number: ${best.quoted.part_number ?? 'on record'}`,
    `  Quantity: ${spec.quantity}`,
    `  Unit price: ${formatMoney(best.customerPrice ?? 0, market)} (incl. taxes and delivery)`,
    `  Total: ${formatMoney(total, market)}`,
    `  Delivery: ${best.quoted.eta_days} days from confirmed order${spec.neededBy ? ` (your requested date: ${spec.neededBy})` : ''}`,
    ``,
    `The configuration has been verified with our distributor against your exact specification (graphics card, memory and storage read back on a recorded structured call).`,
    ``,
    `Prices valid 48 hours owing to market movement.`,
    ``,
    `Best regards,`,
    `${companyName} Sales Desk`,
  ].join('\n');
}
