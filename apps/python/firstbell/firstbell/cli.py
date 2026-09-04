"""One command. Offline by default, so a stranger can run it with no CALL-E account.

    python -m firstbell --work-file examples/absences.csv

That dials nobody, exercises the whole pipeline against a local double, and ends by
printing what the run was worth, computed from the run's own output.

    python -m firstbell --work-file examples/absences.csv --live

That places real calls, costs real credits, and refuses to start without an explicit
confirmation. The default has to be safe because the rules require judges be able to test
the project "free of charge and without any restriction", and because every call this
platform places is irreversible and reaches a real person.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

from dispatch import (
    CsvSource,
    DispatchReport,
    Resolution,
    SourceError,
    WaveDispatcher,
    default_idempotency_key,
)

from .domain import RESULT_SCHEMA, FundingRate, build_task, summarise

BANNER_OFFLINE = "OFFLINE. No call will be placed. No CALL-E account is needed."

# The one host that can make a phone ring. Anything else answering this API is a double,
# including ours.
PRODUCTION_HOST = "api.heycall-e.com"


@dataclass(frozen=True)
class RunMode:
    """Where the calls in this run actually went.

    `--live` alone is not enough to know. The SDK takes a base URL, so a run can use the
    real client over real HTTP and still be talking to a local double. A receipt that
    called that "live" would be worse than no receipt at all, because it would read as
    evidence of something that never happened. So the mode carries the URL it dialled and
    reserves the word live for the one host that can make a phone ring.
    """

    live: bool
    base_url: str | None = None

    @property
    def reached_production(self) -> bool:
        if not self.live or not self.base_url:
            return False
        return (urlparse(self.base_url).hostname or "") == PRODUCTION_HOST

    @property
    def label(self) -> str:
        if not self.live:
            return "offline"
        return "live" if self.reached_production else "live-nonproduction"

    def banner(self) -> str:
        if not self.live:
            return BANNER_OFFLINE
        if self.reached_production:
            return ("LIVE. Real phone calls will be placed and real credits spent. "
                    f"Target: {self.base_url}")
        return ("LIVE MODE, NON-PRODUCTION TARGET. The real SDK is speaking real HTTP to "
                f"{self.base_url}, which is not CALL-E. No phone will ring.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="firstbell",
        description="Phone the families whose absence notification went unanswered, "
                    "in their own language, and bring back a structured reason.",
    )
    parser.add_argument("--work-file", required=True, type=Path,
                        help="CSV of unexplained absences. Needs id, phones, consent.")
    parser.add_argument("--concurrency", type=int, default=3,
                        help="Maximum calls in flight at once. This is the only brake "
                             "CALL-E offers, so it is a safety setting (default: 3).")
    parser.add_argument("--live", action="store_true",
                        help="Place real calls against the real API. Costs credits.")
    parser.add_argument("--yes-i-mean-it", action="store_true",
                        help="Required with --live. Confirms real people will be phoned.")
    parser.add_argument("--limit", type=int, default=None,
                        help="Only take the first N rows. Use this with --live.")
    parser.add_argument("--school-name", default="the school")
    parser.add_argument("--funding-rate", type=float, default=None,
                        help="Per-student-per-day funding attached to attendance. "
                             "Requires --funding-source and --funding-url.")
    parser.add_argument("--funding-currency", default="$")
    parser.add_argument("--funding-jurisdiction", default="")
    parser.add_argument("--funding-source", default="")
    parser.add_argument("--funding-url", default="")
    parser.add_argument("--funding-year", type=int, default=date.today().year)
    parser.add_argument("--receipt", type=Path, default=None,
                        help="Write a JSON receipt of the run to this path.")
    parser.add_argument("--include-transcript", action="store_true",
                        help="Put what was actually said into the receipt. Off by "
                             "default. Only use it when the person on the call agreed "
                             "that this specific conversation would be published.")
    parser.add_argument("--json", action="store_true", help="Machine-readable output.")
    return parser


def _rate_from(args: argparse.Namespace) -> FundingRate | None:
    if args.funding_rate is None:
        return None
    missing = [
        flag for flag, value in (
            ("--funding-source", args.funding_source),
            ("--funding-url", args.funding_url),
            ("--funding-jurisdiction", args.funding_jurisdiction),
        ) if not value.strip()
    ]
    if missing:
        raise SystemExit(
            "--funding-rate requires " + ", ".join(missing) + ".\n"
            "A money figure without a citation is not a claim this tool will help you make."
        )
    return FundingRate(
        amount=args.funding_rate, currency=args.funding_currency,
        jurisdiction=args.funding_jurisdiction, source=args.funding_source,
        source_url=args.funding_url, year=args.funding_year,
    )


def _client_and_mode(args: argparse.Namespace):
    """Return (client, RunMode, double_or_None)."""
    if not args.live:
        from calle_double import CalleDouble, build_client
        from .scenario import apply_demo_outcomes
        double = CalleDouble(latency_seconds=0.02)
        apply_demo_outcomes(double)
        return build_client(double), RunMode(live=False), double

    if not args.yes_i_mean_it:
        raise SystemExit(
            "--live places real phone calls to real people and spends real credits.\n"
            "Add --yes-i-mean-it once you have read the work file and mean to call "
            "everyone in it.\nConsider --limit 1 for a first run."
        )
    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        raise SystemExit("--live needs CALLE_API_KEY in the environment.")

    from calle import CalleClient
    base_url = os.environ.get("CALLE_BASE_URL", "https://api.heycall-e.com")
    return CalleClient(api_key=api_key, base_url=base_url), RunMode(True, base_url), None


def _write_receipt(path: Path, *, report: DispatchReport, mode: RunMode,
                   summary, args: argparse.Namespace) -> None:
    """Evidence, not a claim.

    A receipt records what actually happened on one run: which calls were placed, what came
    back, and what was concluded. It is written for both modes and it says which mode it
    was, because a receipt that hides whether the calls were real would be worthless.

    What it does not carry by default is the transcript. This repository's pull-request
    checklist forbids including "call recordings, or private transcripts", and a parent
    explaining a child's illness has said something private to a school, not to a git
    history. `--include-transcript` exists because a demonstration call, where the caller
    and the callee are the same consenting person, is the one case where publishing the
    words is the point. Making that a flag rather than a default means the sensitive
    choice has to be made on purpose.
    """
    payload = {
        "mode": mode.label,
        "transcript_included": bool(args.include_transcript),
        "api_base_url": mode.base_url,
        "reached_production_api": mode.reached_production,
        "generated": date.today().isoformat(),
        "work_file": str(args.work_file),
        "concurrency": args.concurrency,
        "counts": report.counts(),
        "resolution_rate": round(summary.resolution_rate, 4),
        "calls_placed": summary.calls_placed,
        "funding_rate": (None if summary.rate is None else {
            "amount": summary.rate.amount, "currency": summary.rate.currency,
            "jurisdiction": summary.rate.jurisdiction, "year": summary.rate.year,
            "source": summary.rate.source, "source_url": summary.rate.source_url,
        }),
        "funding_recovered": summary.funding_recovered,
        "cancelled": report.cancelled,
        "not_recallable": report.not_recallable,
        "fatal_error": report.fatal_error,
        "items": [
            {
                "id": r.item.id,
                "resolution": r.resolution.value,
                "call_id": r.call_id,
                "numbers_tried": list(r.masked_numbers),   # masked, never raw
                "attempts": r.attempts_made,
                # True placed, False replayed by an idempotency key, null undetermined.
                # A receipt that counted a replay as a call would overstate the cost.
                "placed_by_this_run": r.placed_by_this_run,
                "structured_result": r.structured_result,
                "failure_code": r.failure_code,
                "reason": r.reason,
                **({"transcript": list(r.transcript)} if args.include_transcript else {}),
            }
            for r in report.results
        ],
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    rate = _rate_from(args)

    try:
        items = list(CsvSource(args.work_file).items())
    except SourceError as err:
        print(f"Could not read the work file: {err}", file=sys.stderr)
        return 2
    if args.limit is not None:
        items = items[: args.limit]

    client, mode, double = _client_and_mode(args)
    print(mode.banner())
    print(f"{len(items)} row(s) from {args.work_file}, concurrency {args.concurrency}.")
    print()

    for item in items:
        item.context.setdefault("school_name", args.school_name)

    dispatcher = WaveDispatcher(
        client,
        task_builder=build_task,
        result_schema=RESULT_SCHEMA,
        concurrency=args.concurrency,
        idempotency_key=default_idempotency_key("attendance", date.today().isoformat()),
        poll_interval_seconds=2.0 if mode.live else 0.0,
    )
    report = dispatcher.run(items)

    summary = summarise(report.results, live=mode.reached_production, rate=rate)

    if args.json:
        print(json.dumps({"counts": report.counts(),
                          "funding_recovered": summary.funding_recovered}, indent=2))
    else:
        _print_human(report, summary)

    if args.receipt:
        _write_receipt(args.receipt, report=report, mode=mode, summary=summary, args=args)
        print(f"\nReceipt written to {args.receipt}")

    return 1 if report.fatal_error else 0


def _print_human(report: DispatchReport, summary) -> None:
    for result in report.results:
        marker = {
            Resolution.RESOLVED: "ok  ",
            Resolution.UNDETERMINED: "HUMAN",
            Resolution.FAILED: "HUMAN",
            Resolution.SKIPPED: "skip",
        }[result.resolution]
        print(f"  [{marker:5s}] {result.item.id:12s} {result.reason}")

    print()
    print("What this run was worth")
    for line in summary.lines():
        print(line)

    queue = report.needs_human
    if queue:
        print()
        print(f"{len(queue)} case(s) need a person. Nothing here is closed:")
        for result in queue:
            print(f"  {result.item.id:12s} {result.reason}")


if __name__ == "__main__":
    raise SystemExit(main())
