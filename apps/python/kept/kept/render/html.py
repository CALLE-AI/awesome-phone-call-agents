"""Self-contained HTML report. No network, no build step, no external assets.

A controller reads this, not a terminal, so the promise table leads with the
status and keeps the customer's own words next to the money. Every value is
escaped because evidence quotes are transcribed speech from outside the system.
"""

from __future__ import annotations

from html import escape

from kept.models import PromiseStatus
from kept.money import format_minor
from kept.report import Portfolio

_TOKENS = """
:root {
  --surface: #ffffff;
  --surface-sunken: #f6f7f9;
  --surface-raised: #ffffff;
  --border: #e3e6ea;
  --border-strong: #cdd3da;
  --text: #14181d;
  --text-muted: #5b6672;
  --accent: #1a5cff;
  --positive: #0d7a4a;
  --warning: #9a6200;
  --negative: #b3261e;
  --radius: 8px;
  --space: 8px;
  --font-sans: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --surface: #0f1216;
    --surface-sunken: #15191f;
    --surface-raised: #171c22;
    --border: #262d35;
    --border-strong: #38414b;
    --text: #e8ecf1;
    --text-muted: #97a3b0;
    --accent: #6c9bff;
    --positive: #4ad295;
    --warning: #e0a72c;
    --negative: #ff6b5e;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: calc(var(--space) * 5);
  background: var(--surface-sunken); color: var(--text);
  font-family: var(--font-sans); font-size: 14px; line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
main { max-width: 1080px; margin: 0 auto; }
h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 4px; }
h2 { font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
     color: var(--text-muted); margin: calc(var(--space) * 4) 0 var(--space); }
.meta { color: var(--text-muted); font-size: 13px; margin: 0 0 calc(var(--space) * 3); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
         gap: calc(var(--space) * 2); }
.card { background: var(--surface-raised); border: 1px solid var(--border);
        border-radius: var(--radius); padding: calc(var(--space) * 2); }
.card dt { color: var(--text-muted); font-size: 12px; margin: 0 0 4px; }
.card dd { margin: 0; font-family: var(--font-mono); font-size: 19px;
           font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.table-wrap { overflow-x: auto; background: var(--surface-raised);
              border: 1px solid var(--border); border-radius: var(--radius); }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 12px; font-weight: 600; color: var(--text-muted);
     padding: 10px 14px; border-bottom: 1px solid var(--border-strong); white-space: nowrap; }
td { padding: 10px 14px; border-bottom: 1px solid var(--border); vertical-align: top; }
tr:last-child td { border-bottom: none; }
.num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; text-align: right;
       white-space: nowrap; }
.quote { color: var(--text-muted); font-size: 13px; max-width: 34ch; }
.tag { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 8px;
       border-radius: 999px; border: 1px solid currentColor; white-space: nowrap; }
.tag-kept { color: var(--positive); }
.tag-open { color: var(--accent); }
.tag-partial, .tag-superseded { color: var(--warning); }
.tag-broken { color: var(--negative); }
footer { color: var(--text-muted); font-size: 12px; margin-top: calc(var(--space) * 4); }
"""

_STATUS_LABEL = {
    PromiseStatus.KEPT: "kept",
    PromiseStatus.OPEN: "open",
    PromiseStatus.PARTIAL: "partial",
    PromiseStatus.BROKEN: "broken",
    PromiseStatus.SUPERSEDED: "replaced",
}


def render_html(portfolio: Portfolio) -> str:
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>kept &mdash; promise ledger {escape(portfolio.as_of.isoformat())}</title>
<style>{_TOKENS}</style></head>
<body><main>
<h1>Promise ledger</h1>
<p class="meta">Every figure is derived from the append-only call ledger, as of
{escape(portfolio.as_of.isoformat())}.</p>
{_summary_cards(portfolio)}
<h2>Promises captured on calls</h2>
{_promise_table(portfolio)}
<h2>Invoices</h2>
{_invoice_table(portfolio)}
{_suppression_table(portfolio)}
<footer>Phone numbers are never written to this report. Amounts are held in minor units.</footer>
</main></body></html>"""


def _summary_cards(portfolio: Portfolio) -> str:
    currency = portfolio.currency
    keep_rate = portfolio.keep_rate
    cards = [
        ("Outstanding", format_minor(portfolio.outstanding_minor, currency)),
        ("Covered by open promise", format_minor(portfolio.covered_by_open_promise_minor, currency)),
        ("Arrived on promise", format_minor(portfolio.kept_minor, currency)),
        ("Promised, not paid", format_minor(portfolio.broken_minor, currency)),
        ("Promise keep rate", "n/a" if keep_rate is None else f"{keep_rate * 100:.0f}%"),
        ("Calls avoided", str(portfolio.calls_avoided)),
    ]
    items = "".join(
        f'<div class="card"><dt>{escape(label)}</dt><dd>{escape(value)}</dd></div>'
        for label, value in cards
    )
    return f'<dl class="cards">{items}</dl>'


def _promise_table(portfolio: Portfolio) -> str:
    if not portfolio.promises:
        return '<div class="table-wrap"><table><tr><td>No promises captured yet.</td></tr></table></div>'
    rows = "".join(
        "<tr>"
        f"<td>{escape(line.promise.invoice_id)}</td>"
        f"<td>{escape(line.customer_name)}</td>"
        f'<td class="num">{escape(format_minor(line.promise.amount_minor, portfolio.currency))}</td>'
        f"<td>{escape(line.promise.due_date.isoformat())}</td>"
        f"<td>{_status_tag(line.status)}</td>"
        f'<td class="num">{escape(format_minor(line.paid_minor, portfolio.currency))}</td>'
        f'<td class="quote">{escape(line.promise.evidence)}</td>'
        "</tr>"
        for line in portfolio.promises
    )
    return _wrap(
        ["Invoice", "Customer", "Promised", "By", "Status", "Paid in window", "What they said"], rows
    )


def _invoice_table(portfolio: Portfolio) -> str:
    rows = "".join(
        "<tr>"
        f"<td>{escape(line.invoice.id)}</td>"
        f"<td>{escape(line.customer.name if line.customer else line.invoice.customer_id)}</td>"
        f'<td class="num">{escape(format_minor(line.invoice.amount_minor, portfolio.currency))}</td>'
        f'<td class="num">{escape(format_minor(line.outstanding_minor, portfolio.currency))}</td>'
        f"<td>{escape(line.invoice.due_date.isoformat())}</td>"
        f"<td>{escape(line.next_action)}</td>"
        "</tr>"
        for line in portfolio.invoices
    )
    return _wrap(["Invoice", "Customer", "Value", "Outstanding", "Due", "Next action"], rows)


def _suppression_table(portfolio: Portfolio) -> str:
    if not portfolio.suppressions:
        return ""
    rows = "".join(
        f'<tr><td>{escape(reason.replace("_", " "))}</td><td class="num">{count}</td></tr>'
        for reason, count in portfolio.suppressions
    )
    return "<h2>Why calls were not placed</h2>" + _wrap(["Reason", "Calls avoided"], rows)


def _status_tag(status: PromiseStatus) -> str:
    label = _STATUS_LABEL[status]
    return f'<span class="tag tag-{status.value}">{escape(label)}</span>'


def _wrap(headers: list[str], rows: str) -> str:
    head = "".join(f"<th>{escape(header)}</th>" for header in headers)
    return f'<div class="table-wrap"><table><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table></div>'
