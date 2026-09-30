"""The disclosure envelope, the never-disclose rule, and the redactor."""
from __future__ import annotations

import os

import pytest

from tests.helpers import context, every_file_under, seed
from trunkline import plan as plan_mod, policy, redact, vault, workflows


def test_envelope_narrows_by_workflow(tmp_path):
    data = str(tmp_path)
    seed(data)

    claim_status = vault.resolve_envelope(data, "pt_0001", "claim_status")
    eligibility = vault.resolve_envelope(data, "pt_0001", "eligibility")

    assert claim_status.fields_disclosed == ["date_of_birth", "member_id", "patient_last_name"]
    # Eligibility does not need a name to verify coverage, so it never asks for one.
    assert eligibility.fields_disclosed == ["date_of_birth", "member_id"]
    assert "patient_last_name" not in eligibility.values


def test_never_disclose_fields_are_unreachable(tmp_path):
    data = str(tmp_path)
    seed(data)
    record = vault.get(data, "pt_0001")
    assert record["ssn_last4"] and record["medical_record_number"]

    for name in workflows.names():
        disclosure = vault.resolve_envelope(data, "pt_0001", name)
        for forbidden in policy.NEVER_DISCLOSE:
            assert forbidden not in disclosure.values


def test_envelope_cannot_be_widened_by_a_bad_policy_entry(tmp_path, monkeypatch):
    """Even if an envelope names a forbidden field, the resolver refuses it."""
    data = str(tmp_path)
    seed(data)
    monkeypatch.setitem(
        policy.DISCLOSURE_ENVELOPES, "claim_status",
        ("member_id", "date_of_birth", "ssn_last4", "medical_record_number"),
    )
    disclosure = vault.resolve_envelope(data, "pt_0001", "claim_status")
    assert "ssn_last4" not in disclosure.values
    assert "medical_record_number" not in disclosure.values


def test_unknown_workflow_has_no_envelope(tmp_path):
    data = str(tmp_path)
    seed(data)
    with pytest.raises(vault.VaultError):
        vault.resolve_envelope(data, "pt_0001", "not_a_workflow")


def test_plan_refuses_a_task_carrying_a_never_disclose_value(tmp_path, monkeypatch):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    claims = [c for c in ctx.ledger.claims if c.workflow == "claim_status"][:1]

    # Force the medical record number into the task the way a careless edit would.
    original = plan_mod._claim_block

    def leaky(index, claim, disclosure):
        return original(index, claim, disclosure) + "\n  mrn: MRN-55219"

    monkeypatch.setattr(plan_mod, "_claim_block", leaky)
    with pytest.raises(plan_mod.PlanError) as error:
        plan_mod.build_plan(
            workflow_name="claim_status",
            practice=ctx.ledger.practices[0],
            payer=ctx.ledger.payer(claims[0].payer_id),
            claims=claims,
            data_dir=data,
            idempotency_key="k1",
        )
    assert "never-disclose" in str(error.value)


def test_task_text_carries_only_envelope_values(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    claims = [c for c in ctx.ledger.claims
              if c.workflow == "eligibility" and c.patient_ref == "pt_0001"][:1]
    built = plan_mod.build_plan(
        workflow_name="eligibility",
        practice=ctx.ledger.practices[0],
        payer=ctx.ledger.payer(claims[0].payer_id),
        claims=claims,
        data_dir=data,
        idempotency_key="k2",
    )
    record = vault.get(data, "pt_0001")
    assert record["member_id"] in built.task_text
    assert record["patient_last_name"] not in built.task_text
    assert record["medical_record_number"] not in built.task_text
    assert record["address_line1"] not in built.task_text


def test_redactor_catches_a_spelled_out_identifier():
    patterns = redact.build_patterns(["W884213097"])
    spoken = "Let me read that back, W 8 8 4 2 1 3 0 9 7, I have the member."
    assert redact.scrub_text(spoken, patterns) == "Let me read that back, [redacted], I have the member."


def test_redactor_catches_written_date_forms():
    patterns = redact.build_patterns(["1984-03-11"])
    for spoken in ("date of birth 1984-03-11", "date of birth March 11, 1984", "born 03/11/1984"):
        assert "[redacted]" in redact.scrub_text(spoken, patterns)


def test_redactor_does_not_eat_a_claim_number(tmp_path):
    """A four digit fragment must not match inside an unrelated claim number."""
    patterns = redact.build_patterns(["4417"])
    text = "The first claim number is CLM-2026-004417, spoken as C L M dash 2026 dash 0 0 4 4 1 7."
    scrubbed = redact.scrub_text(text, patterns)
    assert "CLM-2026-004417" in scrubbed
    assert "0 0 4 4 1 7" in scrubbed


def test_redactor_still_removes_an_exact_short_fragment():
    patterns = redact.build_patterns(["4417"])
    assert redact.scrub_text("last four 4417 confirmed", patterns) == "last four [redacted] confirmed"


def test_redactor_removes_ssn_and_email_without_being_told():
    patterns = redact.build_patterns([])
    text = "Reach her at someone@example.org or use 123-45-6789 for verification."
    scrubbed = redact.scrub_text(text, patterns)
    assert "someone@example.org" not in scrubbed
    assert "123-45-6789" not in scrubbed


def test_vault_files_are_owner_only(tmp_path):
    data = str(tmp_path)
    seed(data)
    path = os.path.join(vault.vault_dir(data), "pt_0001.json")
    assert oct(os.stat(path).st_mode & 0o777) == "0o600"


def test_seeded_ledger_holds_no_identifiers(tmp_path):
    data = str(tmp_path)
    seed(data)
    secrets = vault.all_secrets_for(data, "pt_0001")
    for path in every_file_under(data, skip_dirs=[vault.vault_dir(data)]):
        with open(path, "r", encoding="utf-8") as handle:
            assert not redact.contains_any(handle.read(), secrets), path
