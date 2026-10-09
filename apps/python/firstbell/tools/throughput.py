"""How long a morning takes, from the length of the calls that were actually placed.

An attendance office has a cutoff. North Carolina's is a school-set time and 09:15 is a
common one, so a run that starts at 08:00 has about seventy-five minutes. Whether this
software fits in that window is not a design opinion, it is a division, and the numerator
is the only quantity here nobody can choose: how long a call to a parent takes.

So it is measured. Every receipt under `--receipts` carries CALL-E's own turn offsets, and
the last offset in a transcript is when the conversation stopped. That is the wall time a
worker was occupied, and a worker occupied is a worker not dialling the next family.

    python tools/throughput.py --receipts PATH/TO/RECEIPTS --pupils 500

The poll interval is added once per call, because a worker asks `calls.get` every two
seconds and in the worst case the call ended just after it asked. That is the whole of the
polling cost: two seconds a call, not the ninety minutes an event-driven design would be
sold against. What costs the ninety minutes is the concurrency cap, and the cap is there
because CALL-E cannot recall a call it has accepted.

`docs/adr/adr-0003-controlled-wave-concurrency-and-hybrid-reconciliation.md` is the record
of that decision and of the webhook design that is not built.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))


def _poll_seconds() -> float:
    """The interval `WaveDispatcher` actually waits, read off its own signature.

    Not written down here. A number copied into a second file is a number that will
    disagree with the first one, and this whole tool exists to stop a throughput claim
    from being an assumption.
    """
    import inspect

    from dispatch.scheduler import WaveDispatcher

    default = inspect.signature(WaveDispatcher.__init__).parameters[
        "poll_interval_seconds"].default
    if not isinstance(default, (int, float)):
        raise SystemExit(
            "WaveDispatcher no longer has a numeric poll_interval_seconds default, so the "
            "wait between polls cannot be read from the code that does the waiting.")
    return float(default)


POLL_SECONDS = _poll_seconds()


def call_lengths(receipts: Path) -> list[float]:
    """The last turn offset of every call in every receipt, in seconds.

    A call with no timed turns contributes nothing rather than a zero. Zero would be a
    claim that a call took no time, which would pull the mean down with the very calls
    this cannot measure.
    """
    out: list[float] = []
    for path in sorted(receipts.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for item in payload.get("items") or []:
            offsets = [turn.get("offset_seconds") for turn in (item.get("transcript") or [])
                       if isinstance(turn.get("offset_seconds"), (int, float))]
            if offsets:
                out.append(float(max(offsets)))
    return out


def minutes(pupils: int, concurrency: int, seconds_per_call: float) -> float:
    """Wall-clock minutes for one wave. Ceilings the wave count, because a partial wave
    still occupies the whole of one call's time."""
    waves = -(-pupils // concurrency)
    return waves * seconds_per_call / 60.0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    # Optional, for the reason replay_escalation.py gives: a reviewer running the command
    # the README prints has no receipts, and that is not a usage error.
    ap.add_argument("--receipts", type=Path, default=os.environ.get("FIRSTBELL_RECEIPTS"),
                    help="A directory of run receipts. Their transcripts are the source.")
    ap.add_argument("--pupils", type=int, default=500,
                    help="Absences in one morning. 500 is a large secondary school.")
    ap.add_argument("--cutoff-minutes", type=int, default=75,
                    help="Minutes between the run starting and the attendance cutoff.")
    ap.add_argument("--concurrency", type=int, nargs="*",
                    default=[3, 4, 12, 25],
                    help="The caps to report. 3 is the default and 4 the documented max.")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if not args.receipts:
        print("COULD-NOT-MEASURE  no receipts directory given. Every number this prints is\n"
              "                   derived from how long real calls actually took, and there\n"
              "                   is no default worth guessing. Pass --receipts DIR or set\n"
              "                   FIRSTBELL_RECEIPTS. The recordings are deliberately not in\n"
              "                   this repository; the table this computes is in README.md\n"
              "                   under the throughput heading, measured.")
        return 3

    lengths = call_lengths(args.receipts)
    if not lengths:
        print(f"COULD-NOT-MEASURE  no timed transcript in any receipt under "
              f"{args.receipts}. Nothing here\n"
              "                   can be computed from an assumption, so nothing is printed.")
        return 3

    mean = statistics.mean(lengths)
    per_call = mean + POLL_SECONDS
    rows = [(c, minutes(args.pupils, c, per_call)) for c in args.concurrency]

    if args.json:
        print(json.dumps({
            "calls_measured": len(lengths),
            "mean_call_seconds": round(mean, 1),
            "median_call_seconds": round(statistics.median(lengths), 1),
            "longest_call_seconds": round(max(lengths), 1),
            "poll_seconds": POLL_SECONDS,
            "pupils": args.pupils,
            "cutoff_minutes": args.cutoff_minutes,
            "minutes_by_concurrency": {str(c): round(m, 1) for c, m in rows},
            "lowest_concurrency_that_fits": next(
                (c for c, m in sorted(rows) if m <= args.cutoff_minutes), None),
        }, indent=2))
        return 0

    print(f"{len(lengths)} real call(s) measured from their own turn offsets.")
    print(f"  mean {mean:.1f}s, median {statistics.median(lengths):.1f}s, "
          f"longest {max(lengths):.1f}s")
    print(f"  plus one {POLL_SECONDS:.0f}s poll interval a call, worst case, "
          f"so {per_call:.1f}s a worker a call")
    print()
    print(f"{args.pupils} absences in one morning, against a {args.cutoff_minutes}-minute "
          "window:")
    for cap, mins in rows:
        verdict = "fits" if mins <= args.cutoff_minutes else "MISSES THE CUTOFF"
        print(f"  concurrency {cap:>3}   {mins:6.1f} min   {verdict}")
    fits = next((c for c, m in sorted(rows) if m <= args.cutoff_minutes), None)
    print()
    if fits is None:
        print("None of these caps fits the window. The cap is the brake and the brake is "
              "the cost.")
    else:
        print(f"The lowest cap here that fits is {fits}. Raising the cap is the operational "
              "answer,\nand it is a decision about how many families this dials at once "
              "with no way to\nrecall any of them, which is why it is a flag and not a "
              "default.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
