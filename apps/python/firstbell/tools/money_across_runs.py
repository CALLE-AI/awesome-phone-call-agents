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
                calls: int | None = None, escalated: int | None = None) -> dict:
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
    # The bound a district asked for. `added` prices the net-new escalations: the calls
    # that would have closed without the safeguarding rule, so the callback is work the
    # rule created. Every other escalated call connected and gave nothing usable, and
    # somebody was ringing that family back whichever software placed the call, so what
    # the rule adds there is the grade of the person who rings rather than the ringing.
    #
    # That reasoning is ours, which is the objection. A buyer signing a contract wants the
    # figure that holds if our classification is wrong in every case it could be wrong in,
    # so this prices every escalated row as a callback. It over-counts on purpose and it is
    # the worst number in this entry.
    all_escalations = None if (escalated is None or not placed) else (
        (escalated / placed) * (lead.hourly / 60.0) * MINUTES_AN_ATTEMPT)
    # The bound on that worst number, which this entry published for a fortnight without
    # one. `net_new_bound` above is a bound on the net-new rate, and a reader who saw only
    # it could take 24 per 100 as what this sample cannot rule out about escalations
    # generally. It is not: the observed escalation rate is already above it.
    #
    # Pricing every escalation as a callback is an assumption that the escalation rate and
    # the net-new rate are the same quantity, so inside that assumption this bound is the
    # one that belongs beside the crossover, and it is the wider of the two. Both are
    # published, each labelled with what it is a rate of, because the last time this file
    # printed two rates on unlike denominators a district finance office found it.
    escalated_bound = (None if (escalated is None or not answered)
                       else upper_bound(escalated, answered))
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
        "escalated": escalated,
        "escalated_bound": escalated_bound,
        "added_if_every_escalation_is_new": all_escalations,
        "ceiling_if_every_escalation_is_new": (
            None if (gross is None or all_escalations is None)
            else gross - all_escalations),
    }


def _counts_from_items(items: list[dict], *,
                       refile: bool = False) -> tuple[int, int, int, int, int]:
    """Attempts billed, attempts removed, answered calls, net-new escalations, escalated.

    Read off the structured result rather than off a summary field, the same way
    `firstbell/domain.py` reads them, because a summary field is a claim and the result is
    the evidence.

    `refile` decides which question is being asked, and the two have different answers on
    the calls this project has actually placed.

    False asks what the run did. That is what a receipt is: `resolution` is the word the
    software wrote at the time, and `04-defect-a-refusal-scored-resolved.json` is committed
    precisely because the word it wrote was wrong. A parent said they were at work and
    could not talk, CALL-E returned a schema-valid result with every required field
    "unknown", and this app wrote `resolved` and closed a record about a child nobody had
    heard anything about.

    True asks what today's code would do, which is the question any money figure is
    really asking. `tools/replay_escalation.py` owns that rule and this calls it rather
    than restating it: schema problems and a result that learned nothing are both
    `undetermined`, so S-3004 stops being a closed record and stops being a net-new
    escalation with it. One of these two numbers describes software that no longer exists.
    """
    from dispatch.models import Escalation
    from firstbell.domain import safeguarding_escalation

    escalating = {
        item.get("id") for item in items
        if (item.get("structured_result") or {})
        and safeguarding_escalation(item["structured_result"]) is not Escalation.NONE
    }

    def closed(item: dict) -> bool:
        """Whether this row is a record the run is entitled to have closed."""
        if not refile:
            return item.get("resolution") == "resolved"
        result = item.get("structured_result")
        if not isinstance(result, dict):
            return False
        from replay_escalation import file_today
        return file_today(result, with_escalation=False) == "closed"

    def answered_row(item: dict) -> bool:
        """Whether somebody picked up, which no re-filing can change.

        `undetermined` alone cannot answer this. Three of its producers mean a person
        answered and the answer was unusable, and five mean nothing is known about
        whether a telephone was picked up. The receipt now records `spoke_to_someone`
        per row, so this reads the fact instead of inferring it from the word.

        A receipt written before that field existed has no key to read. Those fall back
        to the old rule, which is the rule that receipt was measured under, and the
        recorded set contains no undetermined row at all, so the fallback changes no
        published figure. It is here so an old receipt keeps reporting what it reported.
        """
        if item.get("resolution") == "resolved":
            return True
        if item.get("resolution") != "undetermined":
            return False
        spoke = item.get("spoke_to_someone")
        return True if spoke is None else bool(spoke)

    billed = sum(item.get("attempts", item.get("attempts_made", 0)) for item in items)
    removed = sum(item.get("attempts", item.get("attempts_made", 0)) for item in items
                  if closed(item) and item.get("id") not in escalating)
    answered = sum(1 for item in items if answered_row(item))
    net_new = sum(1 for item in items
                  if closed(item) and item.get("id") in escalating)
    return billed, removed, answered, net_new, len(escalating)


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
                           calls=run.get("calls_dialled"),
                           escalated=run.get("escalated_calls"))
    items = run.get("items") or []
    billed, removed, answered, net_new, escalated = _counts_from_items(items)
    return figures_for(billed, removed, answered, net_new, calls=len(items),
                       escalated=escalated)


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
    else:
        # The same rows from the committed counts, for a reader with no receipts, which is
        # every reader but this machine. Act 04 cites one of them by its numbers, "a third
        # run: 3 of 7 attempts removed", and offers this command as the check, so without
        # these the invitation pointed at a table the row was not in.
        for label, block in recorded_receipt_rows():
            figures = figures_for(block["attempts_billed"], block["attempts_removed"],
                                  block["answered"], block["net_new_escalations"],
                                  calls=block["calls"], escalated=block.get("escalated"))
            figures.update(run=label, source="evidence/recorded-calls.json", live=True)
            out.append(figures)
    pooled = pooled_live_row()
    if pooled is not None:
        out.append(pooled)
    return out


