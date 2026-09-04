"""Command line entry point for call-rehearsal.

Exit codes follow the convention used elsewhere in this repository:

``0``
    Nothing at or above the failure threshold. The plan may go out.
``20``
    The plan should not go out as written.
``30``
    The plan could not be read, so nothing was rehearsed.

This tool places no calls, reads no credentials and opens no network
connection. Rehearsing is always safe to run in CI.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import analysis
from .plan import PlanError, load_plan, suggest_decision_fields

_SEVERITY_LABEL = {
    analysis.CRITICAL: "CRITICAL",
    analysis.HIGH: "HIGH",
    analysis.MEDIUM: "MEDIUM",
    analysis.LOW: "LOW",
}

EXIT_OK = 0
EXIT_BLOCKED = 20
EXIT_INPUT_ERROR = 30


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="call-rehearsal",
        description=(
            "Rehearse a CALL-E call plan against every realistic ending of the call "
            "and report what the automation would do. Places no calls."
        ),
    )
    parser.add_argument("plan", type=Path, help="Path to a call plan JSON file.")
    parser.add_argument(
        "--json",
        dest="as_json",
        action="store_true",
        help="Emit the machine-readable report instead of the readable one.",
    )
    parser.add_argument(
        "--fail-on",
        choices=analysis.SEVERITY_ORDER,
        default=analysis.HIGH,
        help="Lowest severity that should fail the run. Default: high.",
    )
    parser.add_argument(
        "--suggest-fields",
        action="store_true",
        help="Print candidate decision fields for the schema and exit without rehearsing.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.suggest_fields:
        return _suggest(args.plan)

    try:
        plan = load_plan(args.plan)
    except PlanError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return EXIT_INPUT_ERROR

    rehearsals = analysis.rehearse(plan)
    findings = analysis.analyse(plan, rehearsals)
    report = analysis.to_dict(plan, rehearsals, findings)

    if args.as_json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        _print_report(plan.name, rehearsals, findings)

    sys.stdout.flush()
    threshold = analysis.SEVERITY_ORDER.index(args.fail_on)
    blocking = [
        finding
        for finding in findings
        if analysis.SEVERITY_ORDER.index(finding.severity) <= threshold
    ]
    if blocking:
        if not args.as_json:
            print(
                f"\n{len(blocking)} finding(s) at or above {args.fail_on}. "
                "This plan should not go out as written.",
                file=sys.stderr,
            )
        return EXIT_BLOCKED
    return EXIT_OK


def _suggest(path: Path) -> int:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"error: could not read call plan: {exc}", file=sys.stderr)
        return EXIT_INPUT_ERROR
    schema = raw.get("result_schema") if isinstance(raw, dict) else None
    candidates = suggest_decision_fields(schema if isinstance(schema, dict) else {})
    if not candidates:
        print("No obvious decision-field candidates. Declare fields.decision yourself.")
        return EXIT_OK
    print("Candidate decision fields, for a human to choose between:")
    for name in candidates:
        print(f"  - {name}")
    print("\nNothing is selected automatically. Set fields.decision in the plan.")
    return EXIT_OK


def _print_report(name, rehearsals, findings) -> None:
    print(f"Rehearsing call plan: {name}")
    print("No calls are placed. Nothing is dialled.\n")

    width = max(len(item.outcome.label) for item in rehearsals)
    print("What the automation does for each way the call can end:\n")
    for item in rehearsals:
        marker = "!!" if item.side_effect and not item.outcome.is_confirmation else "  "
        effect = "side effect" if item.side_effect else "no side effect"
        print(f" {marker} {item.outcome.label.ljust(width)}  ->  {item.action}  ({effect})")

    if not findings:
        print("\nNo findings. Every ending that is not a verified confirmation "
              "stays away from the side-effecting branch.")
        return

    print(f"\n{len(findings)} finding(s):\n")
    for finding in findings:
        label = _SEVERITY_LABEL[finding.severity]
        scope = "" if finding.outcome == "-" else f" [{finding.outcome}]"
        print(f"  {label}{scope} {finding.summary}")
        print(f"      {finding.detail}")
        print()


if __name__ == "__main__":
    sys.exit(main())
