"""Every tool that needs the uncommitted recordings says so in the same words.

The recordings of the real calls are held outside this repository, for the reason
`evidence/README.md` gives. So the ordinary experience of cloning this and running the
commands the README prints is a tool that cannot do what it was asked, through nobody's
fault. `tools/double_conformance.py` invented the answer for that: print a line beginning
COULD-NOT-MEASURE, explaining what is missing and what to read instead, and exit 3.

Two of the five did not. `replay_escalation.py` and `throughput.py` declared `--receipts`
as `required=True`, so argparse answered a reviewer who had followed the documentation with

    usage: throughput.py [-h] --receipts RECEIPTS [--pupils PUPILS]
    throughput.py: error: the following arguments are required: --receipts

and exit code 2, which is the code for using a tool wrongly. A third exited 1, which reads
as a check that failed. A reviewer cannot tell those apart from a real defect, and this
entry spends nine documents arguing that a run has three outcomes rather than two.

This gate is over the exit code and the first word, not the sentence, so the explanations
stay free to be rewritten. The subprocess environment has `FIRSTBELL_RECEIPTS` removed,
because on the author's machine it is set and every one of these tools would then succeed.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent

# Every tool whose only source is the recordings. Not `money_across_runs.py`,
# `make_figure.py`, `make_shape_fixtures.py` or `pool_recorded_calls.py`: each of those has a
# committed record to fall back on and does real work without any receipts at all, which is a
# fourth behaviour and the right one for them.
NEEDS_THE_RECORDINGS = [
    "double_conformance.py",
    "video_facts.py",
    "replay_escalation.py",
    "throughput.py",
    "judge_page.py",
]


def _without_receipts() -> dict[str, str]:
    env = dict(os.environ)
    env.pop("FIRSTBELL_RECEIPTS", None)
    return env


@pytest.mark.parametrize("tool", NEEDS_THE_RECORDINGS)
def test_a_tool_with_no_receipts_reports_the_third_outcome(tool: str):
    """Run it the way a reviewer with a fresh clone runs it, and read what comes back."""
    assert (APP / "tools" / tool).is_file(), f"tools/{tool} has been moved or renamed"

    run = subprocess.run(
        [sys.executable, f"tools/{tool}"],
        cwd=APP, env=_without_receipts(),
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
    said = (run.stdout + run.stderr).strip()
    first = said.splitlines()[0].strip() if said else ""

    assert said, (
        f"tools/{tool} run with no receipts printed nothing at all and exited "
        f"{run.returncode}. Silence is the one answer a reviewer cannot act on.")
    assert first.startswith("COULD-NOT-MEASURE"), (
        f"tools/{tool} run with no receipts answers a reviewer with:\n    {first[:160]}\n"
        "The recordings are held outside this repository on purpose, so this is the "
        "expected result for everyone but the author, and it is neither a failure nor a "
        "misuse. Print a line beginning COULD-NOT-MEASURE, the way "
        "tools/double_conformance.py does.")
    assert run.returncode == 3, (
        f"tools/{tool} reported COULD-NOT-MEASURE and exited {run.returncode}. "
        "3 is the third outcome throughout this entry; 1 reads as a failing check and 2 as "
        "an argparse usage error, and a reviewer cannot tell either from a real defect.")


def test_the_third_outcome_names_something_a_reader_can_go_and_read():
    """A tool that cannot measure has to leave the reviewer somewhere to go.

    Exit 3 with "no receipts" and nothing else is a dead end. Each of these computes a
    figure that is published in the tree, so the message names the file or the flag that
    gets the reader to it. Checked as a class rather than sentence by sentence: the answer
    mentions the flag, the environment variable, or a path inside this repository.
    """
    silent = []
    for tool in NEEDS_THE_RECORDINGS:
        run = subprocess.run(
            [sys.executable, f"tools/{tool}"],
            cwd=APP, env=_without_receipts(),
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
        said = run.stdout + run.stderr
        if not any(clue in said for clue in
                   ("--receipts", "FIRSTBELL_RECEIPTS", "evidence/", "README.md")):
            silent.append(tool)
    assert not silent, (
        "these tools report COULD-NOT-MEASURE and give the reviewer nowhere to go next: "
        + ", ".join(silent)
        + ". Name the flag, the environment variable, or the committed file that holds the "
        "figure.")
