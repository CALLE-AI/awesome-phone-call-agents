"""The claim adapter contract: fixture and in-memory implementations.

§6.2 (locked): adapters supply validated snapshots in and record the five
named artifacts out. No adapter constructs kernel outputs itself, no
adapter dials, and no adapter can assemble a Delivery the kernel did not
produce. A DMS/ERP integration is planned, not built — these tests pin the
boundary a real integration would plug into.
"""

from __future__ import annotations

import inspect
import json

import pytest
from test_scenarios import NOW, exercise

from warrantyops.authorization import AuthorizationBasis
from warrantyops.claim_adapter import (
    REQUIRED_FIXTURE_KEYS,
    AdapterRefusal,
    ClaimSnapshot,
    FixtureClaimAdapter,
    InMemoryClaimAdapter,
    build_delivery,
)
from warrantyops.envelope import source_claim_from_dict
from warrantyops.providers.fake import FIXTURE_DIR
from warrantyops.receipt import EvidenceClass, build_receipt
from warrantyops.review import ReviewDecision, ReviewRecord, prepare_review
from warrantyops.writeback import InMemoryNoteLedger, write_back

CASE_A = FIXTURE_DIR / "case_a_useful_resolution.json"


# --- the input side --------------------------------------------------------------------


def test_a_fixture_adapter_loads_a_validated_snapshot():
    adapter = FixtureClaimAdapter(CASE_A)
    snapshot = adapter.load_claim("CLM-1042")
    assert snapshot.claim.source_platform == "SYNTHETIC-DMS"
    assert snapshot.policy_book_id == "standard-pursuit"
    assert snapshot.authorization_class is AuthorizationBasis.TEST_RECIPIENT_CONSENT


def test_the_version_read_starts_at_the_snapshot_version():
    adapter = FixtureClaimAdapter(CASE_A)
    snapshot = adapter.load_claim("CLM-1042")
    current = adapter.current_version(
        snapshot.claim.source_platform, snapshot.claim_id
    )
    assert current == snapshot.source_version


def test_an_unknown_authorization_class_is_a_named_refusal():
    with pytest.raises(AdapterRefusal) as refused:
        FixtureClaimAdapter(CASE_A, authorization_class="the-desk-said-ok")
    assert refused.value.reasons == ["AUTHORIZATION_CLASS_UNKNOWN:the-desk-said-ok"]


def test_a_policy_the_book_does_not_carry_is_a_named_refusal():
    with pytest.raises(AdapterRefusal) as refused:
        FixtureClaimAdapter(CASE_A, policy_book={})
    assert "POLICY_NOT_FOUND" in refused.value.reasons


def test_an_invalid_envelope_is_refused_with_its_own_codes(tmp_path):
    broken = json.loads(CASE_A.read_text(encoding="utf-8"))
    broken["envelope"]["claim_currency"] = "not-a-currency"
    path = tmp_path / "broken.json"
    path.write_text(json.dumps(broken), encoding="utf-8")
    with pytest.raises(AdapterRefusal) as refused:
        FixtureClaimAdapter(path)
    assert refused.value.reasons, "the envelope's own refusal codes travel"


def test_an_unreadable_or_malformed_fixture_is_a_named_refusal(tmp_path):
    with pytest.raises(AdapterRefusal, match="FIXTURE_UNREADABLE"):
        FixtureClaimAdapter(tmp_path / "absent.json")
    malformed = tmp_path / "malformed.json"
    malformed.write_text("{not json", encoding="utf-8")
    with pytest.raises(AdapterRefusal, match="FIXTURE_NOT_JSON"):
        FixtureClaimAdapter(malformed)
    empty = tmp_path / "empty.json"
    empty.write_text("{}", encoding="utf-8")
    with pytest.raises(AdapterRefusal, match="FIXTURE_SHAPE_INVALID"):
        FixtureClaimAdapter(empty)


def test_the_required_fixture_keys_are_exactly_two():
    assert {"envelope", "recipient_e164"} == REQUIRED_FIXTURE_KEYS


# --- the in-memory adapter ---------------------------------------------------------------


def test_an_unknown_claim_is_a_named_refusal():
    adapter = InMemoryClaimAdapter()
    with pytest.raises(AdapterRefusal) as refused:
        adapter.load_claim("W-9999")
    assert refused.value.reasons == ["CLAIM_NOT_FOUND:W-9999"]


