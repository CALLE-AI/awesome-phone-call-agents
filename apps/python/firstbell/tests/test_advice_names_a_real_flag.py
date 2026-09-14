"""Every flag this app tells an operator to pass must be a flag it accepts.

`--column-map` was named in three user-facing strings, honoured by `CsvSource.__init__` and
by `recognise()`, and never registered on the parser. An operator whose export was not one
of the three built-in dialects read the refusal, typed what it said, and got an argparse
error. The whole custom-mapping path was unreachable from the command line, and the suite
did not notice because the tests construct `CsvSource(column_map=...)` in Python.

Written as a sweep rather than one case, because the defect was not that one flag was
missing. It was that nothing compared the advice against the parser.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))

from firstbell.cli import build_parser  # noqa: E402

# Where an operator is told what to do next: the modules that raise or print refusals.
ADVICE_SOURCES = ("dispatch/sources.py", "dispatch/dialects.py", "dispatch/models.py",
                  "dispatch/scheduler.py", "dispatch/consent.py", "firstbell/cli.py",
                  "firstbell/domain.py")

FLAG = re.compile(r"--[a-z][a-z0-9-]{2,}")

# Flags that belong to another program, named in prose about that program rather than as
# advice about this one. Each is listed with the reason it is not firstbell's to accept.
NOT_OURS = {
    "--records": "tools/adopt_call_records.py",
    "--consent-register": "tools/adopt_call_records.py",
    "--fail-on-uncovered": "tools/adopt_call_records.py",
    "--receipts": "tools/pool_recorded_calls.py and tools/replay_escalation.py",
    "--check": "tools/pool_recorded_calls.py",
    "--today": "tools/adopt_call_records.py",
    "--out": "tools/judge_page.py",
}


def _registered() -> set[str]:
    known = set()
    for action in build_parser()._actions:
        known.update(action.option_strings)
    return known


def _advertised() -> dict[str, set[str]]:
    found: dict[str, set[str]] = {}
    for name in ADVICE_SOURCES:
        text = (APP / name).read_text(encoding="utf-8")
        for flag in FLAG.findall(text):
            found.setdefault(flag, set()).add(name)
    return found


def test_every_flag_named_in_advice_is_a_flag_the_parser_accepts():
    known = _registered()
    missing = {
        flag: sorted(where)
        for flag, where in _advertised().items()
        if flag not in known and flag not in NOT_OURS
    }
    assert not missing, (
        "these are named in a refusal or a docstring an operator reads, and argparse "
        f"rejects them: {missing}. Register the flag or stop advertising it.")


@pytest.mark.parametrize("flag", ["--column-map", "--consent-records", "--work-drop"])
def test_the_flags_the_dialect_refusal_names_are_registered(flag):
    """The three the unattended path needs, asserted by name so the sweep cannot drift."""
    assert flag in _registered()


def test_column_map_reaches_the_source_and_not_just_the_parser():
    """Registering the flag is half of it; `main()` also has to pass it on."""
    text = (APP / "firstbell" / "cli.py").read_text(encoding="utf-8")
    assert "column_map=column_map" in text, (
        "the flag parses and is then dropped, which is the same defect one layer in")
    assert text.count("column_map=column_map") >= 2, (
        "both the work-file path and the drop path have to receive it")
