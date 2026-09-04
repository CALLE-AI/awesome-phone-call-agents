"""Print a run the way a person reads one.

Design rules, in the order they matter:

1. **Failures first, most severe first.** Nobody scrolls a passing suite.
2. **Group by family.** Five judgements ("weak on false completion") beat
   fifteen line items, because a family is something you can go and fix.
3. **Say what to do next.** Every report ends with a command to run, not with a
   count. A count is a feeling; a command is a next step.
4. **Never print an unmasked number.** Everything goes through
   :mod:`redline.redact`, including anything echoed from a transcript.

The transport is stated on the header line and never buried, because "no calls
were placed" changes what the numbers mean.
"""

from __future__ import annotations

from collections.abc import Sequence

from rich.console import Console
from rich.padding import Padding
from rich.table import Table
from rich.text import Text

from redline.evaluate.assertions import Status
from redline.evaluate.engine import RunReport, ScenarioResult
from redline.policy import Defence
from redline.redact import redact
from redline.types import Severity

__all__ = ["print_report", "print_scenario_detail"]

STATUS_STYLE = {
    Status.PASS: "green",
    Status.FAIL: "red",
    Status.SKIP: "dim",
}

SEVERITY_STYLE = {
    Severity.CRITICAL: "bold red",
    Severity.HIGH: "red",
    Severity.MEDIUM: "yellow",
    Severity.LOW: "dim",
}

MARK = {Status.PASS: "PASS", Status.FAIL: "FAIL", Status.SKIP: "skip"}


def print_report(
    report: RunReport, console: Console | None = None, *, verbose: bool = False
) -> None:
    """Print the whole run."""
    console = console or Console()

    _print_header(report, console)
    _print_families(report, console)

    if report.failures:
        _print_failures(report.failures, console, verbose=verbose)

    _print_defence_gaps(report, console)
    _print_footer(report, console)


def _print_header(report: RunReport, console: Console) -> None:
    console.print()
    console.print(
        Text.assemble(
            ("REDLINE", "bold red"),
            ("  ", ""),
            (redact(report.subject_name), "bold"),
        )
    )

    calls = (
        f"{report.real_calls_placed} real call"
        f"{'s' if report.real_calls_placed != 1 else ''}"
    )
    console.print(
        Text(
            f"transport {report.transport}  -  {report.total} scenarios  -  "
            f"{calls}  -  {report.duration_seconds:.1f}s",
            style="dim",
        )
    )
    console.print()


def _print_families(report: RunReport, console: Console) -> None:
    table = Table.grid(padding=(0, 2))
    table.add_column(style="bold", width=18)
    table.add_column(width=12)
    table.add_column(width=7, justify="right")
    table.add_column()

    for family, results in sorted(report.by_family().items()):
        passed = sum(1 for r in results if r.status is Status.PASS)
        failed = [r for r in results if r.failed]

        table.add_row(
            family,
            _bar(passed, len(results)),
            f"{passed}/{len(results)}",
            _worst_severity_label(failed),
        )
    console.print(Padding(table, (0, 0, 1, 2)))


def _bar(passed: int, total: int, width: int = 10) -> Text:
    if total == 0:
        return Text("")
    filled = round(width * passed / total)
    style = "green" if passed == total else ("yellow" if passed else "red")
    return Text("#" * filled + "." * (width - filled), style=style)


def _worst_severity_label(failed: Sequence[ScenarioResult]) -> Text:
    if not failed:
        return Text("")
    worst = min((r.severity for r in failed), key=lambda s: s.rank)
    return Text(
        f"{len(failed)} failing, worst {worst.value}", style=SEVERITY_STYLE[worst]
    )


def _print_failures(
    failures: Sequence[ScenarioResult],
    console: Console,
    *,
    verbose: bool,
) -> None:
    for result in failures:
        console.print(
            Padding(
                Text.assemble(
                    ("FAIL  ", "bold red"),
                    (result.scenario.id, "bold"),
                    ("   ", ""),
                    (
                        result.scenario.severity.value.upper(),
                        SEVERITY_STYLE[result.scenario.severity],
                    ),
                ),
                (0, 0, 0, 2),
            )
        )
        console.print(
            Padding(Text(redact(result.scenario.title), style="dim"), (0, 0, 0, 8))
        )

        for outcome in result.failures:
            console.print(
                Padding(
                    Text.assemble(
                        (f"{outcome.name}  ", "red"),
                        (redact(outcome.detail), ""),
                    ),
                    (0, 0, 0, 8),
                )
            )
            if outcome.because:
                console.print(
                    Padding(
                        Text(redact(outcome.because), style="dim italic"),
                        (0, 0, 0, 10),
                    )
                )
        if verbose:
            _print_transcript(result, console, indent=8)
        console.print()


