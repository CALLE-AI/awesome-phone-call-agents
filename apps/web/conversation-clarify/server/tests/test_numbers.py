from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.numbers import (  # noqa: E402
    accept_typed, find_candidates, is_dialable, mask, mask_text, normalise,
)
from app.thread import thread_from_payload  # noqa: E402

# Numbers below are in the ranges reserved for documentation and fiction.
RESERVED_US = "+15550100"
SIGNATURE = "Alex Doe\nOperations\n+1 555 010 0142\nexample.test"


def build(*messages):
    return thread_from_payload({
        "thread_id": "t", "subject": "s",
        "messages": [
            {"sender": "Me" if me else "Alex", "from_me": me, "body": body}
            for me, body in messages
        ],
    })


def test_e164_rejects_unicode_digits():
    # Arabic-Indic digits. Python's \d matches these; [0-9] does not.
    assert not is_dialable("+٩١٩٨١٢٣٤٥٦")


def test_e164_basics():
    assert is_dialable("+15550100142")
    assert not is_dialable("15550100142")      # no plus
    assert not is_dialable("+05550100142")     # leading zero after plus
    assert not is_dialable("+1555")            # too short
    assert not is_dialable("")


def test_normalise_does_not_invent_a_country_code():
    assert normalise("(555) 010-0142") == "5550100142"
    assert not is_dialable(normalise("(555) 010-0142"))


def test_normalise_rejects_malformed_plus():
    assert normalise("+1+555") == ""
    assert normalise("1+555") == ""


def test_mask_keeps_country_code_and_last_two():
    for number in ("+15550100142", "+442079460018", "+6555010142"):
        masked = mask(number)
        assert len(masked) == len(number)          # length is not a secret
        assert masked.startswith(number[:3])       # country code stays readable
        assert masked.endswith(number[-2:])        # last two for recognisability
        assert masked[3:-2] == "*" * (len(number) - 5)
        assert number[3:-2] not in masked          # the middle is genuinely gone


def test_mask_text_handles_many_shapes():
    raw = "call +1 555 010 0142 or (555) 010-0143 or 00915550100144 or 555.010.0145"
    out = mask_text(raw)
    assert "0142" not in out
    assert "010-0143" not in out
    assert "0100144" not in out
    assert "010.0145" not in out


def test_candidates_come_only_from_the_other_party():
    thread = build(
        (True, f"Here is my number {RESERVED_US}0142"),
        (False, SIGNATURE),
    )
    candidates, lookup = find_candidates(thread)
    assert all(c.sender == "Alex" for c in candidates)
    assert len(lookup) == 1


def test_candidate_without_country_code_is_surfaced_but_not_dialable():
    thread = build((True, "?"), (False, "Reach me on (555) 010-0142"))
    candidates, lookup = find_candidates(thread)
    assert candidates and not candidates[0].dialable
    assert "country code" in candidates[0].reason
    assert lookup == {}


def test_reference_numbers_are_ignored():
    thread = build((True, "?"), (False, "Invoice 4455 010 0142 is attached"))
    candidates, _ = find_candidates(thread)
    assert candidates == []


def test_candidate_context_is_masked():
    thread = build((True, "?"), (False, "Direct line +1 555 010 0142 anytime"))
    candidates, _ = find_candidates(thread)
    assert "0142" not in candidates[0].context
    assert "0142" not in candidates[0].masked


def test_plain_number_never_appears_in_candidate_objects():
    thread = build((True, "?"), (False, SIGNATURE))
    candidates, lookup = find_candidates(thread)
    full = list(lookup.values())[0]
    serialised = repr([c.to_dict() for c in candidates])
    assert full not in serialised


def test_typed_number_must_be_international():
    assert accept_typed("5550100142")[1]
    assert accept_typed("+15550100142") == ("+15550100142", "")
