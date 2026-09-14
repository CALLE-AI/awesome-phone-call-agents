"""Five integers from twelve real calls, written where a judge can check them.

The receipts of the twelve calls placed against `api.heycall-e.com` are not in this
repository and will not be. `evidence/README.md` says why: the maintainer of the list this
entry is submitted to has required contributors to remove committed real-call transcripts
and real-call-derived artifacts, including where the people on the call were team members
playing a part and the numbers dialled were reserved. That describes these calls exactly,
so the recordings live on the linked evidence page instead.

That left the only measured money figure in the entry unauditable from the published
artifact. Every reproducible row in `tools/money_across_runs.py` comes from an offline run
whose outcome mix is written down in `firstbell/scenario.py`, so its numerator was chosen.
The rows that measure anything came from files a reader cannot open.

This writes the part a repository can hold, at the same line `evidence/api-shape.json`
draws: counts and nothing else. No conversation, no telephone number, no call id, no field
value, no name, no locale, no timestamp. Five integers and the date they were read. A
reader can divide them and get the same $0.43 the entry publishes, and a reader who has the
receipts can run this again and find out if it drifted.

De-duplication by call id happens here and the ids do not survive into the file.
`02-idempotent-replay-no-calls.json` records the same two call ids as `01`, because the
point of that receipt is that a second run of the same work file places no call. Summing
the receipts would count those two twice and print twelve calls as fourteen, which is the
class of arithmetic this whole directory exists to catch.

    python tools/pool_recorded_calls.py --receipts PATH/TO/RECEIPTS

Run it with no argument and it reads `FIRSTBELL_RECEIPTS`. Without either it prints what is
committed and exits, so the default is never a silent rewrite.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))
if str(APP / "tools") not in sys.path:
    sys.path.insert(0, str(APP / "tools"))

TARGET = APP / "evidence" / "recorded-calls.json"


def dedup_key(item: dict) -> tuple[str, str] | None:
    """What makes two receipt rows the same call.

    The receipt writes two identifiers per row: `id` is the pupil, `call_id` is CALL-E's id
    for the call. Every de-duplicator here read `id` into a variable named `call_id`, while
    `evidence/recorded-calls.json` published `de_duplicated_by: "call id"` and the block
    below justified its arithmetic with the same sentence. On the recorded set the two keys
    agree, because the only rows that repeat are an idempotency replay sharing both. They
    part company as soon as one child is telephoned twice, which `--again LABEL` exists to
    do and which a second day's export does by itself, and then two separately billed calls
    become one and leave `calls`, `answered`, `attempts_billed` and every derived rate.

    A row that was refused before dialling has no call id and never rang. It is keyed on the
    pupil instead, under a tag that cannot collide with a call id, so it still de-duplicates
    against itself and never merges with a call that did ring.
    """
    call_id = item.get("call_id")
    if call_id:
        return ("call", str(call_id))
    pupil = item.get("id")
    return ("no-call", str(pupil)) if pupil is not None else None


def distinct_items(receipts_dir: Path) -> list[dict]:
    """Every call that rang, once each, in the order the first receipt recorded it."""
    seen: dict[tuple[str, str], dict] = {}
    for path in sorted(receipts_dir.glob("0*.json")):
        run = json.loads(path.read_text(encoding="utf-8"))
        if not run.get("reached_production_api"):
            continue
        for item in run.get("items") or []:
            key = dedup_key(item)
            if key is not None and key not in seen:
                seen[key] = item
    return list(seen.values())


def per_receipt(receipts_dir: Path) -> list[dict]:
    """The same counts, one block per receipt that reached the production API.

    The pooled row is the honest headline and it is not what the page cites. Act 04 names
    one receipt in particular, "a third run: 3 of 7 attempts removed", and offered
    `tools/money_across_runs.py` as the way to check it while that tool printed three
    offline runs and the pool. A reader who takes the invitation finds no such row.

    De-duplication is per receipt here rather than across them, because the question each
    row answers is what that run did. The pooled row is the one that must not count a call
    twice, and it still does not.
    """
    from money_across_runs import _counts_from_items

    out: list[dict] = []
    for path in sorted(receipts_dir.glob("0*.json")):
        run = json.loads(path.read_text(encoding="utf-8"))
        if not run.get("reached_production_api"):
            continue
        seen: dict[tuple[str, str], dict] = {}
        for item in run.get("items") or []:
            key = dedup_key(item)
            if key is not None and key not in seen:
                seen[key] = item
        items = list(seen.values())
        if not items:
            continue
        billed, removed, answered, net_new, escalated = _counts_from_items(
            items, refile=True)
        # What this run was billed, which is not the same as what its rows carry.
        #
        # `_counts_from_items` sums `attempts` off every item and that is correct for the
        # pooled block, because pooling de-duplicates by call id first and the replay's
        # rows never reach it. A row per receipt does not de-duplicate, and
        # `02-idempotent-replay-no-calls.json` holds two rows with `placed_by_this_run:
        # false` and one attempt each. Reported as two billed attempts it would price a
        # run whose whole argument is that an idempotency key placed no call and cost
        # nothing. So the two attempt figures are recomputed over the rows this run
        # actually placed, and a replay reads zero.
        placed = [item for item in items if item.get("placed_by_this_run") is not False]
        if len(placed) != len(items):
            billed, removed, _, _, _ = _counts_from_items(placed, refile=True)
        out.append({
            "receipt": path.name,
            "calls": len(items),
            "placed_by_this_run": len(placed),
            "attempts_billed": billed,
            "attempts_removed": removed,
            "answered": answered,
            "net_new_escalations": net_new,
            "escalated": escalated,
        })
    return out


def counts(receipts_dir: Path) -> dict:
    """The counts under today's code, and the two the receipts recorded.

    Re-filed, because a money figure is a claim about the software a district would be
    buying and not about the version that placed the calls. The difference is one call:
    `04-defect-a-refusal-scored-resolved.json` records this app reading a schema-valid
    result whose every required field said "unknown" and writing `resolved`. That receipt
    is committed uncorrected on purpose. Counting its `resolved` into a ceiling would
    price a defect that has been fixed.

    Both are written down. A reader who runs `tools/replay_escalation.py` gets the re-filed
    number and a reader who opens a receipt gets the recorded one, and a file that carried
    only one of them would leave them to discover the gap.
    """
    from money_across_runs import _counts_from_items

    items = distinct_items(receipts_dir)
    billed, removed, answered, net_new, escalated = _counts_from_items(items, refile=True)
    _, was_removed, _, was_net_new, _ = _counts_from_items(items)
    return {
        "calls": len(items),
        "attempts_billed": billed,
        "attempts_removed": removed,
        "answered": answered,
        "net_new_escalations": net_new,
        # Every call the safeguarding rule marked, not only the ones it created work on.
        # A district asked for the figure that holds if our reading of "would have closed
        # on its own" is wrong every time, and it cannot be computed without this count.
        "escalated": escalated,
        "attempts_removed_as_recorded": was_removed,
        "net_new_escalations_as_recorded": was_net_new,
    }


def document(receipts_dir: Path, read_at: str) -> dict:
    return {
        "what_this_is": (
            "Counts over the twelve calls pooled from the receipts this file names, "
            "which is not every call this software has placed: the evidence page publishes "
            "twenty, being eight of these twelve (the locale experiment of receipts 05 and "
            "06) plus twelve more placed on 2026-09-11. Against "
            "api.heycall-e.com. No conversation, no telephone number, no call id, no "
            "field value: the same line evidence/api-shape.json draws, for the same "
            "reason, which is that the receipts themselves are not committed and "
            "evidence/README.md says why."),
        "why_it_is_here": (
            "It is the only numerator in this entry that nobody chose. Every offline run "
            "takes its outcome mix from firstbell/scenario.py, which is what makes those "
            "runs reproducible and also means their money figures are a worked example "
            "rather than a measurement."),
        "de_duplicated_by": (
            "call id, discarded before writing. Two receipts record the same two calls, "
            "because one of them is the replay that placed none."),
        "filed_under": (
            "today's code, by tools/replay_escalation.py, and not by the resolution each "
            "receipt recorded. One call differs: S-3004 was written resolved by a version "
            "of this app that read a schema-valid result with every required field set to "
            "unknown and closed the record. Today it files as undetermined. The recorded "
            "numbers are kept beside the re-filed ones because that receipt is committed "
            "uncorrected and the difference between the two is the defect."),
        "placed_on": "2026-09-04",
        "read_at": read_at,
        "regenerate_with": "python tools/pool_recorded_calls.py --receipts DIR",
        "counts": counts(receipts_dir),
        # One block per receipt, so the row act 04 cites is a row the tool prints. The
        # pooled block above is still the only de-duplicated one.
        "per_receipt": per_receipt(receipts_dir),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--receipts", default=os.environ.get("FIRSTBELL_RECEIPTS"),
                    help="directory holding the committed-nowhere call receipts")
    ap.add_argument("--check", action="store_true",
                    help="compare against the committed file and exit non-zero on drift")
    args = ap.parse_args(argv)

    if not args.receipts:
        if TARGET.exists():
            print(TARGET.read_text(encoding="utf-8"), end="")
            print(f"\n# read from {TARGET.name}. Pass --receipts DIR to recompute.",
                  file=sys.stderr)
            return 0
        print("no receipts directory and nothing committed to read", file=sys.stderr)
        return 2

    receipts_dir = Path(args.receipts)
    if not receipts_dir.is_dir():
        print(f"{receipts_dir} is not a directory", file=sys.stderr)
        return 2

    fresh = counts(receipts_dir)
    if args.check:
        if not TARGET.exists():
            print(f"{TARGET.name} is missing", file=sys.stderr)
            return 1
        held = json.loads(TARGET.read_text(encoding="utf-8"))["counts"]
        if held != fresh:
            print(f"drift:\n  committed {held}\n  receipts  {fresh}", file=sys.stderr)
            return 1
        print(f"{TARGET.name} matches the receipts: {fresh}")
        return 0

    read_at = dt.date.today().isoformat()
    if TARGET.exists():
        # Keep the original read date unless the numbers moved, so a rerun that changes
        # nothing does not put a fresh date on an unchanged file. A date that advances on
        # its own is how a stale figure looks current.
        held = json.loads(TARGET.read_text(encoding="utf-8"))
        if held.get("counts") == fresh:
            read_at = held.get("read_at", read_at)
    TARGET.write_text(json.dumps(document(receipts_dir, read_at), indent=2) + "\n",
                      encoding="utf-8", newline="\n")
    print(f"wrote {TARGET.relative_to(APP)}: {fresh}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
