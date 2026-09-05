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
    Escalation,
    Resolution,
    SourceError,
    WaveDispatcher,
    default_idempotency_key,
    redact_free_text,
)

from .domain import (
    RESULT_SCHEMA,
    SAFEGUARDING_CALLBACK_MINUTES,
    FundingRate,
    StaffCost,
    build_task,
    safeguarding_escalation,
    summarise,
)

BANNER_OFFLINE = "OFFLINE. No call will be placed. No CALL-E account is needed."

# The one host that can make a phone ring. Anything else answering this API is a double,
# including ours.
PRODUCTION_HOST = "api.heycall-e.com"

# The one origin the production credential may be sent to. Host alone is not enough: the
# scheme is half the promise, and `http://api.heycall-e.com` is the same host with the
# bearer token in the clear.
TRUSTED_ORIGIN = f"https://{PRODUCTION_HOST}"

# What a real CALL-E project key looks like. Used only to refuse to send one somewhere it
# does not belong, never to validate one.
LIVE_KEY_PREFIX = "iams_live_"


def _origin(url: str | None) -> str:
    """scheme://host[:port], lowercased, with a default port dropped.

    Compared as a whole because every part of it is load-bearing. Matching on hostname
    alone accepts a plaintext downgrade, and matching on the raw string rejects an
    equivalent URL that only differs by a trailing slash or an explicit :443.
    """
    if not url:
        return ""
    parsed = urlparse(url)
    scheme = (parsed.scheme or "").lower()
    host = (parsed.hostname or "").lower()
    if not scheme or not host:
        return ""
    port = parsed.port
    if port is None or (scheme, port) in (("https", 443), ("http", 80)):
        return f"{scheme}://{host}"
    return f"{scheme}://{host}:{port}"


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
        # Origin, not hostname. This used to compare the host and nothing else, so
        # `http://api.heycall-e.com` answered True: a run that put the bearer token on
        # the wire in plaintext would have been recorded as an ordinary live call.
        return _origin(self.base_url) == TRUSTED_ORIGIN

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
    parser.add_argument("--staff-annual", type=float, default=None,
                        help="Annual cost of one office post, for the staff-time "
                             "arithmetic. Defaults to a sourced US school-office "
                             "median. Your own figure is not sourced by this tool and "
                             "the output says so.")
    parser.add_argument("--staff-hours", type=int, default=None,
                        help="Paid hours a year behind --staff-annual. Default 2,080, "
                             "which reads a ten-month contract as cheaper than it is.")
    parser.add_argument("--no-staff-cost", action="store_true",
                        help="Leave the staff-time arithmetic out of the summary.")
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