def _print_defence_gaps(report: RunReport, console: Console) -> None:
    missing = report.missing_defences
    if not missing:
        return
    console.print(
        Padding(Text("The goal does not state:", style="bold yellow"), (0, 0, 0, 2))
    )
    for defence in sorted(missing, key=lambda d: d.value):
        console.print(
            Padding(Text(f"- {_defence_label(defence)}", style="yellow"), (0, 0, 0, 4))
        )
    console.print()


def _defence_label(defence: Defence) -> str:
    return defence.value.replace("_", " ")


def _print_footer(report: RunReport, console: Console) -> None:
    style = "bold red" if report.failed else "bold green"
    console.print(Padding(Text(report.summary_line(), style=style), (0, 0, 1, 2)))

    if report.failures:
        first = report.failures[0].scenario.id
        console.print(
            Padding(Text(f"-> redline explain {first}", style="cyan"), (0, 0, 0, 2))
        )
        console.print(
            Padding(
                Text("-> redline fix    (propose a patch for these)", style="cyan"),
                (0, 0, 1, 2),
            )
        )


def print_scenario_detail(
    result: ScenarioResult, console: Console | None = None
) -> None:
    """Print one scenario in full: why it exists, what happened, what failed."""
    console = console or Console()
    scenario = result.scenario

    console.print()
    console.print(
        Text.assemble(
            ("SCENARIO  ", "bold"),
            (scenario.id, "bold"),
            ("   ", ""),
            (f"family: {scenario.family}", "dim"),
            ("   ", ""),
            (
                f"severity: {scenario.severity}",
                SEVERITY_STYLE[scenario.severity],
            ),
        )
    )
    console.print(Padding(Text(redact(scenario.title)), (0, 0, 1, 10)))

    if scenario.rationale:
        console.print(Padding(Text("WHY", style="bold"), (0, 0, 0, 0)))
        console.print(
            Padding(Text(redact(scenario.rationale), style="dim"), (0, 0, 1, 10))
        )

    console.print(Text("TRANSCRIPT", style="bold"))
    _print_transcript(result, console, indent=4)
    console.print()

    console.print(Text("CHECKS", style="bold"))
    for outcome in result.outcomes:
        console.print(
            Padding(
                Text.assemble(
                    (f"{MARK[outcome.status]:5}", STATUS_STYLE[outcome.status]),
                    (f" {outcome.name}  ", ""),
                    (redact(outcome.detail), "dim"),
                ),
                (0, 0, 0, 4),
            )
        )
        if outcome.failed and outcome.because:
            console.print(
                Padding(
                    Text(redact(outcome.because), style="dim italic"), (0, 0, 0, 14)
                )
            )
    console.print()

    if result.missing_defences:
        console.print(Text("FIX", style="bold"))
        for defence in sorted(result.missing_defences, key=lambda d: d.value):
            console.print(
                Padding(
                    Text(
                        f"the goal states no {_defence_label(defence)} rule",
                        style="yellow",
                    ),
                    (0, 0, 0, 4),
                )
            )
        console.print(
            Padding(
                Text("-> redline fix   (writes the wording for you)", style="cyan"),
                (1, 0, 1, 4),
            )
        )


def _print_transcript(result: ScenarioResult, console: Console, *, indent: int) -> None:
    highlighted = set(result.highlighted_turns)
    if not result.record.transcript:
        console.print(Padding(Text("(no transcript)", style="dim"), (0, 0, 0, indent)))
        return

    for turn in result.record.transcript:
        marker = ">" if turn.index in highlighted else " "
        style = "red" if turn.index in highlighted else ""
        console.print(
            Padding(
                Text.assemble(
                    (f"{marker} ", "bold red" if style else "dim"),
                    (f"{turn.speaker:<7}", "dim"),
                    ("  ", ""),
                    (redact(turn.text), style),
                ),
                (0, 0, 0, indent),
            )
        )
