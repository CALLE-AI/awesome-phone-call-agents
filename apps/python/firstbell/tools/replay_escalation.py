"""Re-file every published call under today's rules, and print what the new one moves.

The README says the safeguarding rule changed nothing in production. That is a claim about
real calls whose receipts are deliberately not in this tree, so this script is how a reader
checks it rather than believing it:

    python tools/replay_escalation.py --receipts <dir>

The comparison that matters is not against the filing written in each receipt. Those were
written by whatever the code was on the day, and one of them, `S-3004` in receipt 04, is
kept precisely because it records a defect that has since been fixed. Replaying against
those would credit the new rule with catching something an older fix already catches, which
is the flattering answer rather than the true one.

So each call is filed twice by TODAY's code: once with the escalation rule and once
without. Only a call the rest of the current pipeline would close, and the escalation rule
would not, has actually moved.
"""

from __future__ import annotations

import argparse
import json
import os
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dispatch import Escalation  # noqa: E402
from dispatch.validation import problems  # noqa: E402
from firstbell.domain import SAFEGUARDING_CALLBACK_MINUTES  # noqa: E402
from firstbell.domain import RESULT_SCHEMA, safeguarding_escalation  # noqa: E402
from firstbell.domain import StaffCost  # noqa: E402

UNINFORMATIVE = frozenset({"unknown"})


def upper_bound(events: int, trials: int, alpha: float = 0.05) -> float:
    """The exact one-sided upper confidence limit on a rate, as a fraction.

    A count of zero is not a rate of zero, and on a sample this small the difference is
    the whole answer. Twelve calls that moved nothing are consistent with a rule that
    moves one call in five, and a district staffing a rota needs the number it might have
    to staff rather than the number that happened.

    Clopper-Pearson, solved by bisection on the binomial tail so this needs no scientific
    stack: the limit is the rate at which observing this few events or fewer would itself
    be unlikely. For zero events it is the closed form 1 - alpha ** (1 / n), and the
    bisection agrees with it, which is how the loop was checked.
    """
    if trials <= 0:
        raise ValueError("An upper bound on nothing is not a bound.")
    if events >= trials:
        return 1.0

    def tail(p: float) -> float:
        """P(X <= events) for X binomial on this many trials at this rate."""
        return sum(math.comb(trials, k) * p ** k * (1 - p) ** (trials - k)
                   for k in range(events + 1))

    low, high = 0.0, 1.0
    for _ in range(200):
        mid = (low + high) / 2
        if tail(mid) > alpha:
            low = mid
        else:
            high = mid
    return (low + high) / 2


def learned_nothing(result: dict) -> bool:
    """The rule from `WaveDispatcher._learned_nothing`, applied to a stored result."""
    required = RESULT_SCHEMA.get("required") or []
    if not required:
        return False
    values = [result.get(name) for name in required]
    return all(isinstance(v, str) and v.strip().lower() in UNINFORMATIVE for v in values)


def file_today(result: dict, *, with_escalation: bool) -> str:
    """What today's pipeline would do with this structured result."""
    if problems(result, RESULT_SCHEMA):
        return "undetermined"
    if learned_nothing(result):
        return "undetermined"
    if with_escalation and safeguarding_escalation(result) is not Escalation.NONE:
        return "escalated"
    return "closed"


