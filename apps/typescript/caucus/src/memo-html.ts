/**
 * Printable settlement memorandum — self-contained HTML.
 *
 * `renderMemoHtml` renders one HTML document (inline CSS, zero external
 * assets, print-to-PDF friendly) from a case record plus its ledger entries.
 * Data assembly is delegated entirely to `writeMemoJson` in `src/memo.ts`,
 * so the HTML, markdown, and JSON artifacts can never disagree about content.
 *
 * Invariants (inherited from memo.ts and enforced by test/memo-html.test.ts):
 *  - Phone numbers appear ONLY masked to their last four digits.
 *  - Party-private data (reservation bounds, intake notes) never appears.
 *  - Every case-derived string (labels, summary, conditions, evidence quotes,
 *    spoken phrases, ids, hashes) is HTML-escaped — call transcripts are
 *    untrusted input and must not be able to inject markup.
 *  - Deterministic: `nowIso` is the only timestamp source; no clock or
 *    randomness inside.
 */

import type { CaseRecord, LedgerEntry } from "./types.js";
import {
  MEMO_NOTICE,
  formatUsd,
  writeMemoJson,
  type MemoAttestation,
  type MemoJson,
  type MemoRound,
} from "./memo.js";

// ---------------------------------------------------------------------------
// Escaping & small helpers
// ---------------------------------------------------------------------------

