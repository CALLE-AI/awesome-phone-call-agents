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
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dispatch import Escalation  # noqa: E402
from dispatch.validation import problems  # noqa: E402
from firstbell.domain import RESULT_SCHEMA, safeguarding_escalation  # noqa: E402

UNINFORMATIVE = frozenset({"unknown"})


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
            call_id = item.get("id")
            if not isinstance(result, dict) or not call_id:
                continue
            seen.setdefault(call_id, (result, path.name))
    return seen


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--receipts", required=True, type=Path,
                    help="directory of published run receipts")
    args = ap.parse_args(argv)

    if not args.receipts.is_dir():
        print(f"no such directory: {args.receipts}", file=sys.stderr)
        return 2

    seen = records(args.receipts)
    if not seen:
        # The failure that looks exactly like success. A wrong path reads zero receipts,
        # every claim below is then trivially true of nothing, and the exit code is what
        # says so.
        print(f"read 0 calls from {args.receipts}. Nothing was checked.", file=sys.stderr)
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
    if not moved:
        print()
        print("Nothing moved. Every call that did not confirm was already going to a "
              "person, because every required field had come back uninformative and the "
              "older rule had it first. The gap this rule closes is a parent who did not "
              "know and then gave a complete answer, and none of these calls is that.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
