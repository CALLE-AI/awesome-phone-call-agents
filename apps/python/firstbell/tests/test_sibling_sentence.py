"""The sentence that asks about the other children in the house, and the one it must not say.

`dispatch/households.py` groups siblings so one guardian is phoned once about all of them,
and `firstbell/domain.py` turns that group into a sentence inside the instruction CALL-E
carries into the call. Nothing tested that sentence. It is the only part of the instruction
built from a list rather than a single field, it names children who are not the subject of
the call, and it went unsaid for a fortnight while three documents claimed it was said.

The case that matters is the empty one. The comment above the code says it plainly: with no
names there is no sentence, rather than a sentence about nobody. Getting that wrong does not
raise, does not fail a schema and does not look wrong in a receipt. It puts a sentence with a
hole in it into a real telephone call about somebody's child.
"""
from __future__ import annotations

import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

from dispatch.models import WorkItem  # noqa: E402
from firstbell.domain import build_task  # noqa: E402

SENTENCE = "The school has also not been told why"
HOUSE = "absent from the same house this morning"

# A zero-width space. Named rather than pasted, because a test whose meaning depends on an
# invisible character is a test that gets silently repaired by the next editor to touch it.
ZERO_WIDTH = "​"


def task(**context: str) -> str:
    base = {"student_name": "Nithya P", "school_name": "Ashwood Primary",
            "absence_date": "2026-09-04"}
    return build_task(WorkItem(id="S-1", phones=("+915550000001",),
                               context={**base, **context}))


def test_a_named_sibling_reaches_the_instruction() -> None:
    said = task(also_absent_names="Ravi K")
    assert SENTENCE in said, "the sibling sentence is missing from the instruction"
    assert "Ravi K" in said
    assert f"why Ravi K is {HOUSE}" in said, (
        "one sibling takes the singular verb, and the sentence reads to a person")


def test_two_siblings_take_the_plural() -> None:
    said = task(also_absent_names="Ravi K, Meera K")
    assert f"why Ravi K, Meera K are {HOUSE}" in said


def test_no_siblings_means_no_sentence() -> None:
    assert SENTENCE not in task()
    assert SENTENCE not in task(also_absent_names="")
    assert SENTENCE not in task(also_absent_names="   ")


def test_a_name_that_is_only_invisible_characters_produces_no_sentence() -> None:
    """The defect that was in the tree, and the reason the guard reads the sanitised value.

    `str.strip()` does not remove a zero-width space and `as_data` does, so a guard on the
    raw string passed while the value it rendered was empty. The instruction that came out
    told the agent to ask why nobody was absent. A roster exported from a spreadsheet with
    an invisible character in a cell is the ordinary way this arrives, and nothing upstream
    removes it: `households.py` filters on `.strip()` and truthiness, which this survives.
    """
    said = task(also_absent_names=ZERO_WIDTH)
    assert SENTENCE not in said, (
        "a name made only of format characters produced the sibling sentence with nothing "
        "in the name slot, which is the sentence about nobody the code says it cannot write")
    assert "why  is" not in said and "why  are" not in said, (
        "the instruction carries a hole where a child's name should be")


def test_an_invisible_character_beside_a_real_name_keeps_the_real_name() -> None:
    """Removing the character must not remove the sibling standing next to it."""
    said = task(also_absent_names=f"Ravi K{ZERO_WIDTH}, Meera K")
    assert "Ravi K" in said and "Meera K" in said
    assert ZERO_WIDTH not in said, "a format character reached the instruction"
