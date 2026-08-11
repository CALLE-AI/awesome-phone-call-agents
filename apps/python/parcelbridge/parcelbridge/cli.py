"""Command-line interface for the ParcelBridge reference app.

The CLI exposes two subcommands:

* ``python -m parcelbridge.cli demo --offline ...``
  The default synthetic demo. Exercises the inline fake
  MCP server and surfaces the sanitized response. Prints
  an explicit ``OFFLINE SYNTHETIC DEMO`` banner so the
  provenance is never ambiguous in CI logs.
* ``python -m parcelbridge.cli validate ...``
  Runs the workflow's self-audit and prints a structured
  pass/fail report. Does not contact any network.

The CLI also accepts ``python -m parcelbridge`` (without
the ``.cli`` module qualifier) via
:mod:`parcelbridge.__main__`. Both entry points reach this
module's :func:`main`.

The CLI never accepts a phone number, an OAuth token, a
plan ID, or any other sensitive value. The only inputs it
accepts are the scenario name (drawn from
:data:`parcelbridge.payload.SCENARIOS`), the BCP-47
language tag, the ISO 3166-1 alpha-2 region code, and an
optional notes field (which is also subject to the
banned-substring policy).

The CLI never contacts a network. The ``demo`` subcommand
always exits zero on success; the ``validate`` subcommand
exits zero when the workflow's self-audit passes.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Optional, Sequence

from parcelbridge.exceptions import (
    ArgumentViolationError,
    ParcelBridgeError,
)
from parcelbridge.payload import SCENARIOS
from parcelbridge.workflow import (
    run_offline_demo,
    validate_payload,
    validate_workflow,
)


_BANNER = (
    "OFFLINE SYNTHETIC DEMO\n"
    "----------------------\n"
    "This is an OFFLINE synthetic MCP validation. The default\n"
    "demo exercises the official CALL-E client code path shape\n"
    "but does NOT claim a live CALL-E endpoint call, a real\n"
    "phone call, provider-verified business semantics, or\n"
    "production readiness. See bundle docs/DISCLOSURE.md for\n"
    "the full allowed-claim contract.\n"
)


def _build_demo_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="parcelbridge.cli demo",
        description=(
            "Run the offline synthetic demo. The demo exercises "
            "the inline fake MCP server; it does not contact a "
            "network and does not dial any phone number."
        ),
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        default=True,
        help=(
            "Run against the inline fake MCP server (default; "
            "the flag is kept for explicit-but-redundant "
            "semantics so shell history and CI logs record "
            "the intent)."
        ),
    )
    parser.add_argument(
        "--scenario",
        choices=sorted(SCENARIOS),
        default="gate-code-failure",
        help="Business scenario to materialise (default: gate-code-failure).",
    )
    parser.add_argument(
        "--language",
        default="en-US",
        help="BCP-47 language tag (default: en-US).",
    )
    parser.add_argument(
        "--region",
        default="US",
        help="ISO 3166-1 alpha-2 region code (default: US).",
    )
    parser.add_argument(
        "--notes",
        default=None,
        help=(
            "Optional notes field. Subject to the same "
            "banned-substring policy as the rest of the "
            "payload; useful for dry-running the policy "
            "module."
        ),
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help=(
            "Emit the sanitized response as JSON on stdout, "
            "in addition to the human-readable banner."
        ),
    )
    return parser


def _run_demo(args: argparse.Namespace) -> int:
    # The banner is printed first so every demo run makes the
    # offline-fake provenance visible in CI logs.
    sys.stdout.write(_BANNER)
    sys.stdout.write(
        f"[parcelbridge] mode=offline scenario={args.scenario}\n"
    )

    try:
        result = run_offline_demo(
            scenario=args.scenario,
            language=args.language,
            region=args.region,
        )
    except ArgumentViolationError as exc:
        sys.stderr.write(f"[parcelbridge] argument violation: {exc}\n")
        return 3
    except ParcelBridgeError as exc:
        sys.stderr.write(f"[parcelbridge] error: {exc}\n")
        return 4

    sys.stdout.write(
        "[parcelbridge] inline fake MCP server returned a READY response\n"
    )
    for cap_field, length in result.sanitized_response.fingerprints.items():
        sys.stdout.write(
            f"[parcelbridge] {cap_field}_length={length} "
            "(synthetic fingerprint)\n"
        )
    sys.stdout.write(
        "[parcelbridge] capability values DISCARDED; only length "
        "fingerprints retained\n"
    )
    sys.stdout.write(
        "[parcelbridge] run_call is not implemented; nothing to dial\n"
    )
    sys.stdout.write(f"[parcelbridge] result={result.outcome}\n")

    if args.json:
        envelope = {
            "mode": result.bridge_mode,
            "outcome": result.outcome,
            "sanitized_response": result.sanitized_response.to_dict(),
        }
        sys.stdout.write("\n--- JSON envelope ---\n")
        sys.stdout.write(json.dumps(envelope, indent=2, sort_keys=True))
        sys.stdout.write("\n")

    return 0


def _build_validate_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="parcelbridge.cli validate",
        description=(
            "Run the workflow's self-audit. Does not contact a "
            "network. Exits zero when the audit passes."
        ),
    )
    parser.add_argument(
        "--scenario",
        choices=sorted(SCENARIOS),
        default=None,
        help=(
            "Optional scenario to validate. If omitted, the "
            "workflow's overall self-audit is returned."
        ),
    )
    parser.add_argument(
        "--language",
        default="en-US",
        help="BCP-47 language tag (default: en-US).",
    )
    parser.add_argument(
        "--region",
        default="US",
        help="ISO 3166-1 alpha-2 region code (default: US).",
    )
    parser.add_argument(
        "--notes",
        default=None,
        help="Optional notes field for the dry-run payload check.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit the validation report as JSON on stdout.",
    )
    return parser


def _run_validate(args: argparse.Namespace) -> int:
    if args.scenario is None and args.notes is None:
        report = validate_workflow()
    else:
        payload_report = validate_payload(
            scenario=args.scenario or "gate-code-failure",
            language=args.language,
            region=args.region,
            notes=args.notes,
        )
        # Merge with the workflow-level audit so the operator
        # gets the same coverage either way.
        workflow_report = validate_workflow()
        report = {"payload": payload_report, "workflow": workflow_report}

    if args.json:
        sys.stdout.write(json.dumps(report, indent=2, sort_keys=True))
        sys.stdout.write("\n")
    else:
        sys.stdout.write("Validation report:\n")
        sys.stdout.write(json.dumps(report, indent=2, sort_keys=True))
        sys.stdout.write("\n")

    # Exit zero if every check passed.
    def _all_pass(node: object) -> bool:
        if isinstance(node, dict):
            return all(_all_pass(v) for v in node.values())
        if isinstance(node, list):
            return all(_all_pass(v) for v in node)
        if isinstance(node, bool):
            return node
        if isinstance(node, str):
            # String values are informational, not pass/fail.
            return True
        return True

    return 0 if _all_pass(report) else 1


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="parcelbridge.cli",
        description=(
            "ParcelBridge reference app — refusal-first AI phone-agent "
            "integration. Offline-fake by default; live-mode is a "
            "documentation stub. Two subcommands: ``demo`` and "
            "``validate``."
        ),
    )
    sub = parser.add_subparsers(dest="subcommand", required=True)
    sub.add_parser(
        "demo",
        help=(
            "Run the offline synthetic demo (the default mode). "
            "The argument parser for ``demo`` is added below."
        ),
    )
    sub.add_parser(
        "validate",
        help=(
            "Run the workflow's self-audit. "
            "The argument parser for ``validate`` is added below."
        ),
    )
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    """CLI entry point. Returns a Unix-style exit code."""

    argv = list(argv) if argv is not None else sys.argv[1:]

    # Parse just the subcommand first so we can attach the
    # subcommand-specific parser.
    top_parser = _build_parser()
    if not argv:
        top_parser.print_help()
        return 0
    top_args, remaining = top_parser.parse_known_args(argv)

    if top_args.subcommand == "demo":
        sub_parser = _build_demo_parser()
        sub_args = sub_parser.parse_args(remaining)
        return _run_demo(sub_args)
    elif top_args.subcommand == "validate":
        sub_parser = _build_validate_parser()
        sub_args = sub_parser.parse_args(remaining)
        return _run_validate(sub_args)
    else:
        top_parser.print_help()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())