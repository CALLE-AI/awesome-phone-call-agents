"""One ceiling per run, computed for every run this entry publishes.

A district buyer read the entry and found four different per-call figures on three
surfaces: $0.59 in the README, $0.50 on the deployed page, $0.78 on the consent example,
$0.21 after the added work. Every one of them is arithmetic the program printed, and the
entry never said out loud that they are four runs rather than four opinions. A buyer
cannot use a price that moves without a reason, and "it depends on the run" is worthless
unless the runs are on the table.

So they are. The ceiling is a division:

    attempts removed / attempts billed  x  desk wage per minute  x  minutes an attempt

The numerator is the attempts sitting behind records this run closed. A run that closes
more records per attempt removes more desk time per call, so the ceiling rises. Nothing
about the software changes between these rows: what changes is how many families picked
up and said something usable.

The same arithmetic then subtracts the work the safeguarding rule adds, at the counsellor
wage, because a run that hands three callbacks to the safeguarding lead has not saved the
desk time it removed. That second number is the one this entry leads with, everywhere.

Under the table is the other half, and it is new. For months this entry published a ceiling
and said no saving could be claimed because CALL-E publishes no price. That was true and
useless: a ceiling with no price beside it is a number a buyer cannot act on. This account
has now been billed, and `evidence/observed-price.json` records what for, including the
three things thirteen calls cannot tell anybody.

Run from the app directory:

    python tools/money_across_runs.py                 # the table
    python tools/money_across_runs.py --json          # the same numbers, machine-readable

`--receipts DIR` points it at the committed receipts, the same way the page builder is
pointed at them. Without it, only the runs this repository can reproduce offline appear,
which is the honest default: a receipt nobody can see is not evidence.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))
if str(APP / "tools") not in sys.path:
    sys.path.insert(0, str(APP / "tools"))

MINUTES_AN_ATTEMPT = 3.0

# The runs this repository can reproduce with one command, and the work file each one
# takes. A judge can run any of these; that is the point of listing them.
OFFLINE_RUNS = [
    ("the demo", "examples/absences.csv", []),
    ("with consent records", "examples/absences-with-consent.csv",
     ["--consent-records", "examples/consent-register.json"]),
    ("siblings on one number", "examples/absences-siblings.csv", []),
]


def _wages():
    from firstbell.domain import StaffCost
    return StaffCost.us_school_office(), StaffCost.us_school_safeguarding_lead()


def figures_for(placed: int, removed: int, answered: int, net_new: int,
                calls: int | None = None) -> dict:
    """The two ceilings and the crossover, from four integers.

    Every surface in this entry gets its numbers from here. The reason the arithmetic is
    in one function rather than three is that it was in three, and they printed $0.59,
    $0.50 and $0.78 with nothing beside them saying which run each belonged to.
    """
    desk, lead = _wages()
    from replay_escalation import upper_bound

    gross = None if not placed else (
        (removed / placed) * (desk.hourly / 60.0) * MINUTES_AN_ATTEMPT)
    # The rate a rota is staffed against is per answered call. The cost subtracted from a
    # per-billed-attempt saving has to be per billed attempt, or the subtraction is
    # between two unlike rates, which is what it was until a district finance office read
    # it. Both quantities are published, each labelled with its own denominator.
    rate = None if not answered else net_new / answered
    # Gated on `answered` and divided by `placed`, which is what `ImpactSummary` does and
    # for the reason this entry is built on: a run nobody picked up on has no evidence
    # about how much safeguarding work the rule creates, and the division would print
    # $0.00 and imply it creates none.
    added = None if (not placed or not answered) else (
        (net_new / placed) * (lead.hourly / 60.0) * MINUTES_AN_ATTEMPT)
    bound = upper_bound(net_new, answered) if answered else None
    # The worst case runs on the same denominator: the upper bound is a rate per answered
    # call, so it becomes a count of callbacks before it is charged against the attempts.
    worst = None if (bound is None or gross is None or not placed) else (
        gross - (bound * answered / placed) * (lead.hourly / 60.0) * MINUTES_AN_ATTEMPT)
    # Where the saving stops, from the two totals: net-new x lead wage = removed x desk
    # wage. Divided through by answered calls, because that is the denominator a rota is
    # staffed on. `firstbell/domain.py` derives the same number the same way.
    crossover = None if not answered else (
        (removed / answered) * desk.hourly / lead.hourly)
    return {
        "calls": calls,
        "attempts_billed": placed,
        "attempts_removed": removed,
        "answered": answered,
        "net_new": net_new,
        "gross_ceiling": gross,
        "added": added,
        "net_ceiling": None if (gross is None or added is None) else gross - added,
        "net_new_bound": bound,
        "worst_case_ceiling": worst,
        "crossover_per_100": None if crossover is None else crossover * 100,
    }


def _counts_from_items(items: list[dict]) -> tuple[int, int, int, int]:
    """Attempts billed, attempts removed, answered calls, net-new escalations.

    Read the same way `firstbell/domain.py` reads them, off the structured result rather
    than off a summary field, because a summary field is a claim and the result is the
    evidence.
    """
    from dispatch.models import Escalation
    from firstbell.domain import safeguarding_escalation

    escalating = {
        item.get("id") for item in items
        if (item.get("structured_result") or {})
        and safeguarding_escalation(item["structured_result"]) is not Escalation.NONE
    }
    billed = sum(item.get("attempts", item.get("attempts_made", 0)) for item in items)
    removed = sum(item.get("attempts", item.get("attempts_made", 0)) for item in items
                  if item.get("resolution") == "resolved"
                  and item.get("id") not in escalating)
    answered = sum(1 for item in items
                   if item.get("resolution") in ("resolved", "undetermined"))
    net_new = sum(1 for item in items
                  if item.get("resolution") == "resolved"
                  and item.get("id") in escalating)
    return billed, removed, answered, net_new


def from_run(run: dict) -> dict:
    """The four integers, from whichever of the two shapes this run is written in.

    A committed receipt carries `items` and the run's own `--json` carries the aggregates,
    because the receipt is the evidence and the `--json` is the report. Both are read here
    rather than one being converted into the other: a conversion would be a third place
    the counting happens, and the whole reason this file exists is that the counting was
    happening in three places.
    """
    if run.get("attempts_billed") is not None:
        return figures_for(run["attempts_billed"], run.get("attempts_removed") or 0,
                           run.get("answered_calls") or 0,
                           run.get("net_new_escalations") or 0,
                           calls=run.get("calls_dialled"))
    items = run.get("items") or []
    return figures_for(*_counts_from_items(items), calls=len(items))


def offline_run(work_file: str, extra: list[str]) -> dict:
    """One run of the app, offline, read out of its own `--json`.

    Not a fixture. The judge's copy of this table is produced by running the program, so a
    row that has gone stale is a row this tool cannot print.
    """
    proc = subprocess.run(
        [sys.executable, "-m", "firstbell", "--work-file", work_file, "--json", *extra],
        cwd=APP, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise SystemExit(f"{work_file} exited {proc.returncode}:\n{proc.stderr[-800:]}")
    # The banner comes before the document, on purpose: an offline run says so
    # first, and a reader piping this into `jq` has already read it. So the object
    # starts at the first brace rather than at the first byte.
    return json.loads(proc.stdout[proc.stdout.index("{"):])


def demo_row() -> dict:
    """The one run this entry leads with, without running the other two.

    The page builder needs this figure and nothing else from here, and running all three
    work files to get one row would put six seconds of subprocess into every page build.
    The label is read off `OFFLINE_RUNS` rather than written again, so a rename cannot
    leave the page quoting a run that no longer exists.
    """
    label, work_file, extra = OFFLINE_RUNS[0]
    figures = from_run(offline_run(work_file, extra))
    figures.update(run=label, source=work_file, live=False)
    return figures


def rows(receipts_dir: Path | None) -> list[dict]:
    out = []
    for label, work_file, extra in OFFLINE_RUNS:
        run = offline_run(work_file, extra)
        figures = from_run(run)
        figures.update(run=label, source=work_file, live=False)
        out.append(figures)
    if receipts_dir is not None:
        for path in sorted(receipts_dir.glob("0*.json")):
            run = json.loads(path.read_text(encoding="utf-8"))
            if not (run.get("items") or []):
                continue
            figures = from_run(run)
            figures.update(run=path.stem, source=str(path.name),
                           live=bool(run.get("reached_production_api")))
            out.append(figures)
    return out


def observed() -> dict:
    """What this account was billed, read off the file that records it.

    Not typed into this tool and not into the README. One file, and everything that quotes
    it is checked against it, because the last figure this project typed twice drifted in
    one of the two places and the wrong one was the one on the page.
    """
    return json.loads(
        (APP / "evidence" / "observed-price.json").read_text(encoding="utf-8"))


def money(value: float | None) -> str:
    return "n/a" if value is None else f"${value:,.2f}"


def table(data: list[dict]) -> str:
    head = (f"{'run':28} {'calls':>5} {'billed':>6} {'removed':>7} {'gross':>7} "
            f"{'added':>7} {'net':>7} {'crossover':>9}")
    lines = [head, "-" * len(head)]
    for row in data:
        lines.append(
            f"{row['run'][:28]:28} "
            + ("    ?" if row["calls"] is None else f"{row['calls']:>5}")
            + f" {row['attempts_billed']:>6} "
            f"{row['attempts_removed']:>7} {money(row['gross_ceiling']):>7} "
            f"{money(row['added']):>7} {money(row['net_ceiling']):>7} "
            + ("      n/a" if row["crossover_per_100"] is None
               else f"{row['crossover_per_100']:>8.1f}%"))
    desk, lead = _wages()
    lines += [
        "",
        f"gross      = attempts removed / attempts billed x ${desk.hourly:,.2f}/h desk "
        f"x {MINUTES_AN_ATTEMPT:.0f} min",
        f"added      = net-new escalations / attempts billed x ${lead.hourly:,.2f}/h lead "
        f"x {MINUTES_AN_ATTEMPT:.0f} min",
        "net        = gross - added, and it is the figure this entry leads with",
        "             both are per billed attempt, which is what CALL-E charges for and",
        "             the only denominator on which one can be taken off the other",
        "crossover  = the net-new rate per 100 answered calls at which net reaches zero",
        "",
        "The ceiling moves between runs because the numerator is measured: how many "
        "attempts",
        "sat behind the records a run closed. Nothing about the software differs between "
        "these",
        "rows. What differs is how many families picked up and said something usable.",
        "",
        "Read the call column before the money columns. A one-call and a two-call receipt "
        "are",
        "here because they are committed and leaving them out would be a choice about "
        "which",
        "evidence counts, but a ratio over two attempts is not a price and the widest "
        "figures",
        "in this table are the narrowest samples. The entry leads with the demo run, "
        "which is",
        "the one a reader can reproduce with one command and no account.",
    ]

    price = observed()["observed"]
    per_call = price["per_call_usd"]
    demo = next((row for row in data if row["run"] == "the demo"), None)
    lines += [
        "",
        "-" * len(head),
        f"What CALL-E actually billed this account: ${per_call:.2f} a call, "
        f"{price['billed_events']} billed",
        f"events, ${price['period_total_usd']:.2f} over {price['surface'].split('Date Range ')[-1]}.",
        "CALL-E publishes no price. This is one account's usage panel, read "
        f"{price['read_at']}, on",
        "hackathon credit, and a district has to confirm its own. Every observed call ran "
        f"between",
        f"{price['shortest_duration']} and {price['longest_duration']}, all under two "
        "minutes, so these rows cannot tell a flat",
        "price per call from a per-minute price rounded up to a two-minute minimum.",
    ]
    if demo and demo["net_ceiling"]:
        lines += [
            "",
            f"So on the demo run: {money(demo['net_ceiling'])} a call is what the desk time "
            f"removed is worth after the",
            f"safeguarding work is paid for, and ${per_call:.2f} a call is what the calls "
            f"cost. "
            f"{demo['net_ceiling'] / per_call:.1f}x of headroom,",
            "on one month of one account's billing, at three minutes a manual attempt.",
        ]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--receipts", default=os.environ.get("FIRSTBELL_RECEIPTS"),
                    help="the committed receipts directory, to include the live runs")
    ap.add_argument("--json", action="store_true", help="machine-readable, same numbers")
    args = ap.parse_args()

    receipts_dir = Path(args.receipts) if args.receipts else None
    if receipts_dir is not None and not receipts_dir.is_dir():
        raise SystemExit(f"no such receipts directory: {receipts_dir}")

    data = rows(receipts_dir)
    if args.json:
        print(json.dumps(data, indent=2))
    else:
        print(table(data))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
