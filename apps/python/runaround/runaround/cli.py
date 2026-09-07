"""Command line for Runaround.

Default mode is ``fixture``: it places no calls and needs no credential.
``live`` requires an explicit mode flag, an API key in the environment, and a
per-run acknowledgement that a real telephone will ring.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from runaround import chain, evidence
from runaround.calle_client import CallEClient, CallEError
from runaround.case import (
    CaseError,
    build_case,
    list_cases,
    load_case,
    save_case,
)
from runaround.chain import Desk
from runaround.runner import (
    FixturePlacer,
    LivePlacer,
    RunRefused,
    plan_hop,
    run_chain,
    run_hop,
)

DEMO_INTAKE = {
    "case_id": "parcel-8472",
    "subject": (
        "Order ORD-8472 arrived crushed on 2026-08-30; the contents are broken"
    ),
    "question": (
        "Which organization accepts the damage claim for this parcel, and what "
        "is the claim reference number?"
    ),
    "requester_name": "Dana Okafor",
    "requester_phone": "+15550199",
    "region": "US",
    "locale": "en-US",
    "hop_budget": 4,
    "first_desk": {
        "name": "Example Retail Support",
        "phone": "+15550100",
        "region": "US",
    },
}


def _print(payload: Any) -> None:
    if isinstance(payload, str):
        print(payload)
    else:
        print(json.dumps(payload, indent=2, ensure_ascii=True))


def _data_dir(args: argparse.Namespace) -> Path:
    return Path(args.data)


def _placer(args: argparse.Namespace):
    if args.mode == "fixture":
        if not args.fixture:
            raise SystemExit(
                "fixture mode needs --fixture pointing at a scripted call file"
            )
        return FixturePlacer.from_file(Path(args.fixture))
    if args.mode == "live":
        if not args.i_understand_this_calls_people:
            raise SystemExit(
                "live mode rings a real telephone. Re-run with "
                "--i-understand-this-calls-people once you have the "
                "recipient's authorization to be called about this case."
            )
        return LivePlacer(client=CallEClient.from_env())
    raise SystemExit(f"unknown mode {args.mode!r}")


def _status_line(case) -> str:
    return (
        f"{case.case_id}: {case.status} after {case.hops_used()} call(s) "
        f"-- {case.status_reason}"
    )


def command_init_demo(args: argparse.Namespace) -> int:
    case = build_case(DEMO_INTAKE)
    path = save_case(_data_dir(args), case)
    _print(f"wrote {path}")
    _print(_status_line(case))
    return 0


def command_open(args: argparse.Namespace) -> int:
    spec = json.loads(Path(args.intake).read_text(encoding="utf-8"))
    case = build_case(spec)
    path = save_case(_data_dir(args), case)
    _print(f"wrote {path}")
    _print(_status_line(case))
    return 0


def command_status(args: argparse.Namespace) -> int:
    cases = list_cases(_data_dir(args))
    if not cases:
        _print("no cases")
        return 0
    for case in cases:
        _print(_status_line(case))
        if case.pending_desk:
            _print(
                f"    next destination would be {case.pending_desk.name} "
                f"({case.pending_desk.masked()})"
            )
    return 0


def command_plan(args: argparse.Namespace) -> int:
    case = load_case(_data_dir(args), args.case_id)
    _print(plan_hop(case))
    return 0


def command_run(args: argparse.Namespace) -> int:
    case = load_case(_data_dir(args), args.case_id)
    placer = _placer(args)
    if args.once:
        hop = run_hop(case=case, placer=placer, data_dir=_data_dir(args))
        _print(
            f"hop {hop.index} to {hop.desk.name} ({hop.desk.masked()}): "
            f"{hop.outcome} -- {hop.reason}"
        )
    else:
        for hop in run_chain(
            case=case, placer=placer, data_dir=_data_dir(args)
        ):
            _print(
                f"hop {hop.index} to {hop.desk.name} ({hop.desk.masked()}): "
                f"{hop.outcome} -- {hop.reason}"
            )
    _print(_status_line(case))
    return 0


def command_approve(args: argparse.Namespace) -> int:
    case = load_case(_data_dir(args), args.case_id)
    if case.status != chain.CHAIN_AWAITING_APPROVAL and (
        case.status != chain.CHAIN_LOOP_SUSPECTED
    ):
        _print(
            f"case {case.case_id} is {case.status}; there is nothing awaiting "
            "approval"
        )
        return 1
    desk = case.pending_desk
    if desk is None:
        _print("no pending destination is recorded on this case")
        return 1
    case.authorize(Desk(name=desk.name, phone=desk.phone, region=desk.region))
    case.status = chain.CHAIN_CONTINUE
    case.status_reason = (
        f"a person approved calling {desk.name} at {desk.masked()}"
    )
    case.pending_desk = desk
    save_case(_data_dir(args), case)
    _print(f"approved {desk.name} ({desk.masked()})")
    _print(_status_line(case))
    return 0


def command_stop(args: argparse.Namespace) -> int:
    case = load_case(_data_dir(args), args.case_id)
    case.status = chain.CHAIN_NEEDS_HUMAN
    case.status_reason = args.reason or "stopped by a person"
    case.pending_desk = None
    save_case(_data_dir(args), case)
    _print(_status_line(case))
    return 0


def command_evidence(args: argparse.Namespace) -> int:
    case = load_case(_data_dir(args), args.case_id)
    pack = evidence.render(case)
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(pack, encoding="utf-8")
        _print(f"wrote {out}")
    else:
        _print(pack)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="runaround",
        description=(
            "Chase one question across organizations by phone, and stop with "
            "evidence when the referrals close on themselves."
        ),
    )
    parser.add_argument(
        "--data",
        default="./data",
        help="directory holding case files (default: ./data)",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    demo = subparsers.add_parser(
        "init-demo", help="write the fictional demo case"
    )
    demo.set_defaults(handler=command_init_demo)

    opened = subparsers.add_parser("open", help="open a case from an intake file")
    opened.add_argument("intake", help="path to an intake JSON document")
    opened.set_defaults(handler=command_open)

    status = subparsers.add_parser("status", help="list cases and their states")
    status.set_defaults(handler=command_status)

    plan = subparsers.add_parser(
        "plan", help="print the next call request without sending it"
    )
    plan.add_argument("case_id")
    plan.set_defaults(handler=command_plan)

    run = subparsers.add_parser("run", help="place calls for a case")
    run.add_argument("case_id")
    run.add_argument(
        "--mode",
        choices=("fixture", "live"),
        default="fixture",
        help="fixture places no calls (default); live rings real telephones",
    )
    run.add_argument("--fixture", help="scripted call file for fixture mode")
    run.add_argument(
        "--once", action="store_true", help="place at most one call"
    )
    run.add_argument(
        "--i-understand-this-calls-people",
        action="store_true",
        help="required acknowledgement for live mode",
    )
    run.set_defaults(handler=command_run)

    approve = subparsers.add_parser(
        "approve", help="authorize the destination a call named"
    )
    approve.add_argument("case_id")
    approve.set_defaults(handler=command_approve)

    stop = subparsers.add_parser("stop", help="hand the case to a person")
    stop.add_argument("case_id")
    stop.add_argument("--reason")
    stop.set_defaults(handler=command_stop)

    pack = subparsers.add_parser("evidence", help="render the evidence pack")
    pack.add_argument("case_id")
    pack.add_argument("--out", help="write markdown to this path")
    pack.set_defaults(handler=command_evidence)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.handler(args))
    except (CaseError, RunRefused, CallEError) as error:
        # A refusal is an answer, not a crash. Every one of these says which
        # condition was not met, so a traceback would only hide it.
        print(f"refused: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