def test_the_system_of_record_moves_its_own_version():
    fixture = json.loads(CASE_A.read_text(encoding="utf-8"))
    claim = source_claim_from_dict(fixture["envelope"])
    snapshot = ClaimSnapshot(
        claim=claim,
        authorization_class=AuthorizationBasis.TEST_RECIPIENT_CONSENT,
        policy_book_id=claim.economic_policy_id,
    )
    adapter = InMemoryClaimAdapter(snapshot)
    adapter.set_version(claim.source_platform, claim.source_claim_id, "v2")
    assert adapter.current_version(claim.source_platform, claim.source_claim_id) == "v2"


# --- the output side --------------------------------------------------------------------


def approved_run():
    fixture, claim, store, provider, run = exercise("case_a_useful_resolution")
    packet = prepare_review(run.outcome, fixture["recipient_e164"])
    note = write_back(
        claim,
        store,
        InMemoryNoteLedger(),
        packet,
        ReviewRecord(
            decision=ReviewDecision.APPROVE,
            reviewer="adapter-test",
            decided_at=NOW,
            review_id=packet.review_id,
            packet_sha256=packet.packet_sha256,
            operator_id="operator-adapter",
        ),
        run.outcome,
        idempotency_key=run.idempotency_key or "",
        evidence_pointer=run.outcome.transport.call_id,
        written_at=NOW,
    )
    receipt = build_receipt(
        run,
        recipient_e164=fixture["recipient_e164"],
        provider_name="fake",
        evidence_class=EvidenceClass.SYNTHETIC,
        source_platform=claim.source_platform,
        source_object_id=claim.source_claim_id,
    )
    return fixture, claim, store, run, packet, note, receipt


def test_a_delivery_carries_the_five_named_artifacts():
    fixture, claim, store, run, packet, note, receipt = approved_run()
    delivery = build_delivery(
        packet=packet,
        decision=ReviewRecord(
            decision=ReviewDecision.APPROVE,
            reviewer="adapter-test",
            decided_at=NOW,
            review_id=packet.review_id,
            packet_sha256=packet.packet_sha256,
            operator_id="operator-adapter",
        ),
        receipt=receipt,
        note=note,
        audit_reference="audit-chain-head-test",
    )
    body = delivery.to_dict()
    assert set(body) == {
        "terminal_packet",
        "review_decision",
        "provider_receipt",
        "note_payload",
        "audit_reference",
    }
    assert body["terminal_packet"]["terminal_state"] == "INFORMATION_OBTAINED"
    assert body["review_decision"] == "APPROVE"
    assert body["note_payload"]["confirmed_reference"]
    assert body["audit_reference"] == "audit-chain-head-test"


def test_a_withheld_write_back_delivers_no_note_payload():
    fixture, claim, store, run, packet, note, receipt = approved_run()
    assert note is not None
    delivery = build_delivery(
        packet=packet,
        decision=ReviewRecord(
            decision=ReviewDecision.REFUSE,
            reviewer="adapter-test",
            decided_at=NOW,
            review_id=packet.review_id,
            packet_sha256=packet.packet_sha256,
            operator_id="operator-adapter",
        ),
        receipt=receipt,
        note=None,
    )
    assert delivery.note_payload is None
    assert delivery.review_decision == "REFUSE"


def test_the_adapter_records_a_delivery_and_echoes_it():
    fixture, claim, store, run, packet, note, receipt = approved_run()
    adapter = FixtureClaimAdapter(CASE_A)
    delivery = build_delivery(
        packet=packet,
        decision=ReviewRecord(
            decision=ReviewDecision.APPROVE,
            reviewer="adapter-test",
            decided_at=NOW,
            review_id=packet.review_id,
            packet_sha256=packet.packet_sha256,
            operator_id="operator-adapter",
        ),
        receipt=receipt,
        note=note,
    )
    echoed = adapter.deliver(delivery)
    assert echoed == delivery.to_dict()
    assert adapter.delivered == [delivery]


def test_build_delivery_has_no_path_to_a_provider_or_ledger():
    """The boundary guarantee: outputs in, artifacts out, nothing else."""

    parameters = set(inspect.signature(build_delivery).parameters)
    assert parameters == {"packet", "decision", "receipt", "note", "audit_reference"}
    for forbidden in ("provider", "ledger", "store", "client", "config"):
        assert forbidden not in parameters
