"""The command line: ``init``, ``check``, ``run``, ``explain``, ``fix``, ``verify``.

The shape of this CLI follows one rule: **the first run must cost nothing,
require nothing, and find something real.** So ``redline run`` needs no
account, no API key and no network, and it exits non-zero when it finds a
problem so that a CI job fails on a security regression.

Live calls are the exception to everything. They are never the default, they
require a budget, an exact-match allowlist and a recipient you own, and they
ask for confirmation **before each individual call** rather than once per
process. A single up-front "yes" that then dials forty times is not consent.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.padding import Padding
from rich.syntax import Syntax
from rich.text import Text

from redline import __version__
from redline.calle.plan import PlanningError, cli_available, plan_call
from redline.config import CONFIG_FILENAME, Config, ConfigError, load_config
from redline.doctor import CheckStatus, run_diagnostics, summarise
from redline.env import find_dotenv, load_dotenv
from redline.evaluate import assertion_names, describe
from redline.evaluate.engine import RunReport
from redline.policy import detect_defences
from redline.receipt import (
    build_run_receipt,
    build_verification_receipt,
    write_receipt,
)
from redline.redact import mask_number, redact
from redline.remediate import generate_patch
from redline.report import (
    print_report,
    print_scenario_detail,
    report_to_dict,
    verification_to_dict,
    write_json,
)
from redline.report.html import write_html
from redline.runner import run_suite
from redline.scenario import Scenario, ScenarioError, load_scenarios
from redline.scope import (
    SCOPE_EXAMPLE_FILENAME,
    SCOPE_FILENAME,
    ScopeError,
    find_scope,
    load_scope,
)
from redline.spend import SpendLedger
from redline.subject import SubjectUnderTest
from redline.templates import write_starter_files
from redline.transport import (
    LiveTransport,
    MockTransport,
    ReplayTransport,
    Transport,
    TransportError,
    persona_script,
)
from redline.verify import verify_patch

app = typer.Typer(
    name="redline",
    help=(
        "Deterministic policy gate for CALL-E phone-agent contracts. "
        "Audit, patch, and verify before anyone is dialled."
    ),
    no_args_is_help=True,
    add_completion=False,
)

console = Console()
error_console = Console(stderr=True)

ConfigOption = Annotated[
    Path,
    typer.Option("--config", "-c", help="Path to redline.yaml."),
]
OnlyOption = Annotated[
    list[str] | None,
    typer.Option("--only", help="Scenario id or family. Repeatable."),
]


def _fail(message: str) -> None:
    error_console.print(Text(message, style="bold red"))
    raise typer.Exit(code=2)


def _load(config_path: Path) -> Config:
    try:
        return load_config(config_path)
    except ConfigError as error:
        _fail(str(error))
        raise  # unreachable; keeps the type checker honest


def _load_scenarios(config: Config, only: list[str] | None) -> list[Scenario]:
    try:
        scenarios = load_scenarios(
            config.scenarios_dir, known_assertions=assertion_names()
        )
    except ScenarioError as error:
        _fail(str(error))
        raise

    selectors = [*(config.only or ()), *(only or [])]
    if selectors:
        wanted = set(selectors)
        scenarios = tuple(
            s for s in scenarios if s.id in wanted or str(s.family) in wanted
        )
        if not scenarios:
            _fail(
                f"no scenario matches {', '.join(sorted(wanted))}. "
                "Run `redline scenarios` to see the catalogue."
            )
    return list(scenarios)


# --- init ---------------------------------------------------------------------


@app.command()
def init(
    directory: Annotated[
        Path, typer.Argument(help="Where to write the starter files.")
    ] = Path(),
    force: Annotated[
        bool, typer.Option("--force", help="Overwrite existing files.")
    ] = False,
) -> None:
    """Write a starter redline.yaml, a scenario, and a CI workflow."""
    written, skipped = write_starter_files(directory, force=force)

    for path in written:
        console.print(Text.assemble(("  created  ", "green"), (str(path), "")))
    for path in skipped:
        console.print(Text.assemble(("  exists   ", "yellow"), (str(path), "dim")))

    if skipped and not force:
        console.print(
            Text("\n  Some files already existed. Pass --force to overwrite.", "dim")
        )

    console.print(
        Text.assemble(
            ("\n  Next: point ", "dim"),
            (f"{CONFIG_FILENAME}", "bold"),
            (" at your CALL-E goal, then run ", "dim"),
            ("redline run", "bold cyan"),
            (".\n", "dim"),
        )
    )


# --- check --------------------------------------------------------------------


@app.command()
def check(config: ConfigOption = Path(CONFIG_FILENAME)) -> None:
    """Validate the config, the catalogue and the result schema. Runs nothing."""
    loaded = _load(config)
    scenarios = _load_scenarios(loaded, None)

    console.print()
    console.print(
        Text.assemble(
            ("  ok  ", "green"),
            (f"config valid  -  subject {redact(loaded.subject.name)!r}", ""),
        )
    )
    console.print(
        Text.assemble(
            ("  ok  ", "green"),
            (f"{len(scenarios)} scenarios loaded from {loaded.scenarios_dir}", ""),
        )
    )

    schema_report = loaded.subject.schema_report()
    if schema_report.errors:
        for issue in schema_report.errors:
            console.print(Text.assemble(("  ERR ", "bold red"), (issue.render(), "")))
    elif loaded.subject.result_schema is not None:
        console.print(
            Text.assemble(("  ok  ", "green"), ("result schema is submittable", ""))
        )
    for issue in schema_report.warnings:
        console.print(Text.assemble(("  warn", "yellow"), (f" {issue.render()}", "")))

    defences = loaded.subject.defences
    console.print(
        Text.assemble(
            ("  ok  ", "green"),
            (
                f"goal states {len(defences)} defence"
                f"{'s' if len(defences) != 1 else ''}",
                "",
            ),
        )
    )
    policy = loaded.subject.data_policy
    if not policy.is_empty:
        console.print(
            Text.assemble(
                ("  ok  ", "green"),
                (
                    f"data policy binds {len(policy.context)} context and "
                    f"{len(policy.results)} result field(s)",
                    "",
                ),
            )
        )
    console.print(
        Text.assemble(
            ("  ok  ", "green"),
            ("no credentials required in this mode", "dim"),
        )
    )
    console.print()

    if schema_report.errors:
        raise typer.Exit(code=1)


# --- doctor -------------------------------------------------------------------


@app.command()
def doctor(
    online: Annotated[
        bool,
        typer.Option(
            "--online",
            help=(
                "Also ask CALL-E whether the key works. Read-only: no call is "
                "placed and no credits are spent."
            ),
        ),
    ] = False,
) -> None:
    """Check your CALL-E credential setup. Places no calls, spends nothing."""
    diagnosis = run_diagnostics(online=online)

    console.print()
    for check in diagnosis.checks:
        console.print(
            Padding(
                Text.assemble(
                    (f"{_MARK[check.status]:5}", _STYLE[check.status]),
                    (f" {check.name:22}", "bold"),
                    (check.detail, ""),
                ),
                (0, 0, 0, 2),
            )
        )
        if check.remedy and check.status is not CheckStatus.OK:
            console.print(Padding(Text(check.remedy, style="dim"), (0, 0, 0, 31)))

    console.print()
    if not online:
        console.print(
            Padding(
                Text(
                    "-> redline doctor --online   "
                    "(asks CALL-E to confirm the key; still places no calls)",
                    style="cyan",
                ),
                (0, 0, 1, 2),
            )
        )

    style = "bold red" if diagnosis.failures else "bold green"
    console.print(Padding(Text(summarise(diagnosis.checks), style=style), (0, 0, 0, 2)))
    console.print(
        Padding(
            Text(
                "No call was placed by this command, and none can be: "
                "`doctor` has no path to the live transport.",
                style="dim",
            ),
            (0, 0, 1, 2),
        )
    )

    raise typer.Exit(code=1 if diagnosis.failures else 0)


_MARK = {
    CheckStatus.OK: "ok",
    CheckStatus.WARN: "warn",
    CheckStatus.FAIL: "FAIL",
}
_STYLE = {
    CheckStatus.OK: "green",
    CheckStatus.WARN: "yellow",
    CheckStatus.FAIL: "bold red",
}


# --- preflight ----------------------------------------------------------------


@app.command()
def preflight(
    config: ConfigOption = Path(CONFIG_FILENAME),
    hardened: Annotated[
        bool,
        typer.Option(
            "--hardened",
            help="Plan the patched goal too, to check the fix is acceptable.",
        ),
    ] = False,
    timeout: Annotated[
        int, typer.Option("--timeout", help="Seconds to wait for a plan.")
    ] = 180,
) -> None:
    """Ask CALL-E what it makes of your goal. Places no call, spends nothing.

    Planning is the only free thing this platform offers that touches the real
    service. It answers two questions nothing else can: whether CALL-E is
    willing to run this goal at all, and what it rewrites the goal into before
    running it.
    """
    loaded = _load(config)
    ledger = SpendLedger(call_budget=0)

    if not cli_available():
        _fail(
            "planning needs the CALL-E CLI. Install Node, then run "
            "`npx -y @call-e/cli auth login`. Everything else in REDLINE works "
            "without it."
        )

    console.print()
    _print_schema_preflight(loaded)

    _plan_and_report(loaded.subject.goal, "your goal", ledger, timeout)

    if hardened:
        scenarios = _load_scenarios(loaded, None)
        report = run_suite(loaded.subject, scenarios, MockTransport())
        patch_result = generate_patch(report, loaded.subject)
        if patch_result.is_empty:
            console.print(
                Padding(
                    Text("Nothing to harden: no fix was needed.", style="dim"),
                    (0, 0, 1, 2),
                )
            )
        else:
            _plan_and_report(
                patch_result.after.goal, "the hardened goal", ledger, timeout
            )

    console.print(
        Padding(
            Text.assemble(
                ("cost  ", "dim"),
                (ledger.summary_line(), "bold green"),
            ),
            (0, 0, 1, 2),
        )
    )


def _print_schema_preflight(config: Config) -> None:
    """Lint the result schema locally, which is free and needs no account."""
    report = config.subject.schema_report()
    if config.subject.result_schema is None:
        return
    if report.is_submittable:
        console.print(
            Padding(
                Text("ok    result schema would be accepted", style="green"),
                (0, 0, 0, 2),
            )
        )
    for issue in report.errors:
        console.print(
            Padding(Text(f"FAIL  {issue.render()}", style="bold red"), (0, 0, 0, 2))
        )
    for issue in report.warnings:
        console.print(
            Padding(Text(f"warn  {issue.render()}", style="yellow"), (0, 0, 0, 2))
        )
    console.print()


def _plan_and_report(goal: str, label: str, ledger: SpendLedger, timeout: int) -> None:
    """Plan one goal and print what CALL-E made of it."""
    try:
        result = plan_call(goal, ledger=ledger, timeout_seconds=timeout)
    except PlanningError as error:
        _fail(str(error))
        return

    if not result.accepted:
        console.print(
            Padding(
                Text.assemble(
                    ("REFUSED  ", "bold red"),
                    (f"CALL-E will not run {label}", "bold"),
                ),
                (0, 0, 0, 2),
            )
        )
        console.print(Padding(Text(redact(result.refusal), style="red"), (0, 0, 1, 4)))
        console.print(
            Padding(
                Text(
                    "This is the content screen, and it refuses in prose with "
                    "no stable error code. Reword the goal and plan again -- "
                    "planning is free.",
                    style="dim",
                ),
                (0, 0, 1, 4),
            )
        )
        return

    console.print(
        Padding(
            Text.assemble(
                ("ACCEPTED  ", "bold green"), (f"CALL-E would run {label}", "bold")
            ),
            (0, 0, 0, 2),
        )
    )

    if result.clarifying_questions:
        console.print(
            Padding(Text("It would first ask you:", style="dim"), (0, 0, 0, 4))
        )
        for question in result.clarifying_questions:
            console.print(
                Padding(Text(f"- {redact(question)}", style="yellow"), (0, 0, 0, 6))
            )

    if not result.was_rewritten:
        console.print()
        return

    _report_rewrite(goal, result.display_goal)


def _report_rewrite(sent: str, rewritten: str) -> None:
    """Compare the goal you wrote with the goal CALL-E will actually run.

    Planning enriches a goal with fallback behaviour, and the plan's
    `display_goal` is the authoritative text. Checking defences on the draft
    instead would be auditing a document nobody executes -- and CALL-E may
    have added a defence you did not write, or dropped one you did.
    """
    before = detect_defences(sent)
    after = detect_defences(rewritten)

    console.print(
        Padding(Text("CALL-E rewrote the goal it will run:", "bold"), (1, 0, 0, 4))
    )
    console.print(Padding(Text(redact(rewritten), style="dim"), (0, 0, 1, 6)))

    added = sorted(d.value.replace("_", " ") for d in after - before)
    lost = sorted(d.value.replace("_", " ") for d in before - after)

    if added:
        console.print(
            Padding(
                Text(f"CALL-E added: {', '.join(added)}", style="green"),
                (0, 0, 0, 4),
            )
        )
    if lost:
        console.print(
            Padding(
                Text.assemble(
                    ("your goal stated, the rewrite does not: ", "bold red"),
                    (", ".join(lost), "red"),
                ),
                (0, 0, 0, 4),
            )
        )
    if not added and not lost:
        console.print(
            Padding(
                Text("The rewrite states the same defences.", style="dim"),
                (0, 0, 0, 4),
            )
        )
    console.print()


# --- run ----------------------------------------------------------------------


@app.command()
def run(
    config: ConfigOption = Path(CONFIG_FILENAME),
    transport: Annotated[
        str, typer.Option("--transport", "-t", help="static or replay.")
    ] = "static",
    live: Annotated[
        bool,
        typer.Option(
            "--live",
            help="Place real calls. Requires --i-am-authorized-to-test-this-target.",
        ),
    ] = False,
    authorised: Annotated[
        bool,
        typer.Option(
            "--i-am-authorized-to-test-this-target",
            help="Attest that you are authorised. Required with --live.",
        ),
    ] = False,
    only: OnlyOption = None,
    budget: Annotated[
        int, typer.Option("--budget", help="Maximum real calls. Live only.")
    ] = 0,
    recipient: Annotated[
        str | None,
        typer.Option("--recipient", help="E.164 number you own. Live only."),
    ] = None,
    json_out: Annotated[
        Path | None, typer.Option("--json", help="Write a JSON report here.")
    ] = None,
    html_out: Annotated[
        Path | None, typer.Option("--html", help="Write an HTML report here.")
    ] = None,
    receipt_out: Annotated[
        Path | None,
        typer.Option(
            "--receipt",
            help="Write a content-addressed, transcript-free release receipt.",
        ),
    ] = None,
    verbose: Annotated[
        bool, typer.Option("--verbose", "-v", help="Print transcripts inline.")
    ] = False,
) -> None:
    """Run the catalogue against your agent and report what it let through."""
    loaded = _load(config)
    scenarios = _load_scenarios(loaded, only)
    carrier = _build_transport(
        transport,
        loaded,
        budget=budget,
        recipient=recipient,
        live=live,
        authorised=authorised,
    )

    try:
        report = run_suite(loaded.subject, scenarios, carrier)
    except TransportError as error:
        _fail(str(error))
        raise

    print_report(report, console, verbose=verbose)
    _write_outputs(report, loaded, json_out, html_out)
    if receipt_out is not None:
        receipt = build_run_receipt(loaded.subject, scenarios, report)
        console.print(
            Text(f"  receipt: {write_receipt(receipt, receipt_out)}\n", style="dim")
        )

    raise typer.Exit(code=report.exit_code)


# --- script -------------------------------------------------------------------


@app.command()
def script(
    only: OnlyOption = None,
    config: ConfigOption = Path(CONFIG_FILENAME),
    out: Annotated[
        Path | None,
        typer.Option("--out", help="Write one file per scenario into this directory."),
    ] = None,
) -> None:
    """Print the persona script an operator reads aloud during a live call.

    A live run needs a person on the line: CALL-E has no inbound developer API,
    so an agent-answers-agent loopback is not available and the adversary is
    whoever is holding the handset. This is what they read.

    Generated from the catalogue rather than written by hand, so the page in
    somebody's hand cannot drift from the scenario the bench is running. If a
    turn changes in the YAML, the script changes with it.

    Places no calls and needs no credentials.
    """
    loaded = _load(config)
    scenarios = _load_scenarios(loaded, only)

    if out is None:
        for scenario in scenarios:
            console.print()
            console.print(persona_script(scenario), highlight=False)
        console.print()
        return

    out.mkdir(parents=True, exist_ok=True)
    console.print()
    for scenario in scenarios:
        destination = out / f"{scenario.id}.txt"
        # newline="" so the file carries LF on Windows too, and plain text
        # rather than Markdown: this gets printed, not rendered.
        with destination.open("w", encoding="utf-8", newline="") as handle:
            handle.write(persona_script(scenario) + "\n")
        console.print(Text(f"  wrote  {destination}", style="dim"))
    console.print()
    console.print(
        Text(
            f"  {len(scenarios)} script(s). Print them, or keep them open on a "
            "second screen.",
            style="dim",
        )
    )
    console.print()


# --- explain ------------------------------------------------------------------


@app.command()
def explain(
    scenario_id: Annotated[str, typer.Argument(help="Scenario id to explain.")],
    config: ConfigOption = Path(CONFIG_FILENAME),
) -> None:
    """Show one scenario in full: why it exists, what happened, what failed."""
    loaded = _load(config)
    scenarios = _load_scenarios(loaded, [scenario_id])
    report = run_suite(loaded.subject, scenarios, MockTransport())

    result = report.find(scenario_id)
    if result is None:
        _fail(f"scenario {scenario_id!r} did not run")
        raise

    print_scenario_detail(result, console)


# --- fix ----------------------------------------------------------------------


@app.command()
def fix(
    config: ConfigOption = Path(CONFIG_FILENAME),
    only: OnlyOption = None,
    apply: Annotated[
        bool,
        typer.Option(
            "--apply", help=f"Write the hardened goal into {CONFIG_FILENAME}."
        ),
    ] = False,
) -> None:
    """Propose a hardened goal and schema for what the last run found."""
    loaded = _load(config)
    scenarios = _load_scenarios(loaded, only)
    report = run_suite(loaded.subject, scenarios, MockTransport())
    patch = generate_patch(report, loaded.subject)

    if patch.is_empty:
        console.print(
            Text(
                "\n  Nothing to fix: the goal already states every defence "
                "this catalogue probes.\n",
                style="green",
            )
        )
        return

    console.print()
    for remedy in patch.remedies:
        console.print(
            Text.assemble(
                (f"  {remedy.kind}  ", "cyan"),
                (remedy.summary, "bold"),
            )
        )
        console.print(Text(f"        {remedy.rationale}", style="dim"))
        if remedy.closes:
            console.print(
                Text(f"        closes: {', '.join(remedy.closes)}", style="dim")
            )
        console.print()

    console.print(Text("  Proposed goal change:", style="bold"))
    console.print(Syntax(patch.goal_diff(), "diff", theme="ansi_dark"))

    if patch.schema_changed:
        console.print(Text("\n  Proposed result_schema:", style="bold"))
        import json as _json

        console.print(
            Syntax(
                _json.dumps(patch.after.result_schema, indent=2),
                "json",
                theme="ansi_dark",
            )
        )

    if apply:
        backup = _apply_patch_to_config(loaded, patch.after)
        console.print(Text(f"\n  Written to {loaded.source_path}.", style="green"))
        console.print(
            Text(
                "  Comments and blank lines were not preserved; the "
                f"original is at {backup.name}.",
                style="dim",
            )
        )
        console.print(
            Text(
                "  Run `redline verify` to check the patched contract.\n",
                style="cyan",
            )
        )
    else:
        console.print(
            Text(
                "\n  -> redline fix --apply    (write this into the config)\n"
                "  -> redline verify         (apply, re-run, and diff)\n",
                style="cyan",
            )
        )


# --- verify -------------------------------------------------------------------


@app.command()
def verify(
    config: ConfigOption = Path(CONFIG_FILENAME),
    only: OnlyOption = None,
    json_out: Annotated[
        Path | None, typer.Option("--json", help="Write the before/after as JSON.")
    ] = None,
    receipt_out: Annotated[
        Path | None,
        typer.Option(
            "--receipt",
            help="Write a content-addressed, transcript-free release receipt.",
        ),
    ] = None,
) -> None:
    """Generate the fix, replay every attack against it, and report the diff."""
    loaded = _load(config)
    scenarios = _load_scenarios(loaded, only)
    transport = MockTransport()

    before = run_suite(loaded.subject, scenarios, transport)
    patch = generate_patch(before, loaded.subject)

    if patch.is_empty:
        if receipt_out is not None:
            receipt = build_run_receipt(loaded.subject, scenarios, before)
            console.print(
                Text(
                    f"  receipt: {write_receipt(receipt, receipt_out)}\n",
                    style="dim",
                )
            )
        console.print(
            Text("\n  Nothing to verify: no fix was needed.\n", style="green")
        )
        raise typer.Exit(code=before.exit_code)

    benign = _load_benign(loaded)
    verification = verify_patch(
        patch, scenarios, transport, before=before, benign=benign
    )

    console.print()
    console.print(
        Text.assemble(
            ("  before  ", "dim"),
            (before.summary_line(), "red" if before.failed else ""),
        )
    )
    console.print(
        Text.assemble(
            ("  after   ", "dim"),
            (
                verification.after.summary_line(),
                "green" if not verification.after.failed else "yellow",
            ),
        )
    )
    console.print()

    for scenario_id in verification.closed:
        console.print(Text(f"  CLOSED      {scenario_id}", style="green"))
    for scenario_id in verification.still_failing:
        console.print(Text(f"  STILL OPEN  {scenario_id}", style="yellow"))
    for scenario_id in verification.regressions:
        console.print(Text(f"  REGRESSED   {scenario_id}", style="bold red"))

    if verification.benign_total:
        console.print()
        kept = verification.benign_total - len(verification.benign_regressions)
        console.print(
            Text.assemble(
                ("  benign      ", "dim"),
                (
                    f"{kept}/{verification.benign_total} ordinary calls still handled",
                    "green" if not verification.benign_regressions else "yellow",
                ),
            )
        )
        for scenario_id in verification.benign_regressions:
            console.print(Text(f"  BROKE       {scenario_id}", style="bold red"))
        for scenario_id in verification.benign_repaired:
            console.print(Text(f"  REPAIRED    {scenario_id}", style="green"))

    console.print()
    # Three different things, deliberately not printed as one. An attack that
    # used to be caught and now is not is a defect in the patch. An ordinary
    # call the patch costs is a trade for the owner of the agent to make. And
    # neither of them is "not applied" -- `verify` applies nothing, ever; it
    # runs the fix against the catalogue and reports what it found.
    if verification.regressions:
        console.print(
            Text(
                "  The patch stopped catching an attack it used to catch. "
                "That is a defect in the fix, not a trade.",
                style="bold red",
            )
        )
    elif verification.benign_regressions:
        broken = len(verification.benign_regressions)
        console.print(
            Text(
                f"  Every attack closed. {broken} of "
                f"{verification.benign_total} ordinary calls stopped working.",
                style="bold yellow",
            )
        )
        console.print(
            Text(
                "  That is the price of this fix. Decide before applying it.",
                style="yellow",
            )
        )
    elif verification.fully_closed:
        console.print(
            Text("  Every attack in this run is now closed.", style="bold green")
        )
    console.print()

    if json_out is not None:
        written = write_json(verification_to_dict(verification), json_out)
        console.print(Text(f"  report: {written}\n", style="dim"))

    if receipt_out is not None:
        receipt = build_verification_receipt(verification, scenarios)
        console.print(
            Text(f"  receipt: {write_receipt(receipt, receipt_out)}\n", style="dim")
        )

    raise typer.Exit(code=0 if verification.is_clean else 1)


def _load_benign(config: Config) -> list[Scenario]:
    """Load the legitimate-call suite, if the project has one.

    Absent is a legitimate state and is not an error: the report then says the
    price of hardening was not measured, rather than reporting zero. A zero
    nobody measured is worse than no number at all.
    """
    if not config.benign_dir.exists():
        return []
    try:
        return list(
            load_scenarios(config.benign_dir, known_assertions=assertion_names())
        )
    except ScenarioError as error:
        _fail(str(error))
        raise


# --- catalogue introspection --------------------------------------------------


@app.command()
def scenarios(config: ConfigOption = Path(CONFIG_FILENAME)) -> None:
    """List the scenario catalogue."""
    loaded = _load(config)
    catalogue = _load_scenarios(loaded, None)

    console.print()
    for scenario in catalogue:
        console.print(
            Text.assemble(
                (f"  {scenario.severity.value:9}", "dim"),
                (f"{scenario.id:34}", "bold"),
                (str(scenario.family), "dim"),
            )
        )
        console.print(Text(f"            {scenario.title}", style="dim"))
    console.print(Text(f"\n  {len(catalogue)} scenarios\n", style="dim"))


@app.command()
def assertions() -> None:
    """List the checks a scenario can make."""
    console.print()
    for name in sorted(assertion_names()):
        console.print(Text.assemble((f"  {name:30}", "bold"), (describe(name), "dim")))
    console.print()


@app.command()
def version() -> None:
    """Print the version."""
    console.print(f"redline {__version__}")


# --- helpers ------------------------------------------------------------------


def _build_transport(
    name: str,
    config: Config,
    *,
    budget: int,
    recipient: str | None,
    live: bool = False,
    authorised: bool = False,
) -> Transport:
    """Pick a transport, and make the wet one expensive to reach by accident.

    Everything about this function is arranged around one asymmetry: choosing
    the static model costs nothing and choosing live rings a stranger's
    phone and spends credits. So the offline path is the default and the
    fallthrough, and the online path is guarded by four separate deliberate
    acts -- a flag, an attestation nobody types by accident, a signed scope
    file, and a confirmation per call.
    """
    if live:
        return _build_live_transport(
            config, budget=budget, recipient=recipient, authorised=authorised
        )
    if name in {"static", "mock"}:
        return MockTransport()
    if name == "replay":
        return ReplayTransport(config.fixtures_dir)
    if name == "live":
        # Refused rather than honoured. `--transport live` is one character
        # away from `--transport replay` in a shell history, and the two differ
        # by a phone call.
        _fail(
            "--transport live no longer exists. Real calls need --live and "
            "--i-am-authorized-to-test-this-target, and a "
            f"{SCOPE_FILENAME} that names who authorised the test."
        )
        raise

    _fail(f"unknown transport {name!r}; use static or replay, or --live")
    raise  # unreachable


def _build_live_transport(
    config: Config,
    *,
    budget: int,
    recipient: str | None,
    authorised: bool,
) -> Transport:
    if not authorised:
        _fail(
            "--live also needs --i-am-authorized-to-test-this-target.\n"
            "  It is long on purpose: it is an assertion about the world, not "
            "a preference.\n"
            "  Passing it says you have permission to make these phones ring, "
            "from whoever\n"
            "  owns them, and that the permission has not run out."
        )
        raise
    if recipient is None:
        _fail("--live needs --recipient, an E.164 number listed in your scope file.")
        raise

    start = config.source_path or Path.cwd()
    scope_path = find_scope(start)
    if scope_path is None:
        _fail(
            f"no {SCOPE_FILENAME} found. Copy {SCOPE_EXAMPLE_FILENAME} beside "
            "your config and fill it in.\n"
            "  REDLINE will not dial a number nobody has signed for."
        )
        raise
    try:
        scope = load_scope(scope_path)
    except ScopeError as error:
        _fail(str(error))
        raise

    target = scope.target_for(recipient)
    if target is None:
        _fail(
            f"{mask_number(recipient)} is not in {scope_path.name}. Matching is "
            "exact: add the full number, with an owner."
        )
        raise

    console.print()
    console.print(
        Text.assemble(
            ("  scope     ", "dim"),
            (f"{scope_path.name}, authorised by {scope.authorised_by}", ""),
        )
    )
    console.print(
        Text.assemble(
            ("  target    ", "dim"),
            (f"{target.masked} -- {target.owner}", ""),
        )
    )
    console.print(
        Text.assemble(
            ("  expires   ", "dim"),
            (scope.expires.isoformat(), ""),
        )
    )
    console.print()

    # Only here. The offline transports must not even read a credential file,
    # so that "static needs nothing" stays literally true.
    load_dotenv(find_dotenv(start))
    try:
        return LiveTransport(
            recipient=recipient,
            budget=budget,
            allowlist=scope.numbers,
            on_script=_confirm_each_call,
        )
    except TransportError as error:
        _fail(str(error))
        raise


def _confirm_each_call(scenario: Scenario, script: str) -> None:
    """Ask before every single call.

    Per call, not per process. A one-off "yes" at startup that then dials forty
    numbers is not consent, and the operator needs to see which persona they
    are about to play before the phone rings.
    """
    console.print()
    console.print(Text(script, style="bold"))
    console.print()
    if not typer.confirm(
        f"Place a real call for scenario {scenario.id!r}?", default=False
    ):
        raise TransportError("cancelled by the operator")


def _write_outputs(
    report: RunReport,
    config: Config,
    json_out: Path | None,
    html_out: Path | None,
) -> None:
    payload = report_to_dict(report)
    if json_out is not None:
        console.print(Text(f"  report: {write_json(payload, json_out)}", style="dim"))
    if html_out is not None:
        console.print(Text(f"  report: {write_html(report, html_out)}", style="dim"))
    if json_out is not None or html_out is not None:
        console.print()


def _apply_patch_to_config(config: Config, patched: SubjectUnderTest) -> Path:
    """Rewrite the goal and schema in the config, and back up what was there.

    This re-serialises the parsed document, which **drops comments and blank
    lines**. Preserving them would mean a round-trip YAML library and another
    dependency for a command most people run once. So rather than pretend
    otherwise, it writes a `.bak` beside the file and says so -- the change
    stays reversible with a single `mv`, which is the property that matters.
    """
    if config.source_path is None:  # pragma: no cover - always set by load_config
        _fail("cannot apply a patch without a config file on disk")
        raise RuntimeError("unreachable")

    import yaml

    source = config.source_path
    backup = source.with_suffix(source.suffix + ".bak")
    backup.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")

    document = yaml.safe_load(source.read_text(encoding="utf-8"))
    document["subject"]["goal"] = patched.goal
    if patched.result_schema is not None and isinstance(
        document["subject"].get("result_schema"), dict
    ):
        document["subject"]["result_schema"] = dict(patched.result_schema)

    source.write_text(
        yaml.safe_dump(document, sort_keys=False, allow_unicode=True, width=88),
        encoding="utf-8",
    )
    return backup


def main() -> None:  # pragma: no cover - console entry point
    try:
        app()
    except KeyboardInterrupt:
        error_console.print("\ninterrupted")
        sys.exit(130)


if __name__ == "__main__":  # pragma: no cover
    main()
