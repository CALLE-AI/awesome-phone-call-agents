#!/usr/bin/env node
// Renders a finished run into a self-contained HTML audit report.
//
// Coverage is rendered above the ghost rate, and every headline figure carries its
// denominator, because a ghost rate lifted out of this page without its coverage
// reads as a claim about the whole directory.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { formatPercent, summarize } from './adequacy.mjs';
import { maskPhone } from './mask.mjs';

const STATE_LABELS = {
  confirmed_active: 'Usable',
  confirmed_ghost: 'Ghost',
  confirmed_closed_panel: 'Closed panel',
  unverified: 'Unverified',
  skipped: 'Skipped',
  deferred: 'Deferred',
  preview: 'Preview',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function metricCard(label, value, sub) {
  return `<div class="card">
        <div class="card-label">${escapeHtml(label)}</div>
        <div class="card-value">${escapeHtml(value)}</div>
        <div class="card-sub">${escapeHtml(sub)}</div>
      </div>`;
}

export function renderReport(run) {
  const { score } = run;
  const counts = score.counts;

  const rows = run.rows
    .map(
      (row) => `<tr>
          <td class="mono">${escapeHtml(row.listing_id)}</td>
          <td>${escapeHtml(row.provider_name)}<div class="muted">${escapeHtml(row.specialty || '')}</div></td>
          <td>${escapeHtml(row.office_name || '')}</td>
          <td class="mono">${escapeHtml(maskPhone(row.phone_masked || ''))}</td>
          <td><span class="pill pill-${escapeHtml(row.state)}">${escapeHtml(STATE_LABELS[row.state] || row.state)}</span></td>
          <td class="mono muted">${escapeHtml(row.reason || '')}</td>
          <td class="mono">${row.next_appointment_weeks == null ? '' : `${escapeHtml(row.next_appointment_weeks)}w`}</td>
        </tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ghost Network Audit</title>
<style>
  :root {
    --bg: #ffffff; --fg: #16181d; --muted: #5f6673; --line: #e4e7ec;
    --panel: #f7f8fa; --ghost: #b3261e; --ok: #1d6f42; --warn: #8a5a00; --unk: #5f6673;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #101215; --fg: #e9ecf1; --muted: #9aa2af; --line: #262a31;
      --panel: #171a1f; --ghost: #ff8a80; --ok: #7fd6a0; --warn: #e6b45e; --unk: #9aa2af;
    }
  }
  :root[data-theme="dark"] {
    --bg: #101215; --fg: #e9ecf1; --muted: #9aa2af; --line: #262a31;
    --panel: #171a1f; --ghost: #ff8a80; --ok: #7fd6a0; --warn: #e6b45e; --unk: #9aa2af;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); margin: 0 0 28px; font-size: 14px; }
  .summary {
    background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
    padding: 16px 18px; margin-bottom: 28px; font-size: 15px;
  }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 12px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
  .card-label { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  .card-value { font-size: 27px; font-weight: 650; margin: 6px 0 2px; letter-spacing: -0.02em; }
  .card-sub { font-size: 12px; color: var(--muted); }
  .lead { border-color: var(--fg); }
  .note { color: var(--muted); font-size: 13px; margin: 18px 0 30px; }
  .scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; }
  table { border-collapse: collapse; width: 100%; min-width: 760px; font-size: 14px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); background: var(--panel); }
  tr:last-child td { border-bottom: none; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  .muted { color: var(--muted); font-size: 12px; }
  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid currentColor; white-space: nowrap; }
  .pill-confirmed_ghost { color: var(--ghost); }
  .pill-confirmed_active { color: var(--ok); }
  .pill-confirmed_closed_panel { color: var(--warn); }
  .pill-unverified, .pill-skipped, .pill-deferred, .pill-preview { color: var(--unk); }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Ghost network audit</h1>
    <p class="sub">
      ${escapeHtml(run.plan_name || 'Unnamed plan')} &middot; run ${escapeHtml(run.run_id)} &middot;
      ${escapeHtml(run.mode)} mode &middot; generated ${escapeHtml(run.generated_at)}
    </p>

    <div class="summary">${escapeHtml(summarize(score))}</div>

    <div class="cards">
      ${metricCard('Coverage', formatPercent(score.coverage), `${counts.confirmed} of ${counts.dialable} dialable listings`)}
      ${metricCard('Ghost rate', formatPercent(score.ghost_rate), `${counts.confirmed_ghost} of ${counts.confirmed} confirmed`)}
      ${metricCard('Closed panels', formatPercent(score.closed_panel_rate), `${counts.confirmed_closed_panel} of ${counts.confirmed} confirmed`)}
      ${metricCard('Usable to a patient', formatPercent(score.effective_availability), `${counts.confirmed_active} of ${counts.confirmed} confirmed`)}
      ${metricCard('Median wait', score.median_wait_weeks == null ? 'n/a' : `${score.median_wait_weeks}w`, `${counts.active_without_stated_wait} usable listings gave no estimate`)}
      ${metricCard('Unverified', String(counts.unverified), 'no clear answer - not a finding')}
    </div>

    <p class="note">
      Rates are computed over confirmed listings only. Listings that were never reached are
      reported as unverified rather than folded into either bucket, and every listing skipped
      before dialing is listed below with the gate that stopped it. Phone numbers are masked.
    </p>

    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Listing</th><th>Provider</th><th>Office</th><th>Phone</th>
            <th>State</th><th>Reason</th><th>Wait</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>
`;
}

async function main() {
  const argv = process.argv.slice(2);
  const get = (flag, fallback) => {
    const index = argv.indexOf(flag);
    return index === -1 ? fallback : argv[index + 1];
  };
  const runPath = resolve(String(get('--run', 'out/audit-run.json')));
  const outPath = resolve(String(get('--out', 'out/report.html')));

  const run = JSON.parse(await readFile(runPath, 'utf8'));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, renderReport(run), 'utf8');
  process.stdout.write(`Report written to ${outPath}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
