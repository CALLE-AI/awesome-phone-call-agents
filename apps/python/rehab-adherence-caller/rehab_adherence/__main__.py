"""CLI. Preview is the default and places no call.

    python -m rehab_adherence preview --course examples/course.example.json
    python -m rehab_adherence preview --course ... --show-task p_ivy
    python -m rehab_adherence run --course ... --fixture examples/responses.example.json
    python -m rehab_adherence run --course ... --live --confirm-authorized --output private/ledger.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date
from pathlib import Path

from .calle import DEFAULT_BASE_URL, FixturePort, LivePort
from .model import CourseFile, InputError
from .report import (
    FIXTURE_BANNER,
    LIVE_BANNER,
    PREVIEW_BANNER,
    render,
    render_transcript,
    write_jsonl,
)
from .workflow import masked_call_arguments, plan, run


def _replay(text: str, delay: float) -> None:
    """Print a transcript one line at a time, so a recording shows the exchange
    unfolding instead of appearing all at once."""
    for line in text.splitlines():
        print(line, flush=True)
        time.sleep(delay)


def _today(raw: str | None) -> date:
    if raw is None:
        return date.today()
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise SystemExit("--today must be an ISO date (YYYY-MM-DD)")


def _load(path: Path) -> CourseFile:
    try:
        return CourseFile.parse(json.loads(path.read_text(encoding="utf-8")))
    except FileNotFoundError:
        raise SystemExit(f"course file not found: {path}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"course file is not valid JSON: {exc}")
    except InputError as exc:
        raise SystemExit(f"course file rejected: {exc}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="rehab_adherence",
        description="Decide which rehab patients need a call, then make it through CALL-E.",
    )
    subparsers = parser.add_subparsers(dest="command")

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--course", type=Path, required=True, help="Path to the course JSON file.")
    common.add_argument("--today", help="Evaluate as of this ISO date instead of today.")

    preview = subparsers.add_parser("preview", parents=[common], help="Show the plan. Places no call. Default.")
    preview.add_argument("--show-task", metavar="PATIENT_ID", help="Print the exact goal text for one patient.")

    runner = subparsers.add_parser("run", parents=[common], help="Execute the plan through a fixture or live.")
    runner.add_argument("--fixture", type=Path, help="Replay authored responses. No network, no calls.")
    runner.add_argument("--live", action="store_true", help="Place real phone calls.")
    runner.add_argument(
        "--confirm-authorized",
        action="store_true",
        help="Required with --live. Asserts every number is owned by or authorized by the recipient.",
    )
    runner.add_argument("--base-url", default=DEFAULT_BASE_URL, help="CALL-E API base URL.")
    runner.add_argument("--output", type=Path, help="Write the ledger as JSONL to this path.")
    runner.add_argument(
        "--transcripts",
        action="store_true",
        help="Print each call as speaker-tagged turns after the ledger.",
    )
    recover = subparsers.add_parser(
        "recover", help="Re-read a call that was already placed. Places no call."
    )
    recover.add_argument("--call-id", required=True, help="Call id from the checkpoint file.")
    recover.add_argument("--base-url", default=DEFAULT_BASE_URL)

    runner.add_argument(
        "--replay-delay",
        type=float,
        default=0.0,
        metavar="SECONDS",
        help="With --transcripts, pause between turns so the exchange can be read or filmed.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 2

    if args.command == "recover":
        api_key = os.environ.get("CALLE_API_KEY", "")
        if not api_key:
            raise SystemExit("set CALLE_API_KEY in the environment")
        result = LivePort(api_key, base_url=args.base_url).fetch(args.call_id)
        print(json.dumps(result, indent=2, default=str))
        return 0

    course_file = _load(args.course)
    today = _today(args.today)

    if args.command == "preview":
        planned = plan(course_file, today)
        if args.show_task:
            match = [(d, r) for d, r in planned if d.patient_id == args.show_task]
            if not match:
                raise SystemExit(f"no patient with id {args.show_task}")
            decision, _ = match[0]
            if not decision.will_call:
                blockers = ", ".join(decision.blockers) or decision.action
                raise SystemExit(f"{args.show_task} would not be called ({blockers}); no task exists")
            print(json.dumps(masked_call_arguments(course_file, args.show_task, decision), indent=2))
            return 0
        print(render([row for _, row in planned], banner=PREVIEW_BANNER, course_id=course_file.course.id, today=today.isoformat()))
        return 0

    if args.live and args.fixture:
        raise SystemExit("choose either --fixture or --live, not both")

    if args.live:
        if not args.confirm_authorized:
            raise SystemExit("--live also requires --confirm-authorized")
        api_key = os.environ.get("CALLE_API_KEY", "")
        if not api_key:
            raise SystemExit("set CALLE_API_KEY in the environment; never place it in a file")
        checkpoint = (args.output.with_suffix(".callids") if args.output
                      else Path("private/placed-calls.callids"))
        port = LivePort(api_key, base_url=args.base_url, checkpoint=checkpoint)
        banner = LIVE_BANNER
        print(f"call ids will be checkpointed to {checkpoint} before each poll", flush=True)
    elif args.fixture:
        try:
            responses = json.loads(args.fixture.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise SystemExit(f"fixture file not found: {args.fixture}")
        port = FixturePort(responses)
        banner = FIXTURE_BANNER
    else:
        raise SystemExit("run needs --fixture (no calls) or --live (real calls)")

    if args.live:
        print("dialling — this takes 60-120s per patient and the terminal stays quiet\n", flush=True)

    rows = run(course_file, today, port)
    print(render(rows, banner=banner, course_id=course_file.course.id, today=today.isoformat()))

    if args.transcripts:
        for row in rows:
            if not row.called:
                continue
            print()
            if args.replay_delay > 0:
                _replay(render_transcript(row), args.replay_delay)
            else:
                print(render_transcript(row))
    if args.output:
        write_jsonl(args.output, rows)
        print(f"\nledger written: {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
