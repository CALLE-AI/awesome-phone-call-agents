"""The numbers in judge-facing files have to match the repository.

A README that says 64 tests when there are 84 is a small lie that costs more than the
sentence is worth, and it happens by drift rather than by intent. These tests make the
drift fail the suite.

The count comes from pytest's own collection, not from counting `def test_` in the source.
The README states what `pytest -q` prints, and parametrised tests make those two numbers
differ, so counting the source would compare the README against a number no reader ever
sees: the same class of error as measuring the wrong property and calling it a gate.

No count is written down here. A file whose job is to catch drift should not carry a
figure that drifts, and an earlier version of this docstring did exactly that.

`--collect-only` imports the modules but runs nothing, so calling it from inside the suite
terminates.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
COUNT = re.compile(r"(\d+) tests? collected")


def _collected_test_count() -> int:
    out = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/", "--collect-only", "-q"],
        cwd=APP, capture_output=True, text=True, encoding="utf-8", errors="replace",
    ).stdout
    match = COUNT.search(out)
    assert match, "could not read a collection count from pytest: " + out[-300:]
    return int(match.group(1))


def test_the_readme_states_the_real_number_of_tests():
    readme = (APP / "README.md").read_text(encoding="utf-8")
    claimed = re.search(r"pytest tests/ -q\s*#\s*(\d+) tests", readme)
    assert claimed, "the README no longer states a test count where this test looks for it"
    assert int(claimed.group(1)) == _collected_test_count()


def test_the_readme_sample_is_what_the_program_actually_prints():
    """The sample run had drifted by a whole output block before this gate existed.

    It compares rather than regenerates. A gate that produced the artifact it checks
    would pass by construction and prove nothing, so regeneration stays a separate,
    deliberate act and this only ever reports a mismatch.

    The offline double is deterministic, so a difference here is a real difference and
    not thread ordering.
    """
    readme = (APP / "README.md").read_text(encoding="utf-8")
    blocks = re.findall(r"```\n(OFFLINE\..*?)```", readme, re.S)
    assert len(blocks) == 1, "expected exactly one sample run in the README"
    run = subprocess.run(
        [sys.executable, "-m", "firstbell", "--work-file", "examples/absences.csv"],
        cwd=APP, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    assert run.returncode == 0, run.stderr[-400:]
    printed = run.stdout.replace("\r\n", "\n").strip()
    assert blocks[0].strip() == printed, (
        "The README sample no longer matches the program. Regenerate it rather than "
        "editing it by hand."
    )


def test_the_prose_numbers_match_the_program_too():
    """The excerpt and the derived figure in the README are quoted by hand.

    The generated sample block sits directly above them, which makes them look as though
    something checks them. Until this test, nothing did.

    `$0.67` is not printed as a bare string anywhere: it is the three-minute case of the
    per-minute ceiling, so it is recomputed here rather than searched for.
    """
    from firstbell.domain import StaffCost

    readme = (APP / "README.md").read_text(encoding="utf-8")
    run = subprocess.run(
        [sys.executable, "-m", "firstbell", "--work-file", "examples/absences.csv"],
        cwd=APP, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    assert run.returncode == 0, run.stderr[-400:]
    printed = run.stdout.replace("\r\n", "\n")

    quoted = [
        "attempts billed     7",
        "attempts removed    4",
        "attempts still open 3",
        "break-even          $0.22 per call, for every minute one manual attempt takes",
    ]
    for line in quoted:
        assert line in printed, "the README quotes a line the program no longer prints: " + line
        assert line in readme, "the program prints a line the README no longer quotes: " + line

    # The derived three-minute figure, recomputed from the same inputs.
    staff = StaffCost.us_school_office()
    ceiling = (4 / 7) * (staff.hourly / 60.0)
    assert f"**${ceiling * 3:,.2f} a call**" in readme, (
        "the README's three-minute break-even no longer matches the arithmetic"
    )
    assert f"**${staff.annual:,.0f}**" in readme, (
        "the README's wage no longer matches the sourced figure"
    )
    assert staff.source_url in readme


ANCHOR = re.compile(r"`([^`]+)` at\s*\n?\s*`([a-z_/]+\.py):(\d+)`")


def test_every_cited_line_number_still_says_what_the_readme_claims():
    """A line number in prose rots the first time anything above it moves.

    The README points a reader at four exact lines for where CALL-E is called. Each
    citation names the symbol it expects to find there, so this can check the pair rather
    than just that the file exists.

    The count assertion is the important half. Without it, deleting every anchor would
    make this test pass on an empty list, which is the way a check like this usually dies.
    """
    readme = (APP / "README.md").read_text(encoding="utf-8")
    pairs = ANCHOR.findall(readme)
    assert len(pairs) >= 4, (
        f"expected at least 4 runtime anchors in the README, found {len(pairs)}. "
        "If they were removed on purpose, lower this number deliberately."
    )
    for symbol, path, line in pairs:
        target = APP / path
        assert target.exists(), f"the README cites {path}, which does not exist"
        lines = target.read_text(encoding="utf-8").splitlines()
        number = int(line)
        assert number <= len(lines), (
            f"the README cites {path}:{number} but the file has {len(lines)} lines"
        )
        assert symbol in lines[number - 1], (
            f"the README says {symbol!r} is at {path}:{number}, but that line is "
            f"{lines[number - 1].strip()!r}"
        )


def test_the_ten_minute_reading_order_points_at_files_that_exist():
    """Five links on the first screen. A dead one there is worse than no list."""
    readme = (APP / "README.md").read_text(encoding="utf-8")
    order = readme.split("## If you have ten minutes", 1)
    assert len(order) == 2, "the README no longer has a reading order"
    table = order[1].split("### Where CALL-E is called", 1)[0]
    linked = re.findall(r"\]\(([^)]+)\)", table)
    assert len(linked) == 5, f"expected five files in the reading order, found {len(linked)}"
    for rel in linked:
        assert (APP / rel).exists(), f"the reading order points at {rel}, which does not exist"


def test_the_mutation_table_is_numbered_without_gaps():
    """Rows are numbered by hand, so a row inserted in the middle silently duplicates an id."""
    table = (APP / "evidence" / "MUTATIONS.md").read_text(encoding="utf-8")
    ids = [int(m) for m in re.findall(r"^\| (\d+) \|", table, re.M)]
    assert ids, "no mutation rows found"
    assert ids == list(range(1, len(ids) + 1)), "mutation ids are not 1..n: " + str(ids)


def test_every_committed_receipt_is_described():
    listed = (APP / "evidence" / "README.md").read_text(encoding="utf-8")
    for receipt in sorted((APP / "evidence").glob("0*.json")):
        assert receipt.name in listed, receipt.name + " is committed but not described"


def test_no_receipt_claims_production_without_naming_the_host():
    """A receipt that says it reached production must say where, or it cannot be checked."""
    for receipt in sorted((APP / "evidence").glob("0*.json")):
        data = json.loads(receipt.read_text(encoding="utf-8"))
        if data.get("reached_production_api"):
            assert "heycall-e.com" in (data.get("api_base_url") or ""), receipt.name