RECORDED = APP / "evidence" / "recorded-calls.json"


def recorded_counts() -> dict | None:
    """The five integers over every call that rang, read off the committed file.

    Not off the receipts. The receipts are not in this repository and `evidence/README.md`
    says why, so a row computed from them would be a figure a judge cannot check.
    `tools/pool_recorded_calls.py` writes the counts, which carry no conversation, no
    number, no call id and no field value, and `--check` compares them against the
    receipts on a machine that has them.
    """
    if not RECORDED.exists():
        return None
    return json.loads(RECORDED.read_text(encoding="utf-8"))["counts"]


def recorded_receipt_rows() -> list[tuple[str, dict]]:
    """One row per recorded receipt, from the committed counts.

    Reproducible with no receipts on disk, which is the point: the receipts are not in this
    repository, and act 04 cites one of these rows by its numbers ("a third run: 3 of 7
    attempts removed") while offering `tools/money_across_runs.py` as the way to check it.
    A buyer took the invitation, found three offline rows and the pool, and no row with
    seven attempts in it anywhere.

    The label is the receipt filename with its leading number and its extension removed,
    because that name is already published in `evidence/README.md` and a prettier one here
    would be a second name for the same file.
    """
    facts = APP / "evidence" / "recorded-calls.json"
    if not facts.exists():
        return []
    blocks = json.loads(facts.read_text(encoding="utf-8")).get("per_receipt") or []
    rows = []
    for block in blocks:
        name = str(block.get("receipt") or "")
        label = name.removesuffix(".json").split("-", 1)[-1].replace("-", " ")
        rows.append((label[:28] or name, block))
    return rows


