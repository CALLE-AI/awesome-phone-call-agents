"""Keys come from the authorization, so a retry is free and a re-check is deliberate."""

from __future__ import annotations

import pytest

from warrantyops.idempotency import (
    MAX_KEY_LENGTH,
    IdempotencyError,
    derive_idempotency_key,
)

BASE = dict(
    namespace="warrantyops",
    authorization_record_reference="vault://authorizations/2026-09-01/acme",
    case_reference="CASE-1042",
    contract_version="warranty-recovery/v0",
)


def test_the_same_authorized_operation_always_derives_the_same_key():
    assert derive_idempotency_key(**BASE) == derive_idempotency_key(**BASE)


def test_a_different_case_derives_a_different_key():
    other = {**BASE, "case_reference": "CASE-1043"}
    assert derive_idempotency_key(**BASE) != derive_idempotency_key(**other)


def test_a_different_authorization_derives_a_different_key():
    other = {**BASE, "authorization_record_reference": "vault://authorizations/other"}
    assert derive_idempotency_key(**BASE) != derive_idempotency_key(**other)


def test_a_contract_change_derives_a_different_key():
    other = {**BASE, "contract_version": "warranty-recovery/v1"}
    assert derive_idempotency_key(**BASE) != derive_idempotency_key(**other)


def test_a_recheck_needs_an_explicit_token():
    """Reusing the original key would return the answer being re-checked."""

    original = derive_idempotency_key(**BASE)
    recheck = derive_idempotency_key(**BASE, recheck_token="2026-09-01T14")
    assert original != recheck
    assert derive_idempotency_key(**BASE, recheck_token="2026-09-01T14") == recheck


def test_the_key_fits_the_documented_header_limit():
    key = derive_idempotency_key(**BASE)
    assert 1 <= len(key) <= MAX_KEY_LENGTH


def test_incomplete_inputs_are_refused_rather_than_defaulted():
    for field in ("authorization_record_reference", "case_reference"):
        with pytest.raises(IdempotencyError):
            derive_idempotency_key(**{**BASE, field: "   "})
    with pytest.raises(IdempotencyError):
        derive_idempotency_key(**{**BASE, "namespace": "Not A Slug"})
