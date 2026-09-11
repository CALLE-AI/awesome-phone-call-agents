"""Dependency-free static HTML case-report viewer.

No server, no auth, no JS framework, no build step -- a single
self-contained HTML file per case (plus an optional index linking many),
matching this project's own "keep it dependency-light" convention
(``webhook.py`` uses stdlib ``http.server``, ``cli.py`` uses stdlib
``argparse``). All interpolated values are HTML-escaped: a fraud case's
account-holder name or claimed-recipient field is untrusted institution
input and must never be treated as markup.
"""

from __future__ import annotations

import html

_DISPOSITION_COLORS = {
    "ADVISE_ALLOW": "#1a7f37",
    "ESCALATE_TO_HUMAN": "#9a6700",
    "ADVISE_BLOCK": "#cf222e",
}
_ADVISORY_NOTICE = (
    "Advisory recommendation only \u2014 requires human review before any action "
    "is taken on this transaction."
)
_DEFAULT_COLOR = "#57606a"


def _e(value: object) -> str:
    return html.escape(str(value), quote=True)


def render_html_report(report: dict) -> str:
    disposition = report["disposition"]["disposition"]
    color = _DISPOSITION_COLORS.get(disposition, _DEFAULT_COLOR)

    qa_items = "".join(
        f"<li><p class='q'>Q: {_e(qa['question'])}</p>"
        f"<p class='a'>A: {_e(qa['answer']) if qa['answer'] is not None else '<em>(no answer recorded)</em>'}</p></li>"
        for qa in report["verification_qa"]
    ) or "<li><em>(no conversation occurred)</em></li>"

    signal_rows = "".join(
        f"<tr><td>{_e(key)}</td><td>{_e(value)}</td></tr>"
        for key, value in report["signals"].items()
    ) or "<tr><td colspan='2'><em>no signal data</em></td></tr>"

    reason_items = "".join(f"<li>{_e(reason)}</li>" for reason in report["disposition"]["reasons"])
    evidence_items = "".join(f"<li>{_e(ev)}</li>" for ev in report["call_outcome"]["evidence"])

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>RingFence case audit -- {_e(report['case_id'])}</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #1f2328; background: #fff; }}
  h1 {{ font-size: 1.25rem; }}
  .badge {{ display: inline-block; padding: 0.2em 0.6em; border-radius: 999px; color: #fff; font-weight: 600; background: {color}; }}
  table {{ border-collapse: collapse; width: 100%; margin: 0.5rem 0; }}
  td {{ border: 1px solid #d0d7de; padding: 0.4em 0.6em; }}
  ul {{ padding-left: 1.2rem; }}
  .q {{ font-weight: 600; margin-bottom: 0.1em; }}
  .a {{ margin-top: 0; color: #57606a; }}
  section {{ margin-bottom: 1.5rem; }}
  .advisory {{ color: #9a6700; font-weight: 600; }}
</style>
</head>
<body>
<h1>RingFence case audit &mdash; {_e(report['case_id'])}</h1>
<p><span class="badge">{_e(disposition)}</span></p>
<p class="advisory">{_e(_ADVISORY_NOTICE)}</p>

<section>
  <h2>Case</h2>
  <table>
    <tr><td>Account holder</td><td>{_e(report['account_holder_name'])}</td></tr>
    <tr><td>Dialed (masked)</td><td>{_e(report['dialed_phone_masked'])}</td></tr>
    <tr><td>Claimed amount</td><td>{_e(report['claimed_transaction_amount'])}</td></tr>
    <tr><td>Claimed recipient</td><td>{_e(report['claimed_recipient'])}</td></tr>
    <tr><td>Payment method</td><td>{_e(report['claimed_payment_method'])}</td></tr>
  </table>
</section>

<section>
  <h2>Call outcome</h2>
  <p>{_e(report['call_outcome']['outcome'])} (confidence: {_e(report['call_outcome']['confidence'])})</p>
  <ul>{evidence_items}</ul>
</section>

<section>
  <h2>Verification Q&amp;A</h2>
  <ul>{qa_items}</ul>
</section>

<section>
  <h2>Extracted signals</h2>
  <table>{signal_rows}</table>
</section>

<section>
  <h2>Recommendation</h2>
  <p><span class="badge">{_e(disposition)}</span></p>
  <p class="advisory">{_e(_ADVISORY_NOTICE)}</p>
  <ul>{reason_items}</ul>
</section>
</body>
</html>
"""


def render_index_html(reports: list[dict]) -> str:
    rows = "".join(
        f"<tr><td><a href='{_e(r['case_id'])}.html'>{_e(r['case_id'])}</a></td>"
        f"<td>{_e(r['account_holder_name'])}</td>"
        f"<td><span class=\"badge\" style=\"background:"
        f"{_DISPOSITION_COLORS.get(r['disposition']['disposition'], _DEFAULT_COLOR)}\">"
        f"{_e(r['disposition']['disposition'])}</span></td></tr>"
        for r in reports
    ) or "<tr><td colspan='3'><em>no cases</em></td></tr>"

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>RingFence case index</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }}
  table {{ border-collapse: collapse; width: 100%; }}
  td {{ border: 1px solid #d0d7de; padding: 0.4em 0.6em; }}
  .badge {{ display: inline-block; padding: 0.2em 0.6em; border-radius: 999px; color: #fff; font-weight: 600; }}
  .advisory {{ color: #9a6700; font-weight: 600; }}
</style>
</head>
<body>
<h1>RingFence case index</h1>
<p class="advisory">Every recommendation below is advisory and requires human
review before any action is taken on the transaction.</p>
<table>
<tr><th>Case</th><th>Account holder</th><th>Recommendation</th></tr>
{rows}
</table>
</body>
</html>
"""
