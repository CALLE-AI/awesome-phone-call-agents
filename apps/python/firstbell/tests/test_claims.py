"""The numbers in judge-facing files have to match the repository.

A README that says 64 tests when there are 84 is a small lie that costs more than the
sentence is worth, and it happens by drift rather than by intent. These tests make the
drift fail the suite.

The count comes from pytest's own collection, not from counting `def test_` in the source.
The README states what `pytest -q` prints, and parametrised tests make those two numbers
differ: 78 functions collect as 84 cases here. Counting the source would have compared the
README against a number no reader ever sees, which is the same class of error as measuring
the wrong property and calling it a gate.

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
