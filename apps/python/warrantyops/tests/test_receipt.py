"""The public receipt: roadmap aliases, one evidence class, deterministic bytes."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

import pytest

from warrantyops.authorization import AuthorizationBasis, CallAuthorization
from warrantyops.envelope import source_claim_from_dict
from warrantyops.ledger import InMemoryAttemptLedger
from warrantyops.packet import derive_packet
from warrantyops.providers.fake import FIXTURE_DIR, FakeCallProvider
from warrantyops.receipt import (
    ROADMAP_ALIASES,
    EvidenceClass,
    build_receipt,
    receipt_sha256,
    render_receipt_json,
)
from warrantyops.source import InMemorySourceStore
from warrantyops.workflow import RefusalGate, run_exception

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
ON = date(2026, 9, 1)
SCENARIO = "case_a_useful_resolution"


def authorization_for(number: str) -> CallAuthorization:
    return CallAuthorization(
        recipient_e164=number,
        basis=AuthorizationBasis.TEST_RECIPIENT_CONSENT,
        purpose="warranty claim exception follow-up",
        granted_by="fixture-owner",
        granted_at=NOW - timedelta(days=1),
        expires_at=NOW + timedelta(days=1),
        record_reference="synthetic://fixture-authorization",
    )


def completed_run():
    fixture = FakeCallProvider(scenario=SCENARIO, fixture_dir=FIXTURE_DIR).load()
    claim = source_claim_from_dict(fixture["envelope"])
    store = InMemorySourceStore()
    store.set_version(claim.source_platform, claim.source_claim_id, claim.source_version)
    return claim, run_exception(
        claim,
        authorization_for(claim.counterparty_phone_e164),
        FakeCallProvider(scenario=SCENARIO),
        version_reader=store,
        attempt_ledger=InMemoryAttemptLedger(),
        now=NOW,
        on=ON,
    )


def refused_run():
    fixture = FakeCallProvider(scenario=SCENARIO, fixture_dir=FIXTURE_DIR).load()
    envelope = dict(fixture["envelope"])
    # A source that states its next step refuses before any call exists.
    envelope["documented_next_step"] = "Resubmit with the certificate attached"
    claim = source_claim_from_dict(envelope)
    return claim, run_exception(
        claim,
        authorization_for(claim.counterparty_phone_e164),
        FakeCallProvider(scenario=SCENARIO),
        version_reader=InMemorySourceStore(),
        attempt_ledger=InMemoryAttemptLedger(),
        now=NOW,
        on=ON,
    )


def build(run_result, **overrides):
    claim, run = run_result
    options = {
        "recipient_e164": claim.counterparty_phone_e164,
        "provider_name": "FakeCalle (synthetic)",
        "evidence_class": EvidenceClass.SYNTHETIC,
        "source_platform": claim.source_platform,
        "source_object_id": claim.source_claim_id,
    }
    options.update(overrides)
    return build_receipt(run, **options)


# --- aliases and shape ------------------------------------------------------


def test_every_roadmap_alias_is_present_exactly_once():
    body = build(completed_run()).to_dict()
    for alias in ROADMAP_ALIASES:
        assert alias in body, alias
    assert set(body) >= ROADMAP_ALIASES


def test_the_alias_surface_matches_the_roadmap_document():
    assert frozenset(
        {
            "status",
            "outcome",
            "summary",
            "recording_url",
            "transcript_url",
            "external_call_id",
            "started_at",
            "completed_at",
            "recipient_phone_e164",
            "source_platform",
            "source_object_id",
        }
    ) == ROADMAP_ALIASES


def test_the_recipient_is_masked_everywhere():
    body = build(completed_run()).to_dict()
    assert body["recipient_phone_e164"] == "+12*******42"
    assert "5550142" not in json.dumps(body)


def test_urls_and_timestamps_are_supplied_or_absent_never_invented():
    body = build(completed_run()).to_dict()
    assert body["recording_url"] is None
    assert body["transcript_url"] is None
    assert body["started_at"] is None
    assert body["completed_at"] is None
    assert body["external_call_id"] == "call_synthetic_case_a"


def test_supplied_urls_and_timestamps_pass_through():
    body = build(
        completed_run(),
        recording_url="artifact w1042 public recording",
        transcript_url="artifact w1042 public transcript",
        started_at="2026-09-01T12:00:00+00:00",
        completed_at="2026-09-01T12:03:00+00:00",
    ).to_dict()
    assert body["recording_url"] == "artifact w1042 public recording"
    assert body["completed_at"].endswith("12:03:00+00:00")


def test_the_receipt_carries_the_packet_digest():
    claim, run = completed_run()
    receipt = build((claim, run))
    assert receipt.packet_sha256 == derive_packet(run.outcome).packet_sha256
    assert len(receipt.packet_sha256) == 32


# --- determinism ------------------------------------------------------------


def test_the_same_inputs_render_identical_bytes():
    first = build(completed_run())
    second = build(completed_run())
    assert render_receipt_json(first) == render_receipt_json(second)
    assert receipt_sha256(first) == receipt_sha256(second)


def test_rendering_is_canonical_json():
    rendered = render_receipt_json(build(completed_run()))
    reparsed = json.loads(rendered)
    assert render_receipt_json(build(completed_run())) == json.dumps(
        reparsed, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )


# --- refusal receipts -------------------------------------------------------


def test_a_refused_run_states_its_refusal_with_no_packet_hash():
    body = build(refused_run()).to_dict()
    assert body["status"] == "REFUSED"
    assert body["outcome"] == "REFUSED"
    assert "RESIDUAL_NECESSITY" in body["summary"]
    assert body["packet_sha256"] is None
    assert body["external_call_id"] is None
    assert body["quote_spans"] == []


def test_a_refusal_receipt_names_its_gate_and_reasons():
    claim, run = refused_run()
    assert run.refusal.gate is RefusalGate.RESIDUAL_NECESSITY
    receipt = build((claim, run))
    assert receipt.summary.startswith("refused at RESIDUAL_NECESSITY")


# --- evidence class ---------------------------------------------------------


def test_the_evidence_class_is_stated_exactly_once():
    body = build(completed_run(), evidence_class=EvidenceClass.SYNTHETIC).to_dict()
    values = [value for value in body.values() if value == EvidenceClass.SYNTHETIC.value]
    assert values == [EvidenceClass.SYNTHETIC.value]


def test_every_evidence_class_value_renders():
    for evidence_class in EvidenceClass:
        receipt = build(completed_run(), evidence_class=evidence_class)
        assert receipt.evidence_class == evidence_class.value


def test_quote_spans_carry_the_grounding_not_the_transcript():
    receipt = build(completed_run())
    rendered = render_receipt_json(receipt)
    assert "hour meter" not in rendered or any(
        "hour meter" in str(span) for span in receipt.quote_spans
    )
    # The bounded question text never appears in a receipt.
    assert "Do not dispute" not in rendered


# --- malformed runs, and summaries without a stated reason ---------------------


def test_a_run_carrying_neither_refusal_nor_outcome_has_no_receipt():
    from warrantyops.receipt import _summary
    from warrantyops.workflow import CaseRun

    claim, _run = completed_run()
    empty = CaseRun(idempotency_key=None)
    with pytest.raises(ValueError, match="neither a refusal nor an outcome"):
        _summary(empty)
    with pytest.raises(ValueError, match="neither a refusal nor an outcome"):
        build((claim, empty))


def test_without_a_stated_reason_the_terminal_state_is_the_summary():
    from dataclasses import replace

    from warrantyops.receipt import _summary

    _claim, run = completed_run()
    quiet = replace(
        run,
        outcome=replace(
            run.outcome,
            business=replace(run.outcome.business, stated_reason=None),
        ),
    )
    assert _summary(quiet) == run.outcome.terminal_state.value
