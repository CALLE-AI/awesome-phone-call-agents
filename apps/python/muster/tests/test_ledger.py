"""The tamper-evident chain.

A scheme that can rewrite its own history cannot use it as evidence. These
tests break the chain in every way it can be broken -- editing an attestation,
rewriting a link, forging a hash, deleting an entry -- and check that `verify`
names the first place the record stopped adding up.

It is an integrity check, not a security system. Nothing here proves who wrote
an entry, and no test below should ever pretend otherwise.
"""

from __future__ import annotations

import dataclasses
from datetime import datetime, timedelta, timezone

import pytest

from muster.ledger import GENESIS, Entry, Ledger, digest
from muster.models import Attestation, Grade

FIXED_NOW = datetime(2026, 9, 8, 9, 30, tzinfo=timezone.utc)


def attested(
    grade: Grade = Grade.CONFIRMED_LIVE,
    run_id: str = "run-0001",
    when: datetime = FIXED_NOW,
    **overrides: object,
) -> Attestation:
    """One attestation, built directly so a test can change exactly one field."""
    fields: dict[str, object] = {
        "subject_id": "subj-0001",
        "run_id": run_id,
        "graded_at": when,
        "grade": grade,
        "reasons": ("self_identified",),
        "evidence_quotes": ("Yes, that's me.",),
        "nonce_ok": True,
        "challenges_passed": 2,
        "challenges_asked": 2,
        "coaching_suspected": False,
        "call_id": "call-0001",
    }
    fields.update(overrides)
    return Attestation(**fields)  # type: ignore[arg-type]


def chain_of(count: int) -> Ledger:
    """A ledger of `count` distinct attestations, a month apart."""
    ledger = Ledger()
    for index in range(count):
        ledger.append(
            attested(run_id=f"run-{index:04d}", when=FIXED_NOW + timedelta(days=30 * index))
        )
    return ledger


# --------------------------------------------------------------------------
# Building the chain
# --------------------------------------------------------------------------


def test_an_empty_ledger_heads_at_genesis() -> None:
    assert Ledger().head == GENESIS
    assert GENESIS == "0" * 64


def test_the_first_entry_links_to_genesis() -> None:
    ledger = Ledger()
    entry = ledger.append(attested())
    assert entry.previous == GENESIS
    assert entry.this == digest(GENESIS, entry.attestation)
    assert ledger.head == entry.this


def test_each_entry_links_to_the_one_before_it() -> None:
    ledger = chain_of(4)
    assert ledger.entries[0].previous == GENESIS
    for earlier, later in zip(ledger.entries, ledger.entries[1:]):
        assert later.previous == earlier.this


def test_append_returns_the_entry_it_added() -> None:
    ledger = Ledger()
    first = ledger.append(attested(run_id="run-a"))
    second = ledger.append(attested(run_id="run-b"))
    assert ledger.entries == [first, second]
    assert ledger.head == second.this


def test_the_ledger_keeps_the_attestation_itself_not_only_its_hash() -> None:
    """A chain of hashes proves nothing to a caseworker who cannot read the
    attestation the hash was taken over."""
    attestation = attested()
    entry = Ledger().append(attestation)
    assert entry.attestation is attestation


# --------------------------------------------------------------------------
# Verifying an intact chain
# --------------------------------------------------------------------------


def test_an_empty_chain_verifies() -> None:
    """Nothing recorded is not the same as something tampered with."""
    assert Ledger().verify() == (True, None)


def test_a_chain_of_one_verifies() -> None:
    assert chain_of(1).verify() == (True, None)


@pytest.mark.parametrize("length", [0, 1, 2, 5, 20])
def test_a_chain_of_any_length_verifies_while_untouched(length: int) -> None:
    intact, broken_at = chain_of(length).verify()
    assert intact is True
    assert broken_at is None


def test_appending_to_a_verified_chain_keeps_it_verified() -> None:
    ledger = chain_of(3)
    ledger.append(attested(grade=Grade.UNPROVEN, run_id="run-later"))
    assert ledger.verify() == (True, None)


# --------------------------------------------------------------------------
# Verifying a broken one
# --------------------------------------------------------------------------


def test_editing_an_attestation_after_the_fact_is_detected() -> None:
    """The case this exists for: a scheme quietly upgrading an old UNPROVEN to
    a pass so a run of missed calls looks like a run of good ones."""
    ledger = chain_of(3)
    original = ledger.entries[1]
    ledger.entries[1] = dataclasses.replace(
        original, attestation=dataclasses.replace(original.attestation, grade=Grade.UNPROVEN)
    )
    assert ledger.verify() == (False, 1)


def test_rewriting_a_link_is_detected() -> None:
    ledger = chain_of(3)
    ledger.entries[2] = dataclasses.replace(ledger.entries[2], previous=GENESIS)
    assert ledger.verify() == (False, 2)


