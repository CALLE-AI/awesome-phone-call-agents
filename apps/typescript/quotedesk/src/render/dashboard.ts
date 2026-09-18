// JSON -> one static HTML file. No framework, no external assets: the file
// opens from disk and screenshots cleanly. All phone numbers arrive masked.

import type { ScorecardRow } from '../ledger/scorecard.js';
import type { MarketConfig, QuoteRow, RequestedSpec } from '../types.js';
import { formatMoney } from '../quote/margin.js';

const VERDICT_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  verified_match: { label: 'VERIFIED MATCH', bg: '#dcfce7', fg: '#166534' },
  wrong_configuration: { label: 'WRONG CONFIGURATION', bg: '#fee2e2', fg: '#991b1b' },
  unverified: { label: 'UNVERIFIED', bg: '#fef9c3', fg: '#854d0e' },
};

export function renderDashboard(input: {
  spec: RequestedSpec;
  rows: QuoteRow[];
  distributorNames: Map<string, string>;
  distributorMasked: Map<string, string>;
  scorecard: ScorecardRow[];
  market: MarketConfig;
  draftEmail: string;
}): string {
  const { spec, rows, market } = input;
  const money = (n?: number) => (n === undefined ? '—' : formatMoney(n, market));

  const quoteRows = rows
    .slice()
    .sort((a, b) => (a.quoted.unit_price ?? Infinity) - (b.quoted.unit_price ?? Infinity))
    .map((r) => {
      const badge = VERDICT_BADGE[r.verdict];
      const name = esc(input.distributorNames.get(r.distributorId) ?? r.distributorId);
      const masked = esc(input.distributorMasked.get(r.distributorId) ?? '');
      return `<tr>
        <td><strong>${name}</strong><br><span class="muted">${masked}</span></td>
        <td>${esc(r.quoted.part_number ?? '—')}</td>
        <td>${esc(r.quoted.gpu ?? '—')} / ${r.quoted.ram_gb ?? '—'}GB / ${r.quoted.storage_gb ?? '—'}GB</td>
        <td>${money(r.quoted.unit_price)}<br><span class="muted">${esc(shorten(r.quoted.price_quote))}</span></td>
        <td>${r.quoted.eta_days !== undefined ? r.quoted.eta_days + 'd' : '—'} <span class="muted">(${esc(r.quoted.eta_confidence ?? 'unstated')})</span></td>
        <td><span class="badge" style="background:${badge.bg};color:${badge.fg}">${badge.label}</span>${
          r.mismatchedFields.length ? `<br><span class="muted">mismatch: ${esc(r.mismatchedFields.join(', '))}</span>` : ''
        }</td>
        <td>${r.eligibleForQuote ? money(r.customerPrice) : `<span class="muted">${esc(r.humanReviewReason ?? 'excluded')}</span>`}</td>
      </tr>`;
    })
    .join('\n');

  const scoreRows = input.scorecard
    .map(
      (s) => `<tr>
      <td><strong>${esc(input.distributorNames.get(s.distributorId) ?? s.distributorId)}</strong></td>
      <td>${s.calls}</td><td>${s.answered}</td>
      <td>${s.verifiedMatches}</td><td>${s.wrongConfigurations}</td><td>${s.unverified}</td>
      <td>${s.avgQuotedPrice !== undefined ? money(s.avgQuotedPrice) : '—'}</td>
      <td>${s.avgPromisedEtaDays ?? '—'}</td>
      <td>${s.verifiedRatePct}%</td>
    </tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>QuoteDesk — ${esc(spec.rfqId)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; margin: 2rem auto; max-width: 1080px; color: #111827; background: #f9fafb; padding: 0 1rem; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.1rem; margin-top: 2.2rem; }
  table { border-collapse: collapse; width: 100%; background: #fff; font-size: 0.85rem; }
  th, td { border: 1px solid #e5e7eb; padding: 0.5rem 0.6rem; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; }
  .badge { font-weight: 700; font-size: 0.72rem; padding: 0.15rem 0.5rem; border-radius: 999px; white-space: nowrap; }
  .muted { color: #6b7280; font-size: 0.78rem; }
  .spec { background: #fff; border: 1px solid #e5e7eb; padding: 1rem; border-radius: 8px; }
  pre { background: #111827; color: #f9fafb; padding: 1rem; border-radius: 8px; white-space: pre-wrap; font-size: 0.8rem; }
  .note { background: #eff6ff; border: 1px solid #bfdbfe; padding: 0.6rem 1rem; border-radius: 8px; font-size: 0.85rem; }
</style>
</head>
<body>
<h1>QuoteDesk — RFQ ${esc(spec.rfqId)}</h1>
<div class="spec">
  <strong>${esc(spec.family)}</strong> — ${esc(spec.gpu ?? '')}, ${spec.ramGb ?? '?'}GB RAM, ${spec.storageGb ?? '?'}GB storage ×
  <strong>${spec.quantity}</strong>${spec.neededBy ? `, needed by ${esc(spec.neededBy)}` : ''}
  <div class="muted">Source: ${esc(spec.sourceUrl ?? 'email only')}</div>
</div>

<h2>Distributor quotes (identity-checked)</h2>
<div class="note">A quote enters the customer draft only when the configuration is a <strong>verified match</strong> and price + ETA were read back on the call. The cheapest number is not automatically the answer.</div>
<br>
<table>
  <tr><th>Distributor</th><th>Part #</th><th>Quoted config</th><th>Unit price</th><th>ETA</th><th>Identity verdict</th><th>Customer price</th></tr>
  ${quoteRows}
</table>

<h2>Distributor scorecard</h2>
<table>
  <tr><th>Distributor</th><th>Calls</th><th>Answered</th><th>Verified</th><th>Wrong config</th><th>Unverified</th><th>Avg quote</th><th>Avg ETA (d)</th><th>Verified rate</th></tr>
  ${scoreRows}
</table>

<h2>Draft customer quote (never auto-sent)</h2>
<pre>${esc(input.draftEmail)}</pre>
<p class="muted">All phone numbers masked. Ledger is append-only and hash-chained. Generated by QuoteDesk.</p>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shorten(s?: string): string {
  if (!s) return '';
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}