def pooled_live_row() -> dict | None:
    """One row over every call that actually rang, and the only unchosen numerator here.

    The individual receipt rows are each one to seven calls, so the widest figures in this
    table come from its narrowest samples. Pooling them gives the row a buyer should argue
    with: twelve calls, eleven of them answered, and a worst case that goes negative.
    """
    held = recorded_counts()
    if not held:
        return None
    figures = figures_for(held["attempts_billed"], held["attempts_removed"],
                          held["answered"], held["net_new_escalations"],
                          calls=held["calls"], escalated=held.get("escalated"))
    figures.update(run="all recorded calls", source="evidence/recorded-calls.json",
                   live=True, pooled=True,
                   net_new_as_recorded=held.get("net_new_escalations_as_recorded"),
                   removed_as_recorded=held.get("attempts_removed_as_recorded"))
    return figures


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
    # The three money columns are dollars per billed attempt at the three minutes an
    # attempt is priced at. The run output prints the same three quantities per minute, so
    # `added` read $0.08 there and $0.23 here with nothing on either saying which.
    units = f"{'':50}{'$ per attempt, 3 min':>23} {'per 100':>9}"
    lines = [head, units, "-" * len(head)]
    for row in data:
        if row.get("pooled"):
            lines.append("-" * len(head))
        lines.append(
            f"{row['run'][:28]:28} "
            + ("    ?" if row["calls"] is None else f"{row['calls']:>5}")
            + f" {row['attempts_billed']:>6} "
            f"{row['attempts_removed']:>7} {money(row['gross_ceiling']):>7} "
            f"{money(row['added']):>7} {money(row['net_ceiling']):>7} "
            + ("      n/a" if row["crossover_per_100"] is None
               else f"{row['crossover_per_100']:>8.1f}%"))
    desk, lead = _wages()
    pooled = next((row for row in data if row.get("pooled")), None)
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
        "Three kinds of row, and the difference matters more than any figure in the "
        "table.",
        "",
        "The offline rows run against a test double, and their outcome mix is written "
        "down in",
        "firstbell/scenario.py: three answered, one ambiguous, one no-answer, one "
        "escalating.",
        "That is what makes them reproducible by a stranger with no account, and it "
        "means",
        "somebody chose their numerator. Read them as a worked example of the arithmetic, "
        "not",
        "as a measurement of how families behave.",
        "",
        "The middle rows are one recorded run each, named for the receipt that holds it.",
        "Nobody can re-run them: they were telephone calls. Their counts are committed in",
        "evidence/recorded-calls.json, which carries no conversation, no number, no call "
        "id",
        "and no field value, because the receipts themselves are not in the repository "
        "and",
        "evidence/README.md says why. They are here because the page cites one of them by",
        "its numbers and offered this command as the way to check it. Each is one to "
        "seven",
        "calls, so the widest figures in this table come from its narrowest samples, "
        "which",
        "is what the last row is for.",
        "",
    ]
    if pooled is not None:
        lines.append(
            f"The last row is the {pooled['calls']} calls that rang. It is the only "
            "numerator here nobody picked.")
        # The disclosure the whole table is for. A bound that crosses the crossover means
        # the software might cost a district money, and the number is four cents.
        worst = pooled["worst_case_ceiling"]
        bound = 100 * pooled["net_new_bound"]
        crossover = pooled["crossover_per_100"]
        lines += [
            f"{pooled['answered']} of them were answered and {pooled['net_new']} became "
            f"new work for the safeguarding lead: a rate of",
            f"{100 * pooled['net_new'] / pooled['answered']:.0f} per 100. "
            f"{pooled['answered']} answered calls cannot rule out {bound:.0f} per 100, "
            f"and the crossover is {crossover:.0f},",
        ]
        # Both directions, because this comparison has changed direction once already and
        # the sentence that asserted it did not move with the number.
        if bound > crossover:
            lines += [
                "so the bound is past the crossover. At that end this software costs a "
                f"district ${abs(worst or 0):,.2f}",
                f"a call instead of saving ${pooled['net_ceiling']:,.2f}.",
            ]
        else:
            lines += [
                f"so the bound is inside the crossover with {crossover - bound:.0f} per "
                "100 to spare. Even at the far",
                f"end of it the ceiling is ${worst:,.2f} a call and the saving holds.",
            ]
        lines += [
            "Which end it is, is what a pilot measures in week one, and a district running "
            "a higher",
            "alert rate or closing fewer records than this walks into the loss. So it is "
            "printed.",
        ]
        # The other bound, and the worse one. `added` prices only the escalations this
        # software says it created. A district accepted the reasoning and asked for the
        # figure that holds if the reading is wrong every time, which is the one below.
        every = pooled.get("ceiling_if_every_escalation_is_new")
        if every is not None and (pooled.get("escalated") or 0) > pooled["net_new"]:
            counted = ("none of them counts as new work"
                       if not pooled["net_new"] else
                       f"{pooled['net_new']} of them counts as new work")
            lines += [
                "",
                f"The safeguarding rule marked {pooled['escalated']} of those "
                f"{pooled['answered']} answered calls, and {counted}:",
                # "the other N" only when some of them were new work. With none new,
                # the remainder is all of them, and the sentence read "marked 5 ...
                # the other 5", which is a subtraction printed as a distinction. The
                # README says the same thing correctly and this now matches it.
                (f"the other {pooled['escalated'] - pooled['net_new']} connected and "
                 "gave nothing usable, so a person was ringing those"
                 if pooled["net_new"] else
                 "every one of them connected and gave nothing usable, so a person "
                 "was ringing those"),
                "families back whatever placed the call and the rule added the grade "
                "rather than the",
                f"callback. That reading is ours. Price all {pooled['escalated']} as "
                "callbacks and the ceiling is "
                + (f"a cost of ${abs(every):,.2f}" if every < 0
                   else f"${every:,.2f}"),
                "a call. It over-counts on purpose and it is the number to hold this "
                "entry to.",
            ]
    lines += [
        "",
        "Read the call column before the money columns. A one-call and a two-call receipt "
        "is",
        "a receipt, and a ratio over two attempts is not a price, so the widest figures "
        "among",
        "the individual rows are its narrowest samples. The receipts themselves are not "
        "in this",
        "repository and evidence/README.md says why; evidence/recorded-calls.json holds "
        "the",
        "counts, at the line evidence/api-shape.json draws, so the pooled row is "
        "checkable",
        "from what is published. The entry leads with the demo run because it is the one "
        "a",
        "reader can reproduce with one command, and it names the pooled row beside it.",
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
        # And the measured one, which is the figure a buyer should hold this entry to. It
        # came out higher than the run the entry leads with, which is the only reason to
        # be careful about saying so: a project quoting its best row is what this table
        # was built to stop, so both are named and the smaller one keeps the headline.
        if pooled and pooled["net_ceiling"]:
            lines += [
                f"On the {pooled['calls']} calls that rang: "
                f"{money(pooled['net_ceiling'])} a call and "
                f"{pooled['net_ceiling'] / per_call:.1f}x. The entry leads with",
                "the smaller of the two because it is the one anybody can reproduce, "
                "and the",
                "larger one is here so that choice is visible rather than quiet.",
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
