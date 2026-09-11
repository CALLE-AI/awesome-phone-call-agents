"""QuoteRunner — build a vetted call list before anyone dials.

Every call app in this repository starts from a list somebody already had: a
fixture, a CSV, a study file, a hand-written plan. None of them answer the
question that comes first — who should I even call?

QuoteRunner answers it. Give it a job and an area; it returns candidates that
exist, publish a number, and are open right now, each with the calling window
derived from their published opening hours rather than configured by hand.

Then it calls them through CALL-E and puts what they said in one table.

    python quoterunner.py --fixture example-candidates.json
    python quoterunner.py --fixture example-candidates.json --simulate
    python quoterunner.py --fixture example-candidates.json --execute \
        --confirm <token>

Preview is the default and places no calls. `--simulate` runs the whole
pipeline against canned answers. Only `--execute` dials, and it needs
CALLE_LIVE_CALLS_ENABLED=true, CALLE_API_KEY, and a confirmation token bound to
this exact candidate list. See execution.py.

This module has no dependencies and never imports the SDK: screening is
provider-agnostic and stays testable without credentials.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

__version__ = "1.0.0"

# Numbers are masked everywhere, including errors. A test asserts that no full
# number reaches any output path.
_E164 = re.compile(r"^\+[1-9]\d{7,14}$")

DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

# Hard caps. Not configurable from the command line on purpose: a limit the
# caller can raise mid-run is not a limit.
MAX_CANDIDATES_PER_RUN = 12


class PlanError(Exception):
    """Raised when a plan cannot be built. Messages never contain a full number."""


def mask(phone: str) -> str:
    """+15550100 -> +15*****00. Used in every output path, errors included."""
    if not phone:
        return "(none)"
    digits = re.sub(r"[^\d+]", "", phone)
    if len(digits) <= 5:
        return "+" + "*" * max(len(digits) - 1, 1)
    return digits[:3] + "*" * (len(digits) - 5) + digits[-2:]


def validate_e164(phone: str) -> str:
    """Reject anything that is not already E.164. We never reformat a number:
    guessing a country code is how you call a stranger in another country."""
    cleaned = re.sub(r"[\s()\-.]", "", phone or "")
    if not _E164.match(cleaned):
        raise PlanError(f"Not a valid E.164 number: {mask(cleaned)}")
    return cleaned


# ---------------------------------------------------------------------------
# Opening hours
# ---------------------------------------------------------------------------
def _day_windows(opening_hours: str, weekday: int) -> list[tuple[time, time]]:
    """Parse an OpenStreetMap opening_hours value into windows for one weekday.

    'Mo-Fr 09:00-14:00,16:00-20:00; Sa 10:00-14:00' is the common shape.
    Anything we cannot parse yields no window, which means closed. Preferring
    "closed" over an optimistic parse is the whole point: a wrong guess here
    calls a real person at three in the morning.
    """
    if not opening_hours:
        return []
    if opening_hours.strip() == "24/7":
        return [(time(0, 0), time(23, 59))]

    day = DAYS[weekday]
    windows: list[tuple[time, time]] = []

    for chunk in opening_hours.split(";"):
        match = re.match(r"^\s*([A-Za-z,\-]+)\s+(.+?)\s*$", chunk)
        if not match:
            continue
        day_spec, hour_spec = match.group(1), match.group(2)
        if "off" in hour_spec.lower():
            continue

        applies = False
        for part in day_spec.split(","):
            if "-" in part:
                start, _, end = part.partition("-")
                if start in DAYS and end in DAYS:
                    i, j = DAYS.index(start), DAYS.index(end)
                    if (i <= j and i <= weekday <= j) or (i > j and (weekday >= i or weekday <= j)):
                        applies = True
            elif part == day:
                applies = True
        if not applies:
            continue

        for span in hour_spec.split(","):
            hm = re.match(r"^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$", span)
            if not hm:
                continue
            h1, m1, h2, m2 = (int(g) for g in hm.groups())
            if h1 < 24 and h2 <= 24:
                windows.append((time(h1, m1), time(min(h2, 23), m2 if h2 < 24 else 59)))

    return windows


def is_open(opening_hours: str, moment: datetime) -> bool:
    windows = _day_windows(opening_hours, moment.weekday())
    now = moment.time()
    return any(start <= now <= end for start, end in windows)


def window_text(opening_hours: str, moment: datetime) -> str:
    windows = _day_windows(opening_hours, moment.weekday())
    if not windows:
        return "closed today"
    return ", ".join(f"{s.strftime('%H:%M')}-{e.strftime('%H:%M')}" for s, e in windows)


# ---------------------------------------------------------------------------
# Candidates
# ---------------------------------------------------------------------------
@dataclass
class Candidate:
    name: str
    phone: str
    opening_hours: str = ""
    address: str = ""
    locality: str = ""
    source_id: str = ""
    # IANA name, e.g. America/Chicago. Never inferred from the phone number,
    # the country code or the locale: see local_now.
    timezone: str = ""

    verdict: str = ""
    reason: str = ""
    notes: list[str] = field(default_factory=list)

    @property
    def masked(self) -> str:
        return mask(self.phone)


def local_now(candidate: Candidate, moment: datetime | None = None) -> datetime:
    """What time it is *where the business is*.

    Opening hours are published in the shop's own local time. Reading them
    against the host clock is wrong by however far apart the two are: a machine
    in Mexico City reading hours for a shop in Austin is an hour out, and one in
    Europe is seven. That is how you ring a closed shop, or a person asleep.

    The zone has to be published. It is never derived from the phone number,
    the country code or the locale -- those are guesses, and a guess here calls
    a stranger at three in the morning.
    """
    base = moment or datetime.now()
    if base.tzinfo is None:
        base = base.astimezone()  # the host's own offset, made explicit

    if not candidate.timezone:
        return base

    try:
        return base.astimezone(ZoneInfo(candidate.timezone))
    except (ZoneInfoNotFoundError, KeyError, ValueError):
        # Minimal Windows installs ship no IANA database. Falling back to host
        # time silently would reintroduce the bug, so the caller is told.
        raise PlanError(
            f"Unknown timezone {candidate.timezone!r}. "
            "On Windows this usually means the IANA database is missing: "
            "pip install tzdata"
        ) from None


def load_fixture(path: Path) -> list[Candidate]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return [Candidate(**row) for row in payload["candidates"]]


def screen(
    candidates: list[Candidate],
    moment: datetime,
    *,
    default_timezone: str = "",
    require_timezone: bool = False,
) -> tuple[list[Candidate], list[Candidate]]:
    """Split candidates into callable and excluded, recording why for each.

    Exclusions are part of the output, not a silent filter. A run that quietly
    dropped half its candidates looks identical to one that found nothing.

    `default_timezone` is the operator stating the zone for a batch they know is
    single-region. That is a declaration, not a guess, so it is allowed.
    `require_timezone` is set on the live path: a candidate whose local time we
    cannot establish is excluded rather than dialled, for the same reason one
    with no published hours is.
    """
    callable_now: list[Candidate] = []
    excluded: list[Candidate] = []

    for candidate in candidates:
        try:
            candidate.phone = validate_e164(candidate.phone)
        except PlanError as error:
            candidate.verdict = "excluded"
            candidate.reason = str(error)
            excluded.append(candidate)
            continue

        if not candidate.timezone and default_timezone:
            candidate.timezone = default_timezone

        try:
            here = local_now(candidate, moment)
        except PlanError as error:
            candidate.verdict = "excluded"
            candidate.reason = str(error)
            excluded.append(candidate)
            continue

        if not candidate.opening_hours:
            candidate.verdict = "excluded"
            candidate.reason = "no published opening hours -- we do not call blind"
        elif require_timezone and not candidate.timezone:
            candidate.verdict = "excluded"
            candidate.reason = (
                "no timezone published -- cannot tell what time it is there. "
                "Pass --timezone if the whole batch is in one region"
            )
        elif not is_open(candidate.opening_hours, here):
            today = window_text(candidate.opening_hours, here)
            candidate.verdict = "excluded"
            candidate.reason = (
                "closed today" if today == "closed today" else f"closed now (open today {today})"
            )
        else:
            candidate.verdict = "callable"
            where = f" {candidate.timezone}" if candidate.timezone else ""
            candidate.reason = (
                f"open now ({window_text(candidate.opening_hours, here)}{where})"
            )
            callable_now.append(candidate)
            continue

        excluded.append(candidate)

    if len(callable_now) > MAX_CANDIDATES_PER_RUN:
        for extra in callable_now[MAX_CANDIDATES_PER_RUN:]:
            extra.verdict = "excluded"
            extra.reason = f"over the {MAX_CANDIDATES_PER_RUN}-candidate cap for one run"
            excluded.append(extra)
        callable_now = callable_now[:MAX_CANDIDATES_PER_RUN]

    return callable_now, excluded


# ---------------------------------------------------------------------------
# Call plan
# ---------------------------------------------------------------------------
QUESTIONS = [
    "the price or price range for the job, and the currency",
    "the earliest date they could do it",
    "roughly how long the job itself takes",
    "whether the price covers parts and labour, or labour only",
    "whether any warranty is included, and for how long",
]

SCRIPT = """You are calling {name} on behalf of {requester}, a potential customer.

