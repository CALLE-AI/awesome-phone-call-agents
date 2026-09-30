"""The price this account was billed, and the one figure the entry leads with.

For months the cost side of this entry was a ceiling with no price beside it, because
CALL-E publishes none. That was honest and unusable: a district cannot act on a number
that says only "below this, a person is cheaper". Meanwhile four different per-call
figures were published on three surfaces, all of them arithmetic the program printed, none
of them saying which run it belonged to. A buyer read the entry, found all four, and was
right to stop trusting the fifth.

Both halves are fixed here. `evidence/observed-price.json` holds what the account was
billed, with the three things thirteen calls cannot settle written beside it.
`tools/money_across_runs.py` computes the ceiling for every run this repository can
produce, from one function, so the figures cannot disagree. This file is what keeps the
README, the tool and that file saying the same thing.
"""
from __future__ import annotations

import json
import re
import pytest
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
if str(APP / "tools") not in sys.path:
    sys.path.insert(0, str(APP / "tools"))

from money_across_runs import figures_for, observed, rows, table  # noqa: E402

PRICE = json.loads((APP / "evidence" / "observed-price.json").read_text(encoding="utf-8"))
README = (APP / "README.md").read_text(encoding="utf-8")


def test_the_billing_readout_divides_the_way_it_says_it_does():
    """Thirteen events at five cents is sixty-five cents, or the readout is misread.

    This is the whole basis for calling the price flat. If the division does not come out,
    then either a row was priced differently or the period holds something that is not a
    call, and in both cases the sentence "every call cost the same" is not supported.
    """
    seen = PRICE["observed"]
    assert abs(seen["billed_events"] * seen["per_call_usd"]
               - seen["period_total_usd"]) < 0.005, (
        f"{seen['billed_events']} events at ${seen['per_call_usd']:.2f} is not "
        f"${seen['period_total_usd']:.2f}, so the price was not flat across the period")


def test_the_observation_says_what_it_cannot_settle():
    """A first-party price with no caveats is a marketing number.

    Three of them are load-bearing: it is one account on hackathon credit, every call ran
    under two minutes so a per-minute price rounded up looks identical, and nothing here
    speaks to volume. Any one of them missing turns a measurement into a claim.
    """
    limits = " ".join(PRICE["what_it_does_not_support"]).lower()
    assert len(PRICE["what_it_does_not_support"]) >= 3
    for phrase in ("publishes no per-call price", "two minutes", "volume"):
        assert phrase in limits, f"the observation does not disclaim {phrase!r}"


def test_the_receipted_calls_are_not_counted_as_the_billed_ones():
    """Twelve receipts and thirteen billed events are two different numbers.

    Publishing thirteen receipts would be false, and publishing twelve billed events would
    understate what the account paid. The file holds both, and the gap is stated rather
    than averaged away.
    """
    seen = PRICE["observed"]
    assert seen["receipted_calls"] < seen["billed_events"]
    assert any("thirteenth" in line or "outside the receipted set" in line
               for line in PRICE["what_it_supports"]), (
        "the file records more billed events than receipts and does not say why")


def test_the_readme_quotes_the_price_that_is_recorded():
    seen = PRICE["observed"]
    assert f"${seen['per_call_usd']:.2f} a call" in README
    assert f"${seen['period_total_usd']:.2f}" in README
    # Matched across a line break, because README prose wraps and a test that pins a
    # sentence to one line asks the next person to break the paragraph instead.
    assert re.search(r"two-minute\s+minimum", README), (
        "the README quotes the price and not the reason it might be a per-minute price")
    assert "evidence/observed-price.json" in README


def test_the_readme_ceiling_table_is_what_the_tool_prints_now():
    """The block in the README, byte for byte against the tool that produces it.

    The four disagreeing figures existed because three surfaces each did the arithmetic.
    A README table typed by hand would be the fourth. So the block is compared, and a
    change to any run's outcome fails here rather than being noticed by a reader.
    """
    printed = table(rows(None)).splitlines()
    header = printed[0]
    body = [line for line in printed[2:] if line.strip() and not line.startswith("-")]
    quoted = README[README.index("run  "):]
    quoted = quoted[:quoted.index("```")].splitlines()
    assert quoted[0].rstrip() == header.rstrip(), (
        f"the README table header is stale:\n{quoted[0]!r}\n{header!r}")
    for line in body[:3]:
        assert line.rstrip() in [q.rstrip() for q in quoted], (
            f"the tool prints {line.rstrip()!r} and the README does not")


