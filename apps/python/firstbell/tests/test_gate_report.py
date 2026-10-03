"""The browser gates have to say what they did not measure, and the number has to be zero.

`tools/gates/run.mjs` reports three outcomes, and the third one is the whole point of it: a
run it could not resolve to a colour and a ground is neither a pass nor a fail. The count was
42 for as long as the gate existed, and nobody could act on it, because the report recorded a
number and not a reason. All 42 turned out to be transcript turns scrolled out of their own
box, which the page-level scroll never reached.

Two things came out of fixing that and both are checked here. The gate now steps every
internal scroll box through its own range, which took the count to zero. And it now takes a
census of every text run on the page and reports the ones the probe never reached, so the
zero means "none went unlooked at" rather than "none of the ones I happened to look at".
Without the census the same blinding leaves a clean PASS: measured drops from 678 to 595, the
unmeasured count stays at 0, and 81 runs of transcript go unread with nothing saying so.

This reads the report rather than running the gates, because running Chrome from pytest would
make the suite need a browser. It skips when there is no report, which is any checkout where
the gates have not been run, and that skip is declared in `GATES_THAT_CANNOT_ALWAYS_RUN`.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
REPORT = APP / "tools" / "gates" / "gate-report.json"
RUNNER = APP / "tools" / "gates" / "run.mjs"


def _contrast() -> dict:
    if not REPORT.exists():
        pytest.skip("no gate report; run `node tools/gates/run.mjs` first")
    # A report older than the page it is supposed to describe is about a different page, and
    # it reads exactly like a current one. Every number below would then be a measurement of
    # something that is no longer on disk, which is worse than having no report at all.
    page = APP / "out" / "index.html"
    if page.exists() and REPORT.stat().st_mtime < page.stat().st_mtime:
        pytest.skip("the gate report is older than out/index.html, so it describes an "
                    "earlier build; re-run `node tools/gates/run.mjs`")
    data = json.loads(REPORT.read_text(encoding="utf-8"))
    gates = data if isinstance(data, list) else data.get("gates", [])
    for gate in gates:
        if gate.get("name") == "contrast":
            return gate
    pytest.fail("the report has no contrast gate in it, so this is checking nothing")


def test_the_contrast_gate_left_nothing_unmeasured():
    """Zero is the target, and it is only worth having because the census earns it."""
    gate = _contrast()

    assert "unmeasured" in gate, (
        "the contrast gate has stopped reporting an unmeasured count, which is the one "
        "number that says whether its PASS covers the page or only part of it"
    )
    assert gate["unmeasured"] == 0, (
        f"{gate['unmeasured']} text run(s) were not measured: "
        f"{gate.get('unmeasuredReasons')}"
    )


def test_every_unmeasured_run_would_carry_a_reason():
    """A bare count cannot be acted on, so the shape that reports the reason is checked too.

    The list is empty while the count is zero. What this holds in place is the field: drop
    `unmeasuredReasons` from the report and the next non-zero count is a number with nothing
    attached to it again.
    """
    gate = _contrast()

    assert isinstance(gate.get("unmeasuredReasons"), list), (
        "the report no longer groups unmeasured runs by reason, so a future non-zero count "
        "would be a bare number nobody can act on"
    )
    counted = sum(entry["runs"] for entry in gate["unmeasuredReasons"])
    assert counted == gate["unmeasured"], (
        f"the reasons account for {counted} run(s) and the count says {gate['unmeasured']}; "
        "one of the two is not being computed from the runs"
    )

    # The census is the denominator, so it has to be checked like one. Deleting it changes
    # nothing visible on a page where the probe already reaches every run: the unmeasured
    # count stays at zero and every other number holds. That is a guard nothing can falsify,
    # which is the same as no guard. This is the number that makes deleting it fail.
    censused = gate.get("censused")
    assert isinstance(censused, int) and censused > 0, (
        "the contrast gate is not reporting a census size, so its unmeasured count is "
        "'none of the runs I happened to look at' and not 'none went unlooked at'"
    )
    assert censused >= gate["measured"], (
        f"the census holds {censused} run(s) and the probe measured {gate['measured']}; a "
        "denominator smaller than the thing it divides is not covering the page"
    )

    assert gate.get("groundless") == [], (
        f"text is painted with no opaque ground the gate can find behind it: "
        f"{gate.get('groundless')}. Those runs are the ones whose colour nobody has checked"
    )


def test_a_run_is_identified_by_which_element_it_is():
    """Identity, not content, and this is a source check because nothing else can catch it.

    A run used to be keyed by its class and the first thirty characters of its text, so any
    two elements sharing both were folded into one and only one of them was ever measured.
    Putting that back drops the measured count from 928 to 678 and every number in the report
    still agrees with itself: unmeasured stays zero, the census matches the probe because both
    were keyed the same wrong way, and the gate prints a clean PASS. There is no runtime
    assertion that fails, which is why the guard is here on the source instead.

    It reads the runner rather than the report for the same reason. The two keys have to stay
    the same key: a census keyed differently from the probe reports every run as unreached.
    """
    source = RUNNER.read_text(encoding="utf-8")

    assert source.count("const pathOf = (el) => {") == 2, (
        "the probe and the census no longer both build a path from the element; if only one "
        "of them does, every run will read as one the other never reached"
    )
    assert source.count("const key = pathOf(el);") == 1, (
        "the contrast probe no longer keys a run by which element it is"
    )
    assert source.count("keys.push({ key: pathOf(el)") == 1, (
        "the contrast census no longer keys a run by which element it is"
    )
    assert "own.slice(0, 30)" not in source, (
        "a run is being keyed by its text again, which folds two elements that share a class "
        "and an opening into one and measures only one of them"
    )