/** Escape a string for use in HTML text or attribute-value context. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const esc = escapeHtml;

function mono(text: string): string {
  return `<code>${esc(text)}</code>`;
}

function textOrDash(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 0 ? esc(trimmed) : "&mdash;";
}

function quoteList(quotes: readonly string[]): string {
  if (quotes.length === 0) return "&mdash;";
  return quotes.map((q) => `&ldquo;${esc(q)}&rdquo;`).join("<br>");
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function headerSection(memo: MemoJson): string {
  return `<header>
  <p class="brand">Caucus &mdash; neutral phone mediation</p>
  <h1>Settlement Memorandum</h1>
  <table class="meta">
    <tr><th scope="row">Case</th><td>${mono(memo.caseId)}</td></tr>
    <tr><th scope="row">Case state</th><td>${mono(memo.state)}</td></tr>
    <tr><th scope="row">Vertical</th><td>${mono(memo.dispute.vertical)}</td></tr>
    <tr><th scope="row">Generated at</th><td>${esc(memo.generatedAt)}</td></tr>
  </table>
</header>`;
}

function noticeSection(): string {
  return `<section class="notice" role="note">${esc(MEMO_NOTICE)}</section>`;
}

function partiesSection(memo: MemoJson): string {
  const rows = memo.parties
    .map(
      (p) =>
        `<tr class="party"><td>${esc(p.id)}</td><td>${esc(p.label)}</td><td>${mono(p.phoneMasked)}</td></tr>`,
    )
    .join("\n");
  return `<section>
  <h2>Parties</h2>
  <table>
    <thead><tr><th>Party</th><th>Label</th><th>Phone (masked)</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</section>`;
}

function disputeSection(memo: MemoJson): string {
  return `<section>
  <h2>Dispute</h2>
  <p>${esc(memo.dispute.summary)}</p>
  <p>Amount in dispute: <strong>${esc(formatUsd(memo.dispute.amountCents))} ${esc(memo.dispute.currency)}</strong></p>
</section>`;
}

function roundRow(r: MemoRound): string {
  const amount = r.amountCents === null ? "&mdash;" : esc(formatUsd(r.amountCents));
  return `<tr class="round"><td>${r.round}</td><td>${esc(`${r.partyId} (${r.partyLabel})`)}</td><td>${esc(
    r.kind,
  )}</td><td class="num">${amount}</td><td>${
    r.conditions.length > 0 ? esc(r.conditions.join("; ")) : "&mdash;"
  }</td><td>${quoteList(r.evidence)}</td><td>${esc(r.outcome)}</td></tr>`;
}

function roundsSection(memo: MemoJson): string {
  if (memo.rounds.length === 0) {
    return `<section>
  <h2>Rounds</h2>
  <p class="empty">No shuttle rounds were completed.</p>
</section>`;
  }
  return `<section>
  <h2>Rounds</h2>
  <table>
    <thead><tr><th>Round</th><th>Party</th><th>Kind</th><th>Amount</th><th>Conditions</th><th>Evidence</th><th>Outcome</th></tr></thead>
    <tbody>
${memo.rounds.map(roundRow).join("\n")}
    </tbody>
  </table>
</section>`;
}

function attestationRow(a: MemoAttestation): string {
  const verdict = a.verified
    ? `<td class="ok">verified</td>`
    : `<td class="bad">NOT VERIFIED</td>`;
  return `<tr class="attestation"><td>${esc(a.party)}</td><td>${mono(a.callId)}</td><td>&ldquo;${esc(
    a.spokenPhrase,
  )}&rdquo;</td>${verdict}<td>${esc(a.at)}</td></tr>`;
}

function settlementSection(memo: MemoJson): string {
  const s = memo.settlement;
  if (s === null) {
    return `<section>
  <h2>Settlement terms</h2>
  <p class="empty">No settlement was reached on this case.</p>
</section>`;
  }
  const conditions =
    s.conditions.length > 0
      ? `<ul>${s.conditions.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`
      : `<p>No additional conditions.</p>`;
  const attestations =
    s.attestations.length > 0
      ? `<table>
    <thead><tr><th>Party</th><th>Call</th><th>Spoken phrase</th><th>Verified</th><th>At</th></tr></thead>
    <tbody>
${s.attestations.map(attestationRow).join("\n")}
    </tbody>
  </table>`
      : `<p class="empty">No attestations recorded.</p>`;
  return `<section>
  <h2>Settlement terms</h2>
  <p>Settlement amount: <strong>${esc(formatUsd(s.amountCents))}</strong></p>
  ${conditions}
  <p>Terms digest (SHA-256): ${mono(s.termsDigest)}</p>
  <p>Confirmation code (derived from the terms digest): ${mono(s.attestationPhrase)}</p>
  <h2>Attestations</h2>
  ${attestations}
</section>`;
}

function ledgerSection(memo: MemoJson): string {
  const head = memo.ledger.headHash === null ? "&mdash;" : mono(memo.ledger.headHash);
  return `<section>
  <h2>Ledger</h2>
  <p>Entries: ${memo.ledger.entries}</p>
  <p>Chain head hash: ${head}</p>
</section>`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const CSS = `
  * { box-sizing: border-box; }
  body {
    font: 14px/1.55 Georgia, "Times New Roman", serif;
    color: #1a1a1a;
    background: #ffffff;
    max-width: 52rem;
    margin: 2rem auto;
    padding: 0 1.5rem;
  }
  header .brand {
    font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #555;
    margin: 0 0 0.25rem;
  }
  h1 { font-size: 26px; margin: 0 0 1rem; }
  h2 {
    font-size: 16px;
    margin: 1.75rem 0 0.5rem;
    border-bottom: 1px solid #bbb;
    padding-bottom: 0.2rem;
  }
  table { border-collapse: collapse; width: 100%; margin: 0.5rem 0 1rem; }
  th, td {
    border: 1px solid #999;
    padding: 5px 8px;
    text-align: left;
    vertical-align: top;
    font-size: 13px;
  }
  thead th { background: #f2f2ef; }
  table.meta, table.meta th, table.meta td { border: none; padding: 1px 12px 1px 0; }
  table.meta th { font-weight: normal; color: #555; width: 8rem; }
  td.num { text-align: right; white-space: nowrap; }
  code {
    font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    word-break: break-all;
  }
  .notice {
    border: 2px solid #8a1f1f;
    background: #fdf4f4;
    color: #4a1010;
    font-weight: bold;
    padding: 0.75rem 1rem;
    margin: 1rem 0 1.5rem;
  }
  .ok { color: #1c6b30; }
  .bad { color: #8a1f1f; font-weight: bold; }
  .empty { color: #555; font-style: italic; }
  footer {
    margin-top: 2.5rem;
    border-top: 1px solid #bbb;
    padding-top: 0.5rem;
    font-size: 12px;
    color: #555;
  }
  @page { margin: 18mm; }
  @media print {
    body { max-width: none; margin: 0; padding: 0; }
    .notice, tr { break-inside: avoid; }
  }
`;

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/**
 * Render the settlement memorandum as a single self-contained HTML document,
 * suitable for print-to-PDF. Deterministic for identical inputs — `nowIso`
 * is the only timestamp source.
 */
export function renderMemoHtml(
  rec: CaseRecord,
  ledger: readonly LedgerEntry[],
  nowIso: string,
): string {
  const memo = writeMemoJson(rec, ledger, nowIso);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Settlement Memorandum &mdash; ${esc(memo.caseId)}</title>
<style>${CSS}</style>
</head>
<body>
${headerSection(memo)}
${noticeSection()}
${partiesSection(memo)}
${disputeSection(memo)}
${roundsSection(memo)}
${settlementSection(memo)}
${ledgerSection(memo)}
<footer>Generated deterministically from the case record and its hash-chained ledger. Case ${textOrDash(
    memo.caseId,
  )} &middot; ${esc(memo.generatedAt)}</footer>
</body>
</html>
`;
}
