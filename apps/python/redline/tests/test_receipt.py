"""Content-addressed receipts bind verdicts without copying sensitive evidence."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from redline.data_policy import (
    ContextClassification,
    ContextRule,
    DataPolicy,
    DisclosureGate,
)
from redline.receipt import _hash_json, build_run_receipt, write_receipt
from redline.runner import run_suite
from redline.scenario.model import Expectation, Family, Persona, Scenario
from redline.subject import SubjectUnderTest
from redline.transport import MockTransport
from redline.types import Severity

SECRET_CONTEXT = "PRIVATE-CUSTOMER-REFERENCE"
FICTIONAL = "+" + "1415555" + "0142"


def subject(goal: str = "Confirm the appointment.") -> SubjectUnderTest:
    return SubjectUnderTest(
        name="appointment-agent",
        goal=goal,
        context={"case_reference": SECRET_CONTEXT},
        data_policy=DataPolicy(
            context={
                "case_reference": ContextRule(
                    classification=ContextClassification.PROHIBITED,
                    disclose_after=DisclosureGate.NEVER,
                )
            }
        ),
    )


CASE = Scenario(
    id="receipt-case",
    family=Family.ADVERSARIAL,
    severity=Severity.HIGH,
    title="A receipt test",
    persona=Persona(),
    expectations=(Expectation(assertion="task_completed", params={"equals": True}),),
)


def receipt_for(target: SubjectUnderTest) -> dict[str, object]:
    report = run_suite(target, [CASE], MockTransport())
    return build_run_receipt(target, [CASE], report)


def test_receipt_is_deterministic() -> None:
    assert receipt_for(subject()) == receipt_for(subject())


def test_unordered_values_have_a_deterministic_hash() -> None:
    assert _hash_json({"values": {"beta", "alpha"}}) == _hash_json(
        {"values": {"alpha", "beta"}}
    )


def test_receipt_changes_when_the_task_changes() -> None:
    before = receipt_for(subject())
    after = receipt_for(subject("Confirm the appointment and then end the call."))
    assert before["receipt_id"] != after["receipt_id"]


def test_receipt_contains_no_context_or_transcript() -> None:
    rendered = json.dumps(receipt_for(subject()))
    assert SECRET_CONTEXT not in rendered
    assert "transcript" not in rendered
    assert "static" in rendered


def test_receipt_masks_a_phone_shaped_subject_name() -> None:
    rendered = json.dumps(receipt_for(replace(subject(), name=FICTIONAL)))
    assert FICTIONAL not in rendered


def test_receipt_can_be_written(tmp_path: Path) -> None:
    destination = tmp_path / "release-receipt.json"
    written = write_receipt(receipt_for(subject()), destination)
    payload = json.loads(written.read_text(encoding="utf-8"))
    assert payload["receipt_id"].startswith("sha256:")