def test_forging_an_entrys_own_hash_is_detected() -> None:
    ledger = chain_of(3)
    ledger.entries[0] = dataclasses.replace(ledger.entries[0], this="f" * 64)
    assert ledger.verify() == (False, 0)


def test_deleting_an_entry_from_the_middle_is_detected() -> None:
    """Removing a call is the quietest edit available, so it must not be the
    cheapest one to get away with."""
    ledger = chain_of(4)
    del ledger.entries[1]
    assert ledger.verify() == (False, 1)


def test_inserting_a_fabricated_entry_is_detected() -> None:
    ledger = chain_of(3)
    forged = Entry(attested(run_id="never-called"), GENESIS, "a" * 64)
    ledger.entries.insert(1, forged)
    assert ledger.verify() == (False, 1)


def test_verify_reports_the_first_broken_entry_not_the_last() -> None:
    """A break poisons every entry after it, so the index has to point at where
    the edit was made, not at where the damage ran out."""
    ledger = chain_of(5)
    for index in (1, 3):
        original = ledger.entries[index]
        ledger.entries[index] = dataclasses.replace(
            original,
            attestation=dataclasses.replace(original.attestation, run_id="rewritten"),
        )
    intact, broken_at = ledger.verify()
    assert intact is False
    assert broken_at == 1


@pytest.mark.parametrize("index", [0, 1, 2, 3])
def test_a_break_at_any_position_is_found_at_that_position(index: int) -> None:
    ledger = chain_of(4)
    original = ledger.entries[index]
    ledger.entries[index] = dataclasses.replace(
        original,
        attestation=dataclasses.replace(original.attestation, run_id="rewritten"),
    )
    assert ledger.verify() == (False, index)


def test_reordering_two_entries_is_detected() -> None:
    ledger = chain_of(3)
    ledger.entries[1], ledger.entries[2] = ledger.entries[2], ledger.entries[1]
    intact, broken_at = ledger.verify()
    assert intact is False
    assert broken_at == 1


# --------------------------------------------------------------------------
# The digest
# --------------------------------------------------------------------------


def test_the_digest_is_deterministic_for_the_same_input() -> None:
    """Two runs of the same auditor's script must agree, or the chain cannot be
    checked by anybody but the machine that wrote it."""
    attestation = attested()
    assert digest(GENESIS, attestation) == digest(GENESIS, attestation)
    assert digest(GENESIS, attested()) == digest(GENESIS, attested())


def test_the_digest_looks_like_a_sha256_hex_string() -> None:
    value = digest(GENESIS, attested())
    assert len(value) == 64
    assert set(value) <= set("0123456789abcdef")


def test_the_same_attestation_under_a_different_predecessor_hashes_differently() -> None:
    """This is what makes it a chain rather than a pile of hashes."""
    attestation = attested()
    assert digest(GENESIS, attestation) != digest("b" * 64, attestation)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("subject_id", "somebody-else"),
        ("run_id", "run-9999"),
        ("graded_at", FIXED_NOW + timedelta(seconds=1)),
        ("grade", Grade.UNPROVEN),
        ("reasons", ("freshness_challenge_failed",)),
        ("nonce_ok", False),
        ("challenges_passed", 1),
        ("challenges_asked", 3),
        ("coaching_suspected", True),
    ],
)
def test_changing_any_graded_field_changes_the_digest(field: str, value: object) -> None:
    """Every field a caseworker would act on is covered by the hash."""
    baseline = digest(GENESIS, attested())
    altered = digest(GENESIS, attested(**{field: value}))
    assert altered != baseline, f"editing {field} left the digest untouched"


def test_a_nonce_ok_of_none_is_distinguished_from_false() -> None:
    """Never asked and answered wrongly are different facts about a call, so
    they must not hash to the same entry."""
    assert digest(GENESIS, attested(nonce_ok=None)) != digest(GENESIS, attested(nonce_ok=False))


def test_the_digest_does_not_cover_the_evidence_quotes_or_the_call_id() -> None:
    """Characterisation of a real gap, not an endorsement.

    `digest` hashes the graded fields. It does not hash `evidence_quotes` -- the
    words a caseworker actually reads -- or `call_id`, the pointer back to the
    recording. Either can therefore be rewritten in place without breaking the
    chain, which is a weaker guarantee than "tamper-evident record of
    attestations" sounds like.

    Left as a characterisation because the grade and its reasons are what any
    decision is made on, and those are covered. If the quotes are ever meant to
    be evidence in their own right, add them to `digest` and this test should
    fail and be rewritten.
    """
    baseline = digest(GENESIS, attested())
    assert digest(GENESIS, attested(evidence_quotes=("Invented later.",))) == baseline
    assert digest(GENESIS, attested(call_id="call-9999")) == baseline