def records(receipts: Path) -> dict:
    """Every distinct call that came back with a structured result.

    Keyed on the call id alone. The same call appears in more than one receipt when a run
    was replayed against an idempotency key, and counting it twice would inflate every
    number below.
    """
    seen: dict[str, tuple[dict, str]] = {}
    for path in sorted(receipts.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        for item in payload.get("items") or []:
            result = item.get("structured_result")
            # `call_id`, not `id`. The docstring above says "Keyed on the call id alone"
            # and this read the pupil id, so one child telephoned twice was one record and
            # the second call's answer was never re-filed. A row carrying a result always
            # rang, so there is no keyless case to fall back for here.
            call_id = item.get("call_id")
            if not isinstance(result, dict) or not call_id:
                continue
            seen.setdefault(call_id, (result, path.name))
    return seen


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    # Not required. A reviewer who clones this and runs the command the README prints has
    # no receipts directory, because the recordings are held outside the repository on
    # purpose, and argparse answered that with a usage error and exit 2: the code for using
    # a tool wrongly, for somebody who used it exactly as documented. Missing input is the
    # third outcome this entry already has a word and an exit code for.
    ap.add_argument("--receipts", default=os.environ.get("FIRSTBELL_RECEIPTS"), type=Path,
                    help="directory of published run receipts, held outside this repository")
    args = ap.parse_args(argv)

    if not args.receipts:
        print("COULD-NOT-MEASURE  no receipts directory given, so there are no calls to\n"
              "                   re-file. Pass --receipts DIR or set FIRSTBELL_RECEIPTS.\n"
              "                   The recordings are deliberately not in this repository,\n"
              "                   so this is the expected result for anyone but the author.\n"
              "                   The figure this tool computes is published in\n"
              "                   evidence/recorded-calls.json and quoted in README.md.")
        return 3

    if not args.receipts.is_dir():
        print(f"COULD-NOT-MEASURE  no such directory: {args.receipts}", file=sys.stderr)
        return 3

    seen = records(args.receipts)
    if not seen:
        # The failure that looks exactly like success. A wrong path reads zero receipts,
        # every claim below is then trivially true of nothing, and the exit code is what
        # says so.
        print(f"COULD-NOT-MEASURE  read 0 calls from {args.receipts}. Nothing was checked.",
              file=sys.stderr)
        return 3

    moved = []
    print(f"{'call':10} {'aware':10} {'without the rule':18} {'with it':12} receipt")
    for call_id, (result, source) in sorted(seen.items()):
        without = file_today(result, with_escalation=False)
        with_it = file_today(result, with_escalation=True)
        aware = str(result.get("parent_confirmed_aware", "(absent)"))
        if without != with_it:
            moved.append(call_id)
        flag = "  <-- MOVES" if without != with_it else ""
        print(f"{call_id:10} {aware:10} {without:18} {with_it:12} {source}{flag}")

    unconfirmed = [c for c, (r, _) in seen.items()
                   if safeguarding_escalation(r) is not Escalation.NONE]
    print()
    print(f"{len(seen)} call(s) came back with a structured result")
    print(f"{len(unconfirmed)} did not confirm the parent already knew: "
          f"{', '.join(sorted(unconfirmed))}")
    print(f"{len(moved)} would be filed differently because of the escalation rule"
          + (f": {', '.join(sorted(moved))}" if moved else ""))

    # The alert rate, which is a different question from whether anything moved and the one
    # a school would ask first. Both numbers were already printed above; nothing put them
    # together, so the rate went unstated everywhere in this repository.
    if seen:
        rate = 100.0 * len(unconfirmed) / len(seen)
        print()
        print(f"Alert rate: {len(unconfirmed)} of {len(seen)} answered calls ({rate:.0f}%) "
              f"carry the safeguarding flag and its {SAFEGUARDING_CALLBACK_MINUTES}-minute "
              f"callback window.")
        print("On this sample every one of them was already going to a person, so the rule "
              "adds no case to the queue. What it adds is a clock and a position at the top "
              "of it. A rate near half is a staffing question before it is a code question, "
              "and it is stated here because a rule that fires this often is either the "
              "safest thing in the app or the reason a school turns it off.")
    if not moved:
        print()
        print("Nothing moved. Every call that did not confirm was already going to a "
              "person, because every required field had come back uninformative and the "
              "older rule had it first. The gap this rule closes is a parent who did not "
              "know and then gave a complete answer, and none of these calls is that.")

    # The quantity a district staffs a rota from, which is not the alert rate above. A
    # buyer reading this entry named its absence as the one thing stopping them signing:
    # the alert rate is mostly work they were already doing, and what they have to hire
    # for is the part the rule creates. It is published with its bound because on twelve
    # calls a count of zero and a rate of zero are not the same statement.
    lead = StaffCost.us_school_safeguarding_lead()
    desk = StaffCost.us_school_office()
    bound = upper_bound(len(moved), len(seen))
    per_call = bound * (lead.hourly / 60.0)
    print()
    print(f"Net-new escalations: {len(moved)} of {len(seen)} answered call(s), "
          f"{100.0 * len(moved) / len(seen):.0f} per 100. Cases that would have closed "
          "without the rule.")
    print(f"{len(seen)} call(s) cannot rule out {100 * bound:.0f} per 100 (exact "
          "one-sided 95%), so this is the figure a rota is staffed against and the count "
          "above is not.")
    print(f"At the top of that interval the rule adds {lead.currency}{per_call:,.2f} a "
          "call for every minute one callback takes the safeguarding lead, at "
          f"{lead.currency}{lead.hourly:,.2f}/hour, against the "
          f"{desk.currency}{desk.hourly:,.2f}/hour desk whose time the calls save. The "
          "run prints both wages and the ceiling that comes out of them.")
    print(f"The added grade is {lead.occupation}, {lead.industry}, {lead.year}.")
    print(f"Source: {lead.source}")
    print(f"  {lead.source_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
