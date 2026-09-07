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
    DropSource,
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

# What the default run says about itself, and it has to say the second line. The first line
# alone reads as `CALL-E is not involved here`, which is the opposite of what happens: the
# offline path builds a real `calle.CalleClient` from the pinned `calle-ai` package and every
# request is constructed, sent, parsed and raised by CALL-E's own code. Only the transport is
# local, because `CalleClient` takes an injectable httpx client and the double is mounted on
# it. A reader who is told a run is offline and not told that will reasonably assume the SDK
# was stubbed out, and the whole point of the double is that it is not.
BANNER_OFFLINE = (
    "OFFLINE. No telephone call will be placed and no CALL-E account is needed.\n"
    "The CALL-E SDK is running: this is a real calle.CalleClient with the local double\n"
    "mounted on its transport, so every request and every error is CALL-E's own code."
)

# The one host that can make a phone ring. Anything else answering this API is a double,
# including ours.
PRODUCTION_HOST = "api.heycall-e.com"

# The one origin the production credential may be sent to. Host alone is not enough: the
# scheme is half the promise, and `http://api.heycall-e.com` is the same host with the
# bearer token in the clear.
TRUSTED_ORIGIN = f"https://{PRODUCTION_HOST}"

# What a throwaway key looks like. This is an allowlist, and it is the only thing that lets a
# credential leave for an origin that is not production.
#
# It used to be the other way round: a `LIVE_KEY_PREFIX` was refused and everything else was
# sent. That guard could only stop the key shapes it already knew, so a key issued under any
# other format, now or later, went to whatever host `CALLE_BASE_URL` named. Every other rule
# in this app fails closed, including the safeguarding rule it is built around, and this one
# did not. Recognising danger is a weaker promise than recognising safety.
TEST_KEY_PREFIX = "iams_test_"

# Kept because it is the shape a reader pictures, and the tests build a realistic live key
# from it. It no longer decides anything.
LIVE_KEY_PREFIX = "iams_live_"