def test_the_pooled_row_is_in_the_table_and_in_the_readme():
    """The one row whose outcome mix nobody wrote down, on both surfaces.

    Every other row in this table runs against a test double whose outcomes are bound in
    `firstbell/scenario.py`, so the numerator of the figure this entry leads with was
    chosen. A district buyer found that by reading the two files together. The answer is
    the pooled row, and the answer is worth nothing if it can quietly stop being printed.
    """
    printed = table(rows(None)).splitlines()
    pooled = next((row for row in rows(None) if row.get("pooled")), None)
    assert pooled is not None, (
        "the table no longer pools the recorded calls, which leaves every published "
        "money figure resting on an outcome mix somebody chose")
    line = next((l for l in printed if l.startswith("all recorded calls")), None)
    assert line is not None, "the pooled row is computed and not printed"
    assert line.rstrip() in README, (
        f"the README does not carry the pooled row the tool prints:\n{line.rstrip()!r}")
    assert f"${pooled['net_ceiling']:,.2f} a call" in README, (
        "the README does not name the pooled net ceiling")


def test_the_pooled_row_counts_each_recorded_call_once():
    """Twelve calls, not fourteen, and the difference is a receipt that placed none.

    `02-idempotent-replay-no-calls` records the same two call ids as `01`, because the
    point of that receipt is that running the same work file twice dials nobody. A pooled
    figure that summed the receipts would count those two twice, which is the class of
    arithmetic this whole tool exists to stop, so it would be a defect in the fix for a
    defect.

    The pooled row is computed from this same file, so checking one against the other says
    nothing. What can drift is the prose, and it did.
    """
    counts = json.loads(
        (APP / "evidence" / "recorded-calls.json").read_text(encoding="utf-8"))["counts"]

    # This used to assert the literal 12, with the message "the entry says twelve real
    # calls everywhere". That stopped being true of the world: twenty live calls are
    # published now, twelve of them placed on 2026-09-11, and this file still counts only
    # the 2026-09-04 set, which is the one with committed receipts. A gate holding the
    # literal would have gone on passing while every surface quoting it read as a total, so
    # what is asserted here is the agreement instead: whatever number this file holds, the
    # surfaces that quote it as a denominator have to spell that number and say which calls
    # it is.
    words = {10: "ten", 11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen"}
    n = counts["calls"]
    assert n in words, f"{n} calls is past what this gate can spell"
    word = words[n]
    for name in ("README.md", "docs/the-money-in-full.md",
                 "docs/what-a-pilot-would-look-like.md"):
        flat = " ".join((APP / name).read_text(encoding="utf-8").split())
        assert re.search(rf"(?i)\b{word}\b[^.]{{0,70}}2026-09-04", flat), (
            f"{name} does not say {word} anywhere in the same sentence as 2026-09-04, so "
            f"the denominator behind its money figures reads as a total, and the entry "
            f"publishes more calls than that")

    assert counts["answered"] <= counts["calls"], (
        "more calls were answered than were placed, which cannot happen")
    assert counts["attempts_removed"] <= counts["attempts_billed"], (
        "more attempts were removed than were billed, which cannot happen")
    assert counts["net_new_escalations"] <= counts["answered"], (
        "a call that nobody answered cannot have become new work")


def test_the_committed_counts_are_the_ones_the_money_table_divides():
    """One file, and everything that quotes it checked against it.

    The receipts are not in this repository and `evidence/README.md` says why, so the
    pooled row is computed from counts written into `evidence/`. If the tool ever grows a
    second copy of those five integers, this is where it shows up.
    """
    from money_across_runs import figures_for, recorded_counts

    held = recorded_counts()
    assert held is not None, "evidence/recorded-calls.json is missing"
    expected = figures_for(held["attempts_billed"], held["attempts_removed"],
                           held["answered"], held["net_new_escalations"],
                           calls=held["calls"])
    pooled = next(row for row in rows(None) if row.get("pooled"))
    for key in ("gross_ceiling", "added", "net_ceiling", "crossover_per_100",
                "net_new_bound", "worst_case_ceiling"):
        assert pooled[key] == expected[key], (
            f"the pooled row's {key} is not what the committed counts give")


def test_the_bound_past_the_crossover_is_published_rather_than_rounded_away():
    """The worst case on the recorded calls is negative, and the entry says so.

    This is the disclosure a buyer asked for and the one a vendor deck leaves out: on
    eleven answered calls the one-sided bound on the net-new rate sits above the rate at
    which the callbacks cost more than the attempts removed. A future run with more calls
    may move it, and if it does this test says which sentence to rewrite rather than
    letting the old one stand.
    """
    pooled = next(row for row in rows(None) if row.get("pooled"))
    bound = 100 * pooled["net_new_bound"]
    crossover = pooled["crossover_per_100"]
    printed = table(rows(None))
    if bound > crossover:
        assert pooled["worst_case_ceiling"] < 0, (
            "the bound is past the crossover, so the worst case has to be a loss")
        # The tool's own sentence, verbatim. This branch had never executed before
        # 2026-09-11, because the bound had always sat inside the crossover, and the phrase
        # it waited for was not one the tool prints. A gate that has never run is a gate
        # nobody has checked, and this one was wrong when it finally ran.
        assert "so the bound is past the crossover" in printed, (
            "the tool no longer says the bound is past the crossover")
        assert "The bound is past the crossover" in README, (
            "the README no longer discloses that the bound is past the crossover")
    else:
        assert pooled["worst_case_ceiling"] >= 0, (
            "the bound is inside the crossover, so the worst case cannot be a loss")
        assert "The bound is past the crossover" not in README, (
            "the README still says the bound is past the crossover and it is not")


def test_the_entry_leads_with_one_number_and_it_is_the_net_one():
    """`net`, not `gross`. The larger number is the one that ignores the added work.

    The README's first screen, its cost section and the tool all have to name the same
    figure, and the reason this is a test is that the entry once led with $0.59 on one
    surface and $0.21 on another.
    """
    demo = next(row for row in rows(None) if row["run"] == "the demo")
    lead = f"${demo['net_ceiling']:,.2f} a call"
    first_screen = README[README.index("## If you have three minutes"):
                          README.index("## If you have twenty minutes")]
    assert f"**{lead}**" in first_screen, (
        f"the first screen does not lead with {lead}, which is the demo run's net ceiling")
    assert f"**{lead}**" in README[README.index("## The same ceiling"):], (
        "the ceiling section does not name the same figure the first screen does")
    assert demo["gross_ceiling"] > demo["net_ceiling"], (
        "gross is meant to be the larger figure; if it is not, the arithmetic changed")


def test_the_headroom_is_the_two_numbers_divided_and_not_a_claim():
    """Seven times, and it is a division a reader can do in their head.

    Written as words in the README rather than as a figure, because a figure would be a
    fifth place the arithmetic lives. The test does the division instead.

    It said four times while the net ceiling was $0.21, which subtracted a cost per
    answered call from a saving per billed attempt. Putting both on the attempts CALL-E
    bills for raised the ceiling to $0.35 and the headroom with it.
    """
    demo = next(row for row in rows(None) if row["run"] == "the demo")
    headroom = demo["net_ceiling"] / PRICE["observed"]["per_call_usd"]
    assert 7.0 <= headroom < 8.0, (
        f"the README says a little over seven times and the division gives {headroom:.2f}")
    assert "seven times the headroom" in README


def test_the_tool_runs_and_needs_no_receipts_and_no_account():
    """The command on the first screen, run the way a reviewer would run it.

    `--receipts` is optional here and required by the page builder, and that asymmetry is
    the point: a reviewer with no receipts still gets the rows they can reproduce.
    """
    proc = subprocess.run([sys.executable, "tools/money_across_runs.py"],
                          cwd=APP, capture_output=True, text=True, timeout=300)
    assert proc.returncode == 0, proc.stderr[-800:]
    assert "the demo" in proc.stdout
    assert f"${PRICE['observed']['per_call_usd']:.2f} a call" in proc.stdout
    assert "--json" not in proc.stdout


def test_the_json_output_carries_every_run_and_no_rounded_money():
    """`--json` is for a reader who wants to check the arithmetic, so it stays unrounded.

    Rounding in the machine-readable output is how two surfaces come to disagree in the
    second decimal place, which is exactly the defect this file exists for.
    """
    proc = subprocess.run([sys.executable, "tools/money_across_runs.py", "--json"],
                          cwd=APP, capture_output=True, text=True, timeout=300)
    assert proc.returncode == 0, proc.stderr[-800:]
    data = json.loads(proc.stdout)
    assert [row["run"] for row in data][:1] == ["the demo"]
    demo = data[0]
    assert demo["net_ceiling"] != round(demo["net_ceiling"], 2), (
        "the JSON is rounded to cents, so a reader cannot check the division")


def test_the_arithmetic_is_a_ratio_of_ratios_and_not_a_constant():
    """Double the attempts removed and the ceiling doubles. That is the whole claim.

    A figure that did not move with its numerator would mean the tool is printing a
    constant, which is the shape of the defect this project has recorded twice: a number
    that looks measured and is typed.
    """
    one = figures_for(placed=8, removed=4, answered=5, net_new=1)
    two = figures_for(placed=8, removed=8, answered=5, net_new=1)
    assert two["gross_ceiling"] == 2 * one["gross_ceiling"]
    assert two["crossover_per_100"] == 2 * one["crossover_per_100"]
    # And the added cost does not move with it, because it is paid per answered call
    # rather than per attempt removed.
    assert two["added"] == one["added"]


def test_a_run_that_answered_nothing_has_no_rate_and_says_so():
    """Zero answered calls is not a zero rate, and the tool must not print one.

    The same mistake killed the page build once: a bound that does not exist, multiplied.
    """
    nothing = figures_for(placed=3, removed=0, answered=0, net_new=0)
    assert nothing["added"] is None
    assert nothing["net_ceiling"] is None
    assert nothing["net_new_bound"] is None
    assert "n/a" in table([{**nothing, "run": "x", "calls": 3}])


def test_the_price_file_is_reachable_from_the_evidence_index():
    index = (APP / "evidence" / "README.md").read_text(encoding="utf-8")
    assert "observed-price.json" in index
    assert re.search(r"\$0\.05", index), (
        "the evidence index describes the file without saying what it records")


def test_every_crossover_the_money_document_prints_is_one_the_tool_computes():
    """Nothing checked that document, and it was the odd one out of three surfaces.

    Its table put "What eleven real calls cannot rule out: 24" straight above "Where the
    saving becomes a loss: 50.4" and concluded there was half the rate to spare. The bound
    is measured on the calls that rang; 50.4 is derived from the committed offline run,
    whose outcome mix is authored. Both figures were right and the comparison between them
    was not one, and a district following the link from the page met a third crossover
    again and had three conclusions with nothing saying which to staff against.

    So every per-100 figure in the document has to be one the tool computes, to a tenth.
    That is weaker than deriving the document, which is markdown a person writes, and it is
    the strongest rule that does not require generating it.
    """
    import money_across_runs

    doc = (APP / "docs" / "the-money-in-full.md").read_text(encoding="utf-8")
    computed = {round(row["crossover_per_100"], 1)
                for row in money_across_runs.rows(None)
                if row.get("crossover_per_100") is not None}
    pooled = next(r for r in money_across_runs.rows(None) if r.get("pooled"))
    computed.add(round(pooled["net_new_bound"] * 100, 1))
    computed.add(float(int(round(pooled["net_new_bound"] * 100))))
    # The escalation rate and its own bound, which the document prints in a second table
    # under its own header. They are rates of a different thing from the column above, so
    # they get their own column, and this gate is the reason they cannot drift out of it.
    if pooled.get("escalated_bound") is not None and pooled.get("escalated"):
        computed.add(round(pooled["escalated_bound"] * 100, 1))
        computed.add(float(int(round(pooled["escalated_bound"] * 100))))
        measured = 100 * pooled["escalated"] / pooled["answered"]
        computed.add(round(measured, 1))
        computed.add(float(int(round(measured))))
    # The offline run's own measured rate, which the table's first row states. Derived from
    # the two counts rather than read from a `net_new_per_100` key, because there is no such
    # key on the row: this read `None` on every run, added nothing, and the 20.0 it was
    # supposed to explain was being covered by the hardcoded allowance below instead.
    demo = next(r for r in money_across_runs.rows(None) if r["run"] == "the demo")
    if demo.get("net_new") is not None and demo.get("answered"):
        computed.add(round(100 * demo["net_new"] / demo["answered"], 1))
    # And the pooled run's own measured net-new rate, which the table's third row states.
    # This was missing, and it did not show because the rate was 0 and 0.0 was sitting in
    # the hardcoded allowance below next to the demo's 20.0. Both of those are derivable, so
    # neither is hardcoded any more: an allowance that happens to contain the right answer
    # is not a check, and on 2026-09-11 the rate moved to 18.2 and nothing had ever compared
    # it to anything.
    if pooled.get("net_new") is not None and pooled.get("answered"):
        computed.add(round(100 * pooled["net_new"] / pooled["answered"], 1))
    allowed = {100.0} | computed

    quoted = set()
    for line in doc.splitlines():
        if not line.startswith("|"):
            continue
        for cell in line.split("|"):
            bare = cell.strip().strip("*")
            try:
                quoted.add(round(float(bare), 1))
            except ValueError:
                continue

    unexplained = sorted(v for v in quoted if v not in allowed)
    assert not unexplained, (
        f"the money document's table prints {unexplained}, and the tool computes "
        f"{sorted(computed)}. A per-100 figure in that table that the tool does not "
        f"produce is either stale or belongs to a run the table does not name"
    )



# ---------------------------------------------------------------------------
# The second reading. On 2026-09-11 the same account, running the same
# software to the same country, was billed between eight and fifteen times
# what it had been billed a week earlier, and the amount moved from call to
# call. The flat block above is still a true readout of the period it names,
# so it stays, and this is checked beside it rather than instead of it.
# ---------------------------------------------------------------------------

METERED = PRICE["observed_metered"]


def test_the_metered_rows_add_up_to_the_total_they_publish():
    rows = METERED["calls"]
    assert len(rows) == METERED["calls_billed"] == 4
    assert sum(r["credits"] for r in rows) == METERED["billed_total_credits"] == 252
    assert abs(sum(r["usd"] for r in rows) - METERED["billed_total_usd"]) < 0.005


def test_every_metered_row_converts_at_the_rate_the_file_states():
    rate = METERED["credit_to_usd"]
    assert rate == 0.01
    for row in METERED["calls"]:
        assert abs(row["credits"] * rate - row["usd"]) < 0.005, (
            f"{row['scenario_id']} is {row['credits']} credits and ${row['usd']}, which is "
            "not the rate this file says the account converts at")


def test_the_balance_the_dashboard_showed_reconciles():
    """1,035 credits after the top-up, 252 settled, 783 left. The arithmetic is the point.

    The 2026-09-04 reconciliation could not close: thirteen billed events against twelve
    published calls, with no way to tell a double charge from a missing receipt. This one
    closes exactly, and a balance that closes is the difference between a billing readout
    and a billing anecdote.
    """
    assert METERED["balance_credits"] == 783
    assert METERED["period_cost_credits"] == 317
    legacy = PRICE["observed"]["billed_events"] * 5
    assert legacy == 65, "the flat period is no longer 13 events at 5 credits"
    assert legacy + METERED["billed_total_credits"] == METERED["period_cost_credits"], (
        "the period cost is not the two runs added together, so one of them is misread")
    assert 1035 - METERED["billed_total_credits"] == METERED["balance_credits"]


def test_the_credit_rate_agrees_with_the_period_the_flat_block_records():
    """The conversion is not asserted, it is derived twice and the two agree.

    Once from the top-up, +$10.00 for 1,000 credits. Once from the earlier period, whose
    panel was denominated in dollars: 65 credits of usage against a $0.65 total.
    """
    seen = PRICE["observed"]
    assert abs(seen["billed_events"] * 5 * METERED["credit_to_usd"]
               - seen["period_total_usd"]) < 0.005


def test_the_metered_reading_refutes_both_flat_readings():
    """Not a claim in prose. The two readings are computed from the published rows.

    The flat block said in as many words that it could not separate a flat per-call price
    from a per-minute price rounded up to a two-minute minimum, and that separating them
    needed one call over two minutes. These four calls are all under two minutes, so both
    of those readings predict four identical charges, and the charges are not identical.
    That is what closes the question, and it closes it without the long call.
    """
    rows = METERED["calls"]
    charges = {r["credits"] for r in rows}
    assert len(charges) > 1, (
        "every metered call billed the same, so this reading does not refute a flat price")
    assert max(r["recording_seconds"] for r in rows) < 120, (
        "one of these calls runs past two minutes, so the two-minute-minimum reading is no "
        "longer refuted by the spread and this test is measuring something weaker")
    assert max(charges) >= 1.5 * min(charges), (
        "the spread is too narrow to be worth publishing as a refutation")


def test_the_granularity_finding_is_the_rows_and_not_a_sentence():
    """Two calls four seconds apart in length billed the same, so it is not per-second."""
    by_id = {r["scenario_id"]: r for r in METERED["calls"]}
    a, b = by_id["S-3101"], by_id["S-3102"]
    assert a["credits"] == b["credits"], "the pair this finding rests on no longer matches"
    assert 0 < abs(a["recording_seconds"] - b["recording_seconds"]) < 10, (
        "these two calls are no longer close enough in length for their equal charge to say "
        "anything about granularity")


def test_neither_kind_of_failure_is_recorded_as_billed():
    """Six placed, four charged. The gap is what CALL-E absorbed, and it is named."""
    assert METERED["calls_placed"] - METERED["calls_billed"] == 2
    absorbed = METERED["not_billed"]
    assert set(absorbed) == {"zero_duration_failures", "concurrency_rejections"}
    for key, text in absorbed.items():
        assert len(text) > 60, f"{key} is recorded as absorbed with no account of what it was"


def test_the_file_says_it_cannot_explain_the_change_in_level():
    """The one thing four calls cannot do is say why, and the file has to admit it.

    A readout that reported a tenfold change and offered a cause would be inventing the
    cause: the dashboard shows no rate card, no line items and no effective date.
    """
    cannot = " ".join(PRICE["what_the_metered_reading_does_not_support"]).lower()
    for phrase in ("rate card", "per-second", "promotional"):
        assert phrase in cannot, f"the file no longer says it cannot settle {phrase}"


def test_no_platform_call_id_reaches_this_file():
    """The join key back to a recording of a real line stays out of the repository.

    It was in here once, for one commit, because the billing table it came from is keyed on
    it. `tests/test_privacy.py` catches this too; it is asserted here as well because this
    is the file that keeps wanting them.
    """
    import re

    body = (APP / "evidence" / "observed-price.json").read_text(encoding="utf-8")
    assert not re.search(r"\b[0-9a-f]{32}\b", body), (
        "a 32-hex platform call id is committed in the price file")
    for row in METERED["calls"]:
        assert row["scenario_id"].startswith("S-"), (
            "the metered rows are labelled with something other than a scenario id")


def test_the_rejection_count_agrees_everywhere_it_is_printed():
    """One number, four copies, and nothing was holding them equal.

    The count of HTTP 429 rejections is stated in the report twice, once in the transport
    table in section 4 and once in the billing answer, and a third time in
    `observed-price.json`. It was published as "ten" in two of those places and as a
    twenty-minute narrative of "nine in a row" in the third, while the trace the run
    actually wrote recorded 33. Every copy passed every gate, because no gate read it.

    Then the same figure was found stale a second time, in a fourth copy this test did not
    read: the summary block at the top of the report, which still said ten after the other
    three were corrected to 33. A test that gates three copies of a number and leaves a
    fourth unread is a test that will pass while the document is wrong, so the summary
    block is now in the set.

    This does not check that 33 is right; the trace that settles that lives outside the
    repository with the receipts. It checks that the four copies cannot drift apart again,
    which is the failure that happened, twice.
    """
    import re

    report = (APP / "CALLE_FEEDBACK_REPORT.md").read_text(encoding="utf-8")

    # Section 4's transport block: "33 rejected (429)".
    block = re.search(r"(\d+)\s+rejected \(429\)", report)
    assert block, "section 4 no longer prints a rejected count in its transport block"
    in_block = int(block.group(1))

    # The summary block at the top of the report. The tail of the line is part of the
    # pattern on purpose: the report prints a rejection count per session, and this is the
    # first session's copy, the one that went stale.
    summary = re.search(r"(?m)^rejected\s+(\d+)\s+HTTP 429, no call_id", report)
    assert summary, (
        "the summary block at the top of the report no longer prints the first session's "
        "rejection count, and that block is the copy that was found stale twice")
    in_summary = int(summary.group(1))

    # Section 4's prose, and the billing answer.
    prose = re.findall(r"The (\d+) rejections run consecutively", report)
    answer = re.findall(r"\*\*The (\d+) `account_concurrency_exceeded` rejections", report)
    assert prose, "section 4's prose no longer states the rejection count"
    assert answer, "the billing section no longer states the rejection count"

    # And the price file.
    in_price = re.findall(r"(\d+) HTTP 429", PRICE["observed_metered"]["not_billed"]
                          ["concurrency_rejections"])
    assert in_price, "the price file no longer states the rejection count"

    seen = {in_summary, in_block, int(prose[0]), int(answer[0]), int(in_price[0])}
    assert len(seen) == 1, (
        f"the rejection count is printed as {sorted(seen)} in different places, so at least "
        "one of them is stale: the summary block, section 4's block, section 4's prose, the "
        "billing answer and evidence/observed-price.json all have to say the same thing")

    # The attempts have to add up, because a refusal count without its denominator is not
    # a measurement of anything a reader can check.
    attempts = re.search(r"POST /v1/calls\s+(\d+) attempts", report)
    accepted = re.search(r"(\d+) accepted \(201\)", report)
    assert attempts and accepted, "section 4 no longer prints attempts and acceptances"
    assert int(accepted.group(1)) + in_block == int(attempts.group(1)), (
        f"{accepted.group(1)} accepted plus {in_block} rejected is not the "
        f"{attempts.group(1)} attempts section 4 claims")


PERIOD = PRICE["observed_metered_period"]


def test_the_whole_period_reconciles_against_what_was_granted():
    """1,100 credits in, 820 out, 280 left, and the two rates add up to the 820.

    The flat block could not say this and said so. This one can: the panel prints a period
    total and a balance, the file records both, and the only way both are right is if the
    two rates' rows sum to the total and the grants cover it.
    """
    metered, legacy = PERIOD["metered_rate"], PERIOD["legacy_rate"]
    granted = sum(g["credits"] for g in PRICE["funding"]["grants"])
    assert granted == PRICE["funding"]["total_credits"] == 1100
    assert legacy["rows"] * legacy["credits_each"] == legacy["credits"] == 65
    assert metered["credits"] + legacy["credits"] == PERIOD["period_cost_credits"] == 820
    assert metered["rows"] + legacy["rows"] == PERIOD["billed_events"] == 32
    assert granted - PERIOD["period_cost_credits"] == PERIOD["balance_credits"] == 280
    rate = PERIOD["credit_to_usd"]
    assert abs(PERIOD["period_cost_credits"] * rate - PERIOD["period_cost_usd"]) < 0.005
    assert abs(PERIOD["balance_credits"] * rate - PERIOD["balance_usd"]) < 0.005


def test_the_metered_rows_are_the_rows_the_summary_describes():
    """Every published statistic about the spread is recomputed from the rows themselves."""
    metered = PERIOD["metered_rate"]
    rows = metered["credits_sorted"]
    assert rows == sorted(rows), "the published row list is not sorted, so the median is not"
    assert len(rows) == metered["rows"]
    assert sum(rows) == metered["credits"]
    assert min(rows) == metered["min_credits"] == metered["floor_credits"]
    assert max(rows) == metered["max_credits"]
    assert rows.count(metered["floor_credits"]) == metered["rows_at_the_floor"]
    assert rows[len(rows) // 2] == metered["median_credits"]
    assert abs(sum(rows) / len(rows) - metered["mean_credits"]) < 0.01
    assert abs(sum(rows) / len(rows) * PERIOD["credit_to_usd"] - metered["mean_usd"]) < 0.005
    assert PERIOD["spread_usd"] == [min(rows) * PERIOD["credit_to_usd"],
                                    max(rows) * PERIOD["credit_to_usd"]]


def test_nothing_on_this_account_was_bought():
    """The prices in this file are what a granted account was charged, and it says so.

    A reader who takes $0.40 a call as a market price is reading one account funded by two
    grants. The file has to carry that next to the figure, because it is the first thing a
    district's finance office would ask and the entry cannot answer it later.
    """
    funding = PRICE["funding"]
    assert funding["paid_by_the_author_usd"] == 0.0
    assert len(funding["grants"]) == 2
    assert sum(g["usd"] for g in funding["grants"]) == 11.0
    for grant in funding["grants"]:
        assert abs(grant["usd"] * 100 - grant["credits"]) < 0.5, (
            f"{grant['at']} credits and dollars disagree at one cent a credit")
    assert "200 free calls" in funding["grants"][1]["what"], (
        "the challenge grant was issued as a call count, and that count is what dates it")


def test_the_page_leads_with_the_rate_the_account_pays_now():
    """The flat rate is history and the page has to say which is which."""
    page = APP / "out" / "index.html"
    if not page.exists():
        pytest.skip("the built page is not on this machine")
    html = page.read_text(encoding="utf-8")
    metered = PERIOD["metered_rate"]
    assert f'${metered["mean_usd"]:,.2f}' in html
    assert "Legacy pricing" in html, (
        "the page quotes a price without naming the rate CALL-E retired under it")
