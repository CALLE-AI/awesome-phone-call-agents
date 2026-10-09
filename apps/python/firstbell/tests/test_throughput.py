"""The morning's length, and the README's copy of it.

Two claims that can rot in different directions. The tool can start computing something
else, and the README can keep quoting a number the tool no longer produces. So the
arithmetic is checked against fixtures here, and the published block is checked against
the tool's own output when the receipts are on the machine.
"""
from __future__ import annotations

import inspect
import json
import re
from pathlib import Path

import pytest

from tools.throughput import POLL_SECONDS, call_lengths, minutes

APP = Path(__file__).resolve().parent.parent


def receipt(tmp_path, name, offsets_per_call):
    payload = {"items": [
        {"id": f"S-{n}",
         "transcript": [{"offset_seconds": o} for o in offsets]}
        for n, offsets in enumerate(offsets_per_call)
    ]}
    (tmp_path / name).write_text(json.dumps(payload), encoding="utf-8")
    return tmp_path


def test_a_calls_length_is_its_last_turn_not_its_first(tmp_path):
    receipt(tmp_path, "run.json", [[0.0, 12.0, 47.0]])
    assert call_lengths(tmp_path) == [47.0]


def test_a_call_with_no_timed_turn_contributes_nothing_rather_than_a_zero(tmp_path):
    """A zero would claim a call took no time and drag the mean down with the very calls
    this cannot measure."""
    receipt(tmp_path, "run.json", [[0.0, 40.0], []])
    assert call_lengths(tmp_path) == [40.0]


def test_a_call_with_no_transcript_key_at_all_is_skipped(tmp_path):
    (tmp_path / "run.json").write_text(json.dumps({"items": [{"id": "S-1"}]}),
                                       encoding="utf-8")
    assert call_lengths(tmp_path) == []


def test_a_receipt_that_is_not_json_does_not_stop_the_others(tmp_path):
    receipt(tmp_path, "good.json", [[0.0, 30.0]])
    (tmp_path / "bad.json").write_text("{ not json", encoding="utf-8")
    assert call_lengths(tmp_path) == [30.0]


def test_an_empty_directory_measures_nothing(tmp_path):
    assert call_lengths(tmp_path) == []


def test_every_receipt_in_the_directory_is_read(tmp_path):
    receipt(tmp_path, "a.json", [[0.0, 10.0]])
    receipt(tmp_path, "b.json", [[0.0, 20.0]])
    assert sorted(call_lengths(tmp_path)) == [10.0, 20.0]


def test_a_partial_wave_still_costs_a_whole_call():
    """Five pupils at concurrency four is two waves, not one and a quarter."""
    assert minutes(5, 4, 60.0) == pytest.approx(2.0)
    assert minutes(4, 4, 60.0) == pytest.approx(1.0)


def test_one_pupil_is_one_wave():
    assert minutes(1, 25, 60.0) == pytest.approx(1.0)


def test_raising_the_cap_shortens_the_morning():
    assert minutes(500, 12, 53.0) < minutes(500, 4, 53.0)


def test_the_poll_interval_is_read_off_the_scheduler_rather_than_written_down():
    """A number copied into a second file is a number that will disagree with the first.

    This is the check that makes the throughput claim a measurement. If somebody changes
    the poll interval in `WaveDispatcher` and this tool keeps its own copy, the published
    figure becomes an assumption again without anything failing.
    """
    from dispatch.scheduler import WaveDispatcher

    signature = inspect.signature(WaveDispatcher.__init__)
    assert POLL_SECONDS == float(
        signature.parameters["poll_interval_seconds"].default
    ), "the tool's poll interval is not the one the dispatcher waits"


_CAP_WORDS = {3: "Three", 4: "Four", 6: "Six", 8: "Eight", 10: "Ten", 12: "Twelve",
              16: "Sixteen", 20: "Twenty", 25: "Twenty-five"}


def _spelled_cap(n: int) -> str:
    """The README sets a cap that opens a sentence as a word, so match either form."""
    return f"(?:{n}|{_CAP_WORDS.get(n, n)})"

def test_the_readme_block_is_what_the_tool_prints_now():
    """The published figures, against the tool run on the receipts that produced them.

    Skipped rather than guessed when the receipts are not on the machine. They are held
    outside this repository on purpose (`evidence/README.md` says why), so a clone cannot
    run this and a clone should not be told the numbers are wrong.
    """
    import os
    import subprocess
    import sys

    receipts = Path(os.environ.get("FIRSTBELL_RECEIPTS") or (APP / "evidence" / "receipts"))
    if not receipts.is_dir() or not any(receipts.glob("*.json")):
        pytest.skip(f"no receipts under {receipts}, so the published block cannot be "
                    "compared against a measurement")

    # The same ladder the README prints, not the tool's default one.
    #
    # This asked for the default ladder and then asserted the README named its lowest
    # fitting cap, which was 12 only because the default list skips 6, 8 and 10. The
    # evidence page walks the wider ladder and recommended 6, so the two judge-facing
    # surfaces disagreed about the answer while this test held the README to the wrong
    # one. Reading the ladder out of the block under test means the check is that the
    # prose matches the table beside it, whatever ladder that table is built from.
    caps = sorted({int(c) for c in re.findall(r"concurrency\s+(\d+)\s+[\d.]+ min",
                                              (APP / "README.md").read_text(encoding="utf-8"))})
    assert caps, "the README publishes no concurrency rows to check against"
    out = subprocess.run(
        [sys.executable, "tools/throughput.py", "--receipts", str(receipts),
         "--pupils", "500", "--concurrency", *[str(c) for c in caps], "--json"],
        cwd=APP, capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    now = json.loads(out.stdout)

    readme = (APP / "README.md").read_text(encoding="utf-8")
    start = readme.find("## Whether it finishes before the cutoff")
    assert start > 0, "the README no longer publishes a throughput figure"
    block = readme[start:readme.find("## ", start + 10)]

    assert f"mean {now['mean_call_seconds']:.1f}s" in block, (
        f"the README quotes a mean the tool no longer produces ({now['mean_call_seconds']}s)"
    )
    assert f"{now['calls_measured']} real call(s)" in block
    for cap, mins in now["minutes_by_concurrency"].items():
        assert re.search(rf"concurrency\s+{cap}\s+{mins:.1f} min", block), (
            f"the README's row for concurrency {cap} is not {mins:.1f} min"
        )
    fits = now["lowest_concurrency_that_fits"]
    assert fits is not None and re.search(rf"\b{_spelled_cap(fits)} fits the window", block), (
        f"the README does not name {fits} as the lowest cap that fits"
    )
