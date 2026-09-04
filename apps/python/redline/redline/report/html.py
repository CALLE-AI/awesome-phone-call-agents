"""Write a self-contained HTML report.

One file, no network, no CDN, no build step. It has to open from a checkout on
a machine that has never heard of this project -- which is exactly the position
a reviewer or a judge is in.

Everything is escaped and redacted. A report is the easiest artefact in the
world to attach to an issue, so it must be safe to attach: no unmasked number,
and no transcript text that could close a tag and inject markup.
"""

from __future__ import annotations

import html
from pathlib import Path

from redline.evaluate.assertions import Status
from redline.evaluate.engine import RunReport, ScenarioResult
from redline.redact import redact

__all__ = ["render_html", "write_html"]


STYLES = """
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted: #6b6b6b;
  --line: #e3e3e3;
  --card: #fafafa;
  --fail: #c0272d;
  --pass: #14794a;
  --warn: #9a6700;
  --accent: #c0272d;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #131316; --fg: #ececec; --muted: #9a9a9a; --line: #2a2a30;
    --card: #1a1a1f; --fail: #ff6b6b; --pass: #4ade80; --warn: #fbbf24;
    --accent: #ff6b6b;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2.5rem 1.5rem; background: var(--bg); color: var(--fg);
  font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
}
main { max-width: 60rem; margin: 0 auto; }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
h1 span { color: var(--accent); }
h2 { font-size: 1.05rem; margin: 2.5rem 0 .75rem; }
.meta { color: var(--muted); font-size: .875rem; margin-bottom: 2rem; }
.note {
  border-left: 3px solid var(--line); padding: .5rem 0 .5rem 1rem;
  color: var(--muted); font-size: .875rem; margin: 1.5rem 0;
}
.summary { display: flex; gap: 2.5rem; flex-wrap: wrap; margin: 1.5rem 0 0; }
.stat strong { display: block; font-size: 2rem; line-height: 1.1; }
.stat span { color: var(--muted); font-size: .8rem; text-transform: uppercase;
  letter-spacing: .06em; }
.stat.fail strong { color: var(--fail); }
.stat.pass strong { color: var(--pass); }
table { width: 100%; border-collapse: collapse; font-size: .9rem; }
th, td { text-align: left; padding: .5rem .75rem;
  border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 600; font-size: .78rem;
  text-transform: uppercase; letter-spacing: .05em; }
.scenario {
  border: 1px solid var(--line); border-radius: 8px; padding: 1.25rem;
  margin: 1rem 0; background: var(--card);
}
.scenario.failed { border-left: 3px solid var(--fail); }
.scenario h3 { margin: 0 0 .25rem; font-size: 1rem; font-family: ui-monospace,
  "SF Mono", Menlo, monospace; }
.badge {
  display: inline-block; padding: .1rem .5rem; border-radius: 4px;
  font-size: .7rem; font-weight: 700; letter-spacing: .05em;
  text-transform: uppercase; vertical-align: middle; margin-left: .5rem;
}
.badge.critical { background: var(--fail); color: #fff; }
.badge.high { background: var(--warn); color: #fff; }
.badge.medium, .badge.low { background: var(--line); color: var(--muted); }
.title { color: var(--muted); font-size: .9rem; margin-bottom: 1rem; }
.check { display: flex; gap: .75rem; padding: .35rem 0; font-size: .9rem; }
.check .mark { font-weight: 700; min-width: 3.2rem; font-family: ui-monospace,
  Menlo, monospace; font-size: .78rem; padding-top: .15rem; }
.check.fail .mark { color: var(--fail); }
.check.pass .mark { color: var(--pass); }
.check.skip { color: var(--muted); }
.because { color: var(--muted); font-style: italic; font-size: .84rem;
  margin: .1rem 0 .4rem 3.95rem; }
.transcript { margin-top: 1rem; font-family: ui-monospace, "SF Mono", Menlo,
  monospace; font-size: .82rem; }
.turn { display: flex; gap: .75rem; padding: .2rem .5rem; border-radius: 4px; }
.turn .who { color: var(--muted); min-width: 4rem; }
.turn.flagged { background: color-mix(in srgb, var(--fail) 12%, transparent);
  color: var(--fail); }
.turn.flagged .who { color: var(--fail); }
.gaps { list-style: none; padding: 0; }
.gaps li { padding: .3rem 0; color: var(--warn); }
footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--line);
  color: var(--muted); font-size: .8rem; }
code { font-family: ui-monospace, Menlo, monospace; font-size: .9em; }
"""


