"""Manifest compilation from a claim file."""

from __future__ import annotations

from claimcall import manifest as manifest_mod
from claimcall.schemas import ClaimFile

from .conftest import load_claim


def test_a_claim_file_compiles_to_a_sealed_plan():
    m = manifest_mod.build(load_claim("eligible-claim.json"))
    assert m.content_hash
    assert m.content_hash == manifest_mod.compute_manifest_hash(m)
    assert m.recipient_organization == "Auralite Demo Service Desk"


def test_the_same_claim_file_always_produces_the_same_hash():
    source = load_claim("eligible-claim.json")
    assert manifest_mod.build(source).content_hash == manifest_mod.build(source).content_hash


def test_editing_the_claim_file_changes_the_hash():
    source = load_claim("eligible-claim.json")
    before = manifest_mod.build(source).content_hash
    source.product.serial_number = "AURS2-0000-00AA"
    assert manifest_mod.build(source).content_hash != before


def test_only_allowlisted_fields_are_disclosed():
    m = manifest_mod.build(load_claim("eligible-claim.json"))
    for disclosure in m.disclosures:
        assert disclosure.fact_path in manifest_mod.DISCLOSABLE_PATHS


def test_the_plan_renders_without_the_raw_number():
    m = manifest_mod.build(load_claim("eligible-claim.json"))
    text = manifest_mod.render_human(m)
    assert "+15005550006" not in text
    assert "AURS2-3391-77TQ" in text


def test_the_call_task_discloses_automation_and_forbids_commitments():
    task = manifest_mod.render_call_task(manifest_mod.build(load_claim("eligible-claim.json")))
    assert "automated assistant" in task
    assert "You may not accept any fee or charge." in task
    assert "Do not authorise a factory reset" in task
    assert "claimcall.result.v1" in task


def test_an_empty_recipient_is_rejected_at_the_schema():
    import pydantic
    import pytest

    with pytest.raises(pydantic.ValidationError):
        ClaimFile.model_validate({"owner_display_name": "R", "issue": "x", "product": {}})
