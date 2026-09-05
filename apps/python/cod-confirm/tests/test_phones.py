"""Which numbers may be dialled, and how they may be printed.

The order book decides who gets rung, so it is an injection surface. A
malformed or unauthorised number is a call placed to somebody who never
asked for one.
"""
from __future__ import annotations

import pytest

from codconfirm import phones


def test_a_plain_e164_number_passes():
    assert phones.normalise("+8801700000001") == "+8801700000001"


def test_the_punctuation_people_write_is_removed():
    assert phones.normalise(" +880 (17) 0000-0001 ") == "+8801700000001"


@pytest.mark.parametrize("bad", [
    "01700000001",          # no country code
    "+0800000000",          # country code cannot start with zero
    "8801700000001",        # no plus
    "+88017",               # too short to be a real destination
    "+8801700000001234567", # too long
    "+880 17 abc 0001",     # letters
    "",
])
def test_anything_not_e164_is_refused(bad):
    with pytest.raises(phones.UnsafeNumber):
        phones.normalise(bad)


def test_a_lookalike_digit_is_refused_not_stripped():
    """U+0660 renders like a zero. Silently dropping it changes the number."""
    with pytest.raises(phones.UnsafeNumber):
        phones.normalise("+88017000٠0001")


def test_a_number_that_is_not_a_string_is_refused():
    with pytest.raises(phones.UnsafeNumber):
        phones.normalise(None)


def test_masking_keeps_enough_to_recognise_and_not_enough_to_dial():
    masked = phones.mask("+8801700000001")
    assert masked.startswith("+880")
    assert masked.endswith("001")
    assert "17000000" not in masked


def test_a_refusal_never_prints_the_whole_number():
    with pytest.raises(phones.UnsafeNumber) as caught:
        phones.normalise("+880171234567890123")
    assert "171234567890123" not in str(caught.value)


def test_with_no_allowlist_any_valid_number_is_allowed(monkeypatch):
    monkeypatch.delenv("CALL_ALLOWLIST", raising=False)
    assert phones.authorise("+8801700000001") == "+8801700000001"


def test_an_allowlist_keeps_a_test_run_off_a_stranger(monkeypatch):
    monkeypatch.setenv("CALL_ALLOWLIST", "+8801700000009")
    assert phones.authorise("+880 17 0000 0009") == "+8801700000009"
    with pytest.raises(phones.UnsafeNumber):
        phones.authorise("+8801700000001")
