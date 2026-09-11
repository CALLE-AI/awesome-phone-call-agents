"""Which numbers may be dialled, and how they may be printed.

The order book decides who gets rung, so it is an injection surface. A
malformed or unauthorised number is a call placed to somebody who never
asked for one.
"""
from __future__ import annotations

import pytest

from codconfirm import phones


def test_a_plain_e164_number_passes():
    assert phones.normalise("+99900000011") == "+99900000011"


def test_the_punctuation_people_write_is_removed():
    assert phones.normalise(" +999 (00) 000-011 ") == "+99900000011"


@pytest.mark.parametrize("bad", [
    "09900000011",          # no country code
    "+0800000000",          # country code cannot start with zero
    "99900000011",        # no plus
    "+99917",               # too short to be a real destination
    "+9990000001123456789", # too long
    "+999 00 abc 011",     # letters
    "",
])
def test_anything_not_e164_is_refused(bad):
    with pytest.raises(phones.UnsafeNumber):
        phones.normalise(bad)


def test_a_lookalike_digit_is_refused_not_stripped():
    """U+0660 renders like a zero. Silently dropping it changes the number."""
    with pytest.raises(phones.UnsafeNumber):
        phones.normalise("+99900000٠011")


def test_a_number_that_is_not_a_string_is_refused():
    with pytest.raises(phones.UnsafeNumber):
        phones.normalise(None)


def test_masking_keeps_enough_to_recognise_and_not_enough_to_dial():
    masked = phones.mask("+99900000011")
    assert masked.startswith("+999")
    assert masked.endswith("011")
    assert "00000" not in masked, "the middle is what must not survive"


def test_a_refusal_never_prints_the_whole_number():
    with pytest.raises(phones.UnsafeNumber) as caught:
        phones.normalise("+999123456789012345")
    assert "123456789012345" not in str(caught.value)


def test_with_no_allowlist_nothing_may_be_dialled(monkeypatch):
    """There is no unrestricted path. A number is dialled because it was named."""
    monkeypatch.delenv("CALL_ALLOWLIST", raising=False)
    with pytest.raises(phones.UnsafeNumber):
        phones.authorise("+99900000011")


def test_an_allowlist_keeps_a_test_run_off_a_stranger(monkeypatch):
    monkeypatch.setenv("CALL_ALLOWLIST", "+99900000019")
    assert phones.authorise("+999 00 000 019") == "+99900000019"
    with pytest.raises(phones.UnsafeNumber):
        phones.authorise("+99900000011")