def render_html(report: RunReport) -> str:
    """Render the whole report as one HTML document."""
    parts = [
        "<!doctype html>",
        '<html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        f"<title>REDLINE - {_esc(report.subject_name)}</title>",
        f"<style>{STYLES}</style>",
        "</head><body><main>",
        f"<h1><span>REDLINE</span> {_esc(report.subject_name)}</h1>",
        f'<p class="meta">transport <code>{_esc(report.transport)}</code> '
        f"&middot; {report.total} scenarios &middot; "
        f"{report.real_calls_placed} real calls &middot; "
        f"{report.duration_seconds:.1f}s</p>",
        _summary(report),
        _provenance_note(report),
        _family_table(report),
        _defence_gaps(report),
        "<h2>Scenarios</h2>",
    ]

    ordered = [*report.failures, *(r for r in report.results if not r.failed)]
    parts.extend(_scenario(result) for result in ordered)

    parts.extend(
        [
            "<footer>Generated by REDLINE. Phone numbers and credentials are "
            "masked in this report. A static run states what a goal defends "
            "against, not what a live agent did.</footer>",
            "</main></body></html>",
        ]
    )
    return "\n".join(parts)


def _summary(report: RunReport) -> str:
    return (
        '<div class="summary">'
        f'<div class="stat pass"><strong>{report.passed}</strong>'
        "<span>passed</span></div>"
        f'<div class="stat fail"><strong>{report.failed}</strong>'
        "<span>failed</span></div>"
        f'<div class="stat fail"><strong>{len(report.critical_failures)}</strong>'
        "<span>critical</span></div>"
        f'<div class="stat"><strong>{report.real_calls_placed}</strong>'
        "<span>real calls</span></div>"
        "</div>"
    )


def _provenance_note(report: RunReport) -> str:
    """State what kind of claim this report is making.

    Not decoration. "Declared by a static model" and "observed on a live call"
    are different claims, and a reader who cannot tell them apart will
    reasonably distrust both.
    """
    if report.transport == "static":
        body = (
            "This static run placed no calls. It reports which defences the goal "
            "<em>states</em>, treating an undefended goal as vulnerable. Run "
            "<code>--live</code> to measure what the agent actually "
            "does."
        )
    elif report.transport == "replay":
        body = (
            "This run replayed recorded CALL-E payloads. Ground truth was "
            "attested by an operator at recording time, not measured."
        )
    else:
        body = (
            "This run placed real calls. Ground truth is what the operator "
            "declared they played down the line."
        )
    return f'<p class="note">{body}</p>'


def _family_table(report: RunReport) -> str:
    rows = []
    for family, results in sorted(report.by_family().items()):
        passed = sum(1 for r in results if r.status is Status.PASS)
        failed = sum(1 for r in results if r.failed)
        rows.append(
            f"<tr><td><code>{_esc(family)}</code></td>"
            f"<td>{passed}/{len(results)}</td>"
            f"<td>{f'{failed} failing' if failed else '-'}</td></tr>"
        )
    return (
        "<h2>By family</h2><table><thead><tr><th>Family</th><th>Passed</th>"
        f"<th>Failing</th></tr></thead><tbody>{''.join(rows)}</tbody></table>"
    )


def _defence_gaps(report: RunReport) -> str:
    if not report.missing_defences:
        return ""
    items = "".join(
        f"<li>{_esc(defence.value.replace('_', ' '))}</li>"
        for defence in sorted(report.missing_defences, key=lambda d: d.value)
    )
    return (
        "<h2>What the goal does not say</h2>"
        f'<ul class="gaps">{items}</ul>'
        '<p class="note">Run <code>redline fix</code> for wording that states '
        "these, and <code>redline verify</code> to replay the attacks against "
        "it.</p>"
    )


def _scenario(result: ScenarioResult) -> str:
    scenario = result.scenario
    severity = scenario.severity.value
    classes = "scenario failed" if result.failed else "scenario"

    checks = "".join(
        (
            f'<div class="check {outcome.status}">'
            f'<span class="mark">{_MARK[outcome.status]}</span>'
            f"<span><code>{_esc(outcome.name)}</code> "
            f"{_esc(redact(outcome.detail))}</span></div>"
        )
        + (
            f'<div class="because">{_esc(redact(outcome.because))}</div>'
            if outcome.failed and outcome.because
            else ""
        )
        for outcome in result.outcomes
    )

    return (
        f'<section class="{classes}">'
        f"<h3>{_esc(scenario.id)}"
        f'<span class="badge {severity}">{_esc(severity)}</span></h3>'
        f'<p class="title">{_esc(redact(scenario.title))}</p>'
        f"{checks}"
        f"{_transcript(result)}"
        "</section>"
    )


def _transcript(result: ScenarioResult) -> str:
    if not result.record.transcript:
        return ""
    flagged = set(result.highlighted_turns)
    turns = "".join(
        f'<div class="turn{" flagged" if turn.index in flagged else ""}">'
        f'<span class="who">{_esc(str(turn.speaker))}</span>'
        f"<span>{_esc(redact(turn.text))}</span></div>"
        for turn in result.record.transcript
    )
    return f'<div class="transcript">{turns}</div>'


_MARK = {Status.PASS: "PASS", Status.FAIL: "FAIL", Status.SKIP: "skip"}


def _esc(value: str) -> str:
    return html.escape(str(value), quote=True)


def write_html(report: RunReport, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    # newline="" so the report carries LF on Windows too: these files get
    # committed and attached to pull requests, and a CRLF file fails the
    # CALL-E repository's frontmatter check for a reason nobody can see.
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(render_html(report))
    return path