# How many families one live run will phone before it stops and asks.
#
# `--yes-i-mean-it` is granted before the work file has been counted, so it confirms an
# intention rather than an amount. The failure that needs stopping is not an attacker: it is
# a morning where the office exports the wrong view from its student system and gets every
# enrolled pupil instead of the day's absentees. The idempotency key protects the second run
# and does nothing for the first, because every row is a different child.
#
# It refuses rather than truncating. Truncating would place calls to whichever families the
# file happened to list first, which is a worse answer than none: a partial run looks like a
# finished one, and nobody chose that subset. A refusal that names the number it found lets
# the operator see the size of what they were about to do, which is the whole control.
#
# Fifty is a school's bad morning, not a district's mailing list. A whole-school run is a
# real thing to want, so `--max-calls` raises it, and raising it is an act rather than a
# default.
DEFAULT_CALL_CEILING = 50


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
    # Exactly one of the two. A run that was given both would have to choose, and choosing
    # for an operator between "the file I named" and "whatever is in the drop" is choosing
    # who gets telephoned.
    where = parser.add_mutually_exclusive_group(required=True)
    where.add_argument("--work-file", type=Path,
                       help="CSV of unexplained absences. Needs id, phones, consent.")
    where.add_argument("--work-drop", type=Path,
                       help="Directory a system of record writes its nightly export to. "
                            "Reads the newest file in it, refuses one older than "
                            "--drop-max-age-hours, and refuses one it has already called "
                            "from. This is the unattended path.")
    parser.add_argument("--drop-max-age-hours", type=float, default=18.0,
                        help="With --work-drop, how old an export may be before it is "
                             "refused. A stale export means the overnight job did not run, "
                             "and calling from it telephones the families of children who "
                             "are in school today (default: 18).")
    parser.add_argument("--concurrency", type=int, default=3,
                        help="Maximum calls in flight at once. This is the only brake "
                             "CALL-E offers, so it is a safety setting (default: 3).")
    parser.add_argument("--live", action="store_true",
                        help="Place real calls against the real API. Costs credits.")
    parser.add_argument("--yes-i-mean-it", action="store_true",
                        help="Required with --live. Confirms real people will be phoned.")
    parser.add_argument("--limit", type=int, default=None,
                        help="Only take the first N rows. Use this with --live.")
    parser.add_argument("--max-calls", type=int, default=None,
                        help=f"Refuse a live run larger than this (default: "
                             f"{DEFAULT_CALL_CEILING}). Raise it deliberately for a whole "
                             f"school; the refusal names the number it found.")
    # A reviewer reading the code asked for this and was right: thirty minutes is one
    # district's mandate, not every district's. What the constant is defending is that
    # there is a clock at all, so this can move the window and cannot remove it.
    parser.add_argument("--safeguarding-minutes", type=int,
                        default=SAFEGUARDING_CALLBACK_MINUTES,
                        help=f"The window a district has agreed to answer a "
                             f"safeguarding escalation in (default: "
                             f"{SAFEGUARDING_CALLBACK_MINUTES}). The report says "
                             f"which one it used and whether it was yours.")
    # Two reviewers arrived at the same finding from opposite directions: one read the
    # scheduler and said polling scales badly beside an event, the other read the
    # constructor and found `webhook_url` accepted, forwarded to CALL-E, and set by
    # nobody. Both are right. This does not replace the poll, because the run has to
    # know how each call ended before it can print a report, and a webhook that never
    # arrives is not a result. What it does is stop the parameter being a promise: an
    # operator with an endpoint gets CALL-E telling their own system directly, at the
    # moment the call ends, rather than whenever this process next looks.
    parser.add_argument("--webhook-url", default=None,
                        help="Ask CALL-E to POST call.completed and call.failed here "
                             "as they happen. The run still polls: this is for your "
                             "own system, not for this one. Deliveries are unsigned, "
                             "so a receiver has to re-fetch before acting on one.")
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
    #
    # Read as an allowlist. Leaving for anywhere but production requires a key that says it
    # is a throwaway. A key this code does not recognise is treated as a real one, because
    # the cost of being wrong in that direction is one confusing error message and the cost
    # of being wrong in the other is a production credential posted to a stranger's host.
    if _origin(base_url) != TRUSTED_ORIGIN and not api_key.startswith(TEST_KEY_PREFIX):
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
                   summary, args: argparse.Namespace, came_from: str | None = None) -> None:
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
        # Whichever way the work arrived. Told by main(), which knows the actual file the
        # drop resolved to; derived here when a test builds a receipt directly.
        "work_file": came_from or str(args.work_file or args.work_drop),
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

    # One name for wherever the work came from. Three places downstream printed
    # `args.work_file`, which is None on the drop path, so a receipt would have recorded
    # `"work_file": "None"` and the ceiling refusal would have told an operator to go and
    # check a file called None.
    if args.work_drop is not None:
        source = DropSource(args.work_drop, max_age_hours=args.drop_max_age_hours)
        try:
            came_from = str(source.newest())
        except SourceError as err:
            print(f"Could not read the work file: {err}", file=sys.stderr)
            return 2
    else:
        source = CsvSource(args.work_file)
        came_from = str(args.work_file)
    try:
        items = list(source.items())
    except SourceError as err:
        print(f"Could not read the work file: {err}", file=sys.stderr)
        return 2
    if args.limit is not None:
        items = items[: args.limit]

    client, mode, double = _client_and_mode(args)

    # The size of the thing, checked before any of it happens.
    #
    # It covers the whole live branch rather than only the runs that reach production. A
    # live run against the bundled double spends nothing, but it is a rehearsal of the real
    # thing, and a rehearsal that quietly omits the size of the run is rehearsing something
    # else. It also means the guard is exercised by the suite instead of only in the one
    # situation nobody wants to test in.
    #
    # The offline default is exempt. It phones nobody and dials nothing, so a ceiling there
    # would cap a demonstration rather than any spend, and it is the run a reviewer executes.
    # Rows are not calls. A family that never consented is never dialled, and neither is one
    # the telephone cannot reach; both are gates inside the dispatcher and both come back as
    # SKIPPED with no call placed. Counting rows would refuse runs that were never going to
    # spend anything, and would print a number of families nobody was going to phone. The
    # two conditions are the dispatcher's own, and `test_the_ceiling_counts_calls_not_rows`
    # fails if they ever stop agreeing.
    #
    # A ceiling of zero or less refuses every live run. That is nonsense to ask for and it
    # fails closed, so it is left to mean what it says rather than guarded again.
    would_dial = [i for i in items if i.consented and i.reachable_by_voice]
    ceiling = DEFAULT_CALL_CEILING if args.max_calls is None else args.max_calls
    if mode.live and len(would_dial) > ceiling:
        raise SystemExit(
            f"This run would phone {len(would_dial)} families, more than the {ceiling}-call "
            f"ceiling.\nNothing has been dialled.\n"
            f"If {came_from} is the file you meant, say the number on purpose:\n"
            f"  --max-calls {len(would_dial)}\n"
            "If it is not the file you meant, --limit takes the first N rows instead."
        )

    print(mode.banner())
    print(f"{len(items)} row(s) from {came_from}, concurrency {args.concurrency}.")
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
        webhook_url=args.webhook_url,
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
            # The window this run judged its escalations against, and whether anybody
            # chose it. A machine reader that cannot tell a district's agreed clock from
            # this project's default will report one as the other.
            "safeguarding_minutes": args.safeguarding_minutes,
            "safeguarding_minutes_is_default":
                args.safeguarding_minutes == SAFEGUARDING_CALLBACK_MINUTES,
        }, indent=2))
    else:
        _print_human(report, summary, args.safeguarding_minutes)

    if args.receipt:
        _write_receipt(args.receipt, report=report, mode=mode, summary=summary, args=args, came_from=came_from,
                       api_responded=dispatcher.api_responded)
        print(f"\nReceipt written to {args.receipt}")

    return 1 if report.fatal_error else 0


def _print_human(report: DispatchReport, summary, safeguarding_minutes: int) -> None:
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
        # A skip that leaves work behind must not print the same four characters as a
        # skip that closes it.
        if result.needs_another_channel:
            marker = "HUMAN"
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
            # Which number, and whose. A report that prints a window without saying
            # where it came from lets a district read its own policy into a default it
            # never set.
            whose = ("this project's default, which no district has agreed to"
                     if safeguarding_minutes == SAFEGUARDING_CALLBACK_MINUTES
                     else "the window you passed on the command line")
            print(f"  A school would have to answer these within "
                  f"{safeguarding_minutes} minutes ({whose}).")
        for result in queue:
            flag = "!! " if result.escalation is not Escalation.NONE else "   "
            print(f"  {flag}{result.item.id:12s} {result.reason}")


if __name__ == "__main__":
    raise SystemExit(main())