def _staff_from(args: argparse.Namespace) -> StaffCost | None:
    """The default is sourced. An override is labelled as unsourced, not refused.

    A judge who wants to try their own district's wage should not have to produce a
    citation to do it, but the printed provenance must never claim a source the number
    does not have.
    """
    if args.no_staff_cost:
        return None
    default = StaffCost.us_school_office()
    if args.staff_annual is None and args.staff_hours is None:
        return default
    return StaffCost(
        annual=args.staff_annual if args.staff_annual is not None else default.annual,
        currency=default.currency,
        hours_per_year=(args.staff_hours if args.staff_hours is not None
                        else default.hours_per_year),
        occupation=default.occupation,
        industry=default.industry,
        source="supplied on the command line, not sourced by this tool",
        source_url="",
        year=date.today().year,
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
    base_url = os.environ.get("CALLE_BASE_URL", TRUSTED_ORIGIN)

    # The credential goes to one origin and nowhere else.
    #
    # `CALLE_BASE_URL` exists so the real client can speak real HTTP to the bundled
    # double, which is how this runs offline and how a reviewer tests it without
    # credits. That same variable is what makes this dangerous: a machine that has just
    # placed a live call still has the production key exported, and pointing the base URL
    # at a double, a colleague's laptop or a typo would hand that key straight to it.
    # Nothing here checked. The double's own instructions already say to use
    # `iams_test_anything`; this makes the instruction load-bearing instead of advisory.
    if _origin(base_url) != TRUSTED_ORIGIN and api_key.startswith(LIVE_KEY_PREFIX):
        raise SystemExit(
            f"Refusing to send a live CALL-E key to {base_url}.\n"
            f"A production credential is only ever sent to {TRUSTED_ORIGIN}.\n"
            "To run against the bundled double, use a throwaway key:\n"
            "  export CALLE_API_KEY=iams_test_anything\n"
            f"To call for real, unset CALLE_BASE_URL or set it to {TRUSTED_ORIGIN}."
        )
    return CalleClient(api_key=api_key, base_url=base_url), RunMode(True, base_url), None


def _write_receipt(path: Path, *, report: DispatchReport, mode: RunMode,
                   api_responded: bool | None = None,
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
        # Two different facts, and one field carried both. Targeting is known from
        # configuration before anything is sent. Reaching is only knowable from an
        # answer, and a run whose every attempt dies at the transport layer reached
        # nothing at all.
        "production_api_targeted": mode.reached_production,
        "reached_production_api": (None if api_responded is None
                                   else mode.reached_production and api_responded),
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
                "provider_call_id": r.provider_call_id,
                "numbers_tried": list(r.masked_numbers),   # masked, never raw
                "attempts": r.attempts_made,
                # True placed, False replayed by an idempotency key, null undetermined.
                # A receipt that counted a replay as a call would overstate the cost.
                "placed_by_this_run": r.placed_by_this_run,
                # The flag below governs the transcript. It never governed this, and
                # a result field holds what a person said, so it can hold a number.
                "structured_result": redact_free_text(r.structured_result),
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
        escalate=safeguarding_escalation,
        idempotency_key=default_idempotency_key("attendance", date.today().isoformat()),
        poll_interval_seconds=2.0 if mode.live else 0.0,
    )
    report = dispatcher.run(items)

    summary = summarise(report.results, live=mode.reached_production, rate=rate,
                        staff=_staff_from(args))

    if args.json:
        print(json.dumps({
            "counts": report.counts(),
            "funding_recovered": summary.funding_recovered,
            "attempts_billed": summary.calls_placed,
            "attempts_removed": summary.attempts_resolved,
            "attempts_still_open": summary.attempts_open,
            "break_even_per_call_minute": summary.break_even_per_call_minute,
        }, indent=2))
    else:
        _print_human(report, summary)

    if args.receipt:
        _write_receipt(args.receipt, report=report, mode=mode, summary=summary, args=args,
                       api_responded=dispatcher.api_responded)
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
        # A resolved-and-escalated row prints `ok` under the old mapping, which is the
        # same four characters a closed case gets. The whole point of the escalation is
        # that a person reading down this column stops at it.
        if result.escalation is not Escalation.NONE:
            marker = result.escalation.value.upper()[:5]
        print(f"  [{marker:5s}] {result.item.id:12s} {result.reason}")

    print()
    print("What this run was worth")
    for line in summary.lines():
        print(line)

    queue = report.needs_human
    if queue:
        escalated = report.escalated
        print()
        print(f"{len(queue)} case(s) need a person. Nothing here is closed:")
        if escalated:
            verb = 'is' if len(escalated) == 1 else 'are'
            print(f"  {len(escalated)} of those cases {verb} safeguarding: the parent did "
                  f"not confirm they already knew.")
            print(f"  A school would have to answer these within "
                  f"{SAFEGUARDING_CALLBACK_MINUTES} minutes.")
        for result in queue:
            flag = "!! " if result.escalation is not Escalation.NONE else "   "
            print(f"  {flag}{result.item.id:12s} {result.reason}")


if __name__ == "__main__":
    raise SystemExit(main())