Be brief and polite. This is an ordinary customer enquiry, not a sales call.

Say who you are calling for, then ask about this job:

    {job}

Find out only these:
{questions}

Rules:
- If they are busy or ask you to call back, thank them and end the call. Do not insist.
- If they ask whether you are an AI assistant, say yes, plainly, and say you are
  calling on behalf of {requester}.
- If they ask not to be called again, confirm that and end the call.
- Do not agree to anything, do not book anything, do not give payment details.
- If a question cannot be answered, record it as unknown. Do not guess.

Return the answers as structured data."""


def build_script(candidate: Candidate, job: str, requester: str) -> str:
    numbered = "\n".join(f"  {i}. {q}" for i, q in enumerate(QUESTIONS, 1))
    return SCRIPT.format(
        name=candidate.name, requester=requester, job=job.strip(), questions=numbered
    )


def build_plan(
    candidates: list[Candidate], job: str, requester: str, moment: datetime,
    *, default_timezone: str = "", require_timezone: bool = False,
) -> dict:
    callable_now, excluded = screen(
        candidates, moment,
        default_timezone=default_timezone, require_timezone=require_timezone,
    )
    if not callable_now:
        raise PlanError("No candidate is callable right now. Nothing was planned.")

    return {
        "job": job,
        "requester": requester,
        "planned_at": moment.isoformat(timespec="seconds"),
        "no_call_placed": True,
        "calls": [
            {
                "name": c.name,
                "phone_masked": c.masked,
                "timezone": c.timezone or "(host local time)",
                "calling_window_today": window_text(
                    c.opening_hours, local_now(c, moment)
                ),
                "script": build_script(c, job, requester),
            }
            for c in callable_now
        ],
        "excluded": [
            {"name": c.name, "phone_masked": c.masked, "reason": c.reason} for c in excluded
        ],
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def render(plan: dict, token: str = "") -> str:
    lines = [
        "PREVIEW -- NO CALL PLACED",
        "Nothing was dialed. No credentials were read and no request was sent.",
        "",
        f"Job: {plan['job']}",
        f"Callable now: {len(plan['calls'])}    Excluded: {len(plan['excluded'])}",
        "",
    ]
    for i, call in enumerate(plan["calls"], 1):
        lines.append(f"{i}. {call['name']}  {call['phone_masked']}")
        lines.append(f"     open today: {call['calling_window_today']}")
    if plan["excluded"]:
        lines.append("")
        lines.append("Not called:")
        for item in plan["excluded"]:
            lines.append(f"   - {item['name']}  {item['phone_masked']}  ->  {item['reason']}")
    if token:
        lines += [
            "",
            "Read that list. If it is who you meant to call:",
            "",
            f"    --simulate                    see the comparison, no calls",
            f"    --execute --confirm {token}   place the calls",
            "",
            "The token covers this exact list. Re-plan later and it changes.",
        ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="quoterunner", description=__doc__.split("\n")[0]
    )
    parser.add_argument("--fixture", required=True, type=Path, help="Candidate fixture JSON")
    parser.add_argument("--job", help="What you want quoted (defaults to the fixture's job)")
    parser.add_argument("--requester", help="Name spoken on the call")
    parser.add_argument("--at", help="ISO timestamp to evaluate opening hours against")
    parser.add_argument("--json", action="store_true", help="Emit the plan as JSON")

    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--simulate", action="store_true",
                      help="Run the whole pipeline against canned answers. No calls.")
    mode.add_argument("--execute", action="store_true",
                      help="Place real calls through CALL-E. Needs --confirm.")
    parser.add_argument("--confirm", help="Confirmation token printed by the preview")
    parser.add_argument("--locale", default="en-US", help="Locale spoken on the call")
    parser.add_argument("--timezone", default="",
                        help="IANA zone for candidates that publish none, e.g. "
                             "America/Chicago. Only state it for a batch you know "
                             "is in one region; it is never inferred")
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--base-url", help="Override the CALL-E origin (loopback only, for tests)")
    args = parser.parse_args(argv)

    payload = json.loads(args.fixture.read_text(encoding="utf-8"))
    job = args.job or payload.get("job", "")
    requester = args.requester or payload.get("requester", "the customer")
    moment = datetime.fromisoformat(args.at) if args.at else datetime.now()

    try:
        candidates = load_fixture(args.fixture)
        # The live path refuses a candidate whose local time is unknown. The
        # preview does not, so you can still see the batch and be told what is
        # missing before you try to dial it.
        plan = build_plan(candidates, job, requester, moment,
                          default_timezone=args.timezone,
                          require_timezone=args.execute)
    except PlanError as error:
        print(f"No plan: {error}", file=sys.stderr)
        return 1

    # `build_plan` already screened them; re-reading the verdict avoids
    # screening twice and guarantees the batch we dial is the batch we showed.
    callable_now = [c for c in candidates if c.verdict == "callable"]

    # Imported here, not at module scope: execution.py imports this module, and
    # the preview path must never pull in anything the screening layer does not
    # need.
    import execution

    token = execution.confirmation_token(callable_now, job, requester, args.locale)

    if not (args.simulate or args.execute):
        print(json.dumps(plan, indent=2) if args.json else render(plan, token))
        return 0

    try:
        if args.execute:
            execution.check_confirmation(callable_now, job, args.confirm,
                                        requester, args.locale)
            calls = execution.build_calls_api(args.base_url)
        else:
            calls = execution.SimulatedCalls()
    except execution.QuoteError as error:
        print(f"\n{error}\n", file=sys.stderr)
        return 1

    results = execution.run_batch(
        callable_now, job, requester, calls,
        moment=moment if args.at else None,
        locale=args.locale,
        timeout_seconds=args.timeout_seconds,
        on_event=execution.progress,
    )
    table = execution.compare(results)

    if args.json:
        print(json.dumps({"job": job, "simulated": args.simulate, "results": results,
                          "cheapest": table["cheapest"]}, indent=2))
    else:
        print()
        print(execution.render_comparison(job, table, simulated=args.simulate))
    return 0


if __name__ == "__main__":
    sys.exit(main())
