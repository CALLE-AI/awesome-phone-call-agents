from __future__ import annotations

import copy
import json
from datetime import datetime, timezone
from pathlib import Path

import permitdiff as p


REQUEST_DATA = {
    "snapshot": {
        "jurisdiction": "Example City Building Department",
        "permit_id": "BLD-2026-1042",
        "public_project_reference": "Commercial tenant improvement, 100 Example Ave",
        "portal_status": "reviewing",
        "portal_updated_at_utc": "2026-08-14T09:00:00Z",
        "portal_missing_items_summary": "No missing items shown",
        "portal_next_step": "Plan review in progress",
    },
    "office": {"phone": "+14155550123", "region": "US", "locale": "en-US"},
    "caller_authorized_for_permit": True,
    "stale_after_hours": 72,
    "explicit_discrepancy": "",
}
NOW = datetime(2026, 8, 19, 9, 0, tzinfo=timezone.utc)


def request():
    return p.parse_request(REQUEST_DATA)


def provider_result(status="reviewing", **overrides):
    req = request()
    structured = {
        "continued_after_ai_disclosure": "yes",
        "disposition": "answered",
        "permit_id_confirmed": "yes",
        "office_status": status,
        "missing_items_known": "yes",
        "missing_items_summary": "No missing items are currently listed.",
        "next_procedural_step": "Plan review is still in progress.",
        "inspection_ready": "no",
        "status_quote": "the permit is still under plan review",
        "next_step_quote": "plan review is still in progress",
        "notes": "No acceleration or legal interpretation requested.",
    }
    result = {
        "id": "call_42",
        "status": "completed",
        "task_completed": True,
        "completion_confidence": {"score": 0.94},
        "metadata": {
            "workflow_type": "permit_record_reconciliation",
            "jurisdiction": req.snapshot.jurisdiction,
            "permit_id": req.snapshot.permit_id,
            "snapshot_hash": p.snapshot_hash(req.snapshot),
        },
        "structured_result": structured,
        "recipients": [
            {
                "phone": req.office.phone,
                "attempts": [
                    {
                        "transcript_turns": [
                            {"speaker": "assistant", "text": "What is the current status?"},
                            {
                                "speaker": "recipient",
                                "text": "I found BLD-2026-1042. The permit is still under plan review. Plan review is still in progress; there are no missing items currently listed.",
                            },
                        ]
                    }
                ],
            }
        ],
    }
    result.update(overrides)
    return result


def test_stale_snapshot_recommends_one_call():
    reason = p.call_reason(request(), NOW)
    assert reason["call_recommended"] is True
    assert reason["reason"] == "stale_portal_snapshot"
    assert reason["age_hours"] == 120


def test_fresh_snapshot_avoids_call_when_no_discrepancy():
    raw = copy.deepcopy(REQUEST_DATA)
    raw["snapshot"]["portal_updated_at_utc"] = "2026-08-19T08:00:00Z"
    req = p.parse_request(raw)
    reason = p.call_reason(req, NOW)
    assert reason["call_recommended"] is False
    assert reason["reason"] == "fresh_record_without_discrepancy"
    preview = p.preview(req, NOW)
    assert preview["creates_phone_call"] is False
    assert "call_arguments" not in preview


def test_explicit_discrepancy_overrides_freshness():
    raw = copy.deepcopy(REQUEST_DATA)
    raw["snapshot"]["portal_updated_at_utc"] = "2026-08-19T08:30:00Z"
    raw["explicit_discrepancy"] = "Email says corrections required while portal says reviewing"
    reason = p.call_reason(p.parse_request(raw), NOW)
    assert reason["call_recommended"] is True
    assert reason["reason"] == "explicit_discrepancy"


def test_future_portal_timestamp_fails_closed_to_no_call():
    raw = copy.deepcopy(REQUEST_DATA)
    raw["snapshot"]["portal_updated_at_utc"] = "2026-08-20T09:00:00Z"
    reason = p.call_reason(p.parse_request(raw), NOW)
    assert reason["call_recommended"] is False
    assert reason["reason"] == "portal_timestamp_in_future"


def test_preview_masks_office_phone_and_preserves_authority_boundary():
    preview = p.preview(request(), NOW)
    assert preview["creates_phone_call"] is False
    assert preview["call_recommended"] is True
    assert preview["call_arguments"]["recipients"][0]["phones"][0] != REQUEST_DATA["office"]["phone"]
    assert "only the municipality's official record" in preview["claim_boundary"]
    assert "Do not ask the staff member to approve" in preview["call_arguments"]["task"]


def test_exact_match_is_evidence_match_not_new_legal_truth():
    result = p.reconcile_result(request(), provider_result(), expected_call_id="call_42")
    assert result["route"] == "verified_match"
    assert result["portal_status"] == "reviewing"
    assert result["phone_reported_status"] == "reviewing"
    assert result["requires_official_record_confirmation"] is True


def test_grounded_status_difference_surfaces_discrepancy_only():
    r = provider_result(status="corrections_required")
    r["structured_result"]["status_quote"] = "corrections are required before review can continue"
    r["recipients"][0]["attempts"][0]["transcript_turns"][1]["text"] = (
        "I found BLD-2026-1042. Corrections are required before review can continue. "
        "Plan review is still in progress."
    )
    result = p.reconcile_result(request(), r, expected_call_id="call_42")
    assert result["route"] == "discrepancy_detected"
    assert result["phone_reported_status"] == "corrections_required"
    assert result["requires_official_record_confirmation"] is True
    assert "official record" in result["claim_boundary"]


def test_unbound_or_ungrounded_result_never_changes_workflow():
    wrong = provider_result(metadata={"permit_id": "OTHER"})
    assert p.reconcile_result(request(), wrong, expected_call_id="call_42")["route"] == "needs_human"

    ungrounded = provider_result()
    ungrounded["structured_result"] = {
        **ungrounded["structured_result"],
        "status_quote": "this was not said by staff",
    }
    assert p.reconcile_result(request(), ungrounded, expected_call_id="call_42")["route"] == "needs_human"


def test_refusal_and_voicemail_create_no_phone_evidence():
    refused = provider_result()
    refused["structured_result"] = {
        **refused["structured_result"],
        "continued_after_ai_disclosure": "no",
        "disposition": "refused",
    }
    assert p.reconcile_result(request(), refused)["route"] == "no_phone_evidence"

    voicemail = provider_result()
    voicemail["structured_result"] = {**voicemail["structured_result"], "disposition": "voicemail"}
    assert p.reconcile_result(request(), voicemail)["route"] == "no_phone_evidence"


def test_wrong_permit_identifier_fails_closed():
    r = provider_result()
    r["structured_result"] = {**r["structured_result"], "permit_id_confirmed": "no"}
    assert p.reconcile_result(request(), r)["route"] == "needs_human"


def test_snapshot_hash_and_idempotency_change_with_portal_evidence():
    req = request()
    h1 = p.snapshot_hash(req.snapshot)
    k1 = p.idempotency_key(req)
    raw = copy.deepcopy(REQUEST_DATA)
    raw["snapshot"]["portal_status"] = "corrections_required"
    req2 = p.parse_request(raw)
    assert p.snapshot_hash(req2.snapshot) != h1
    assert p.idempotency_key(req2) != k1


def test_authorization_is_explicit_and_required():
    raw = copy.deepcopy(REQUEST_DATA)
    raw["caller_authorized_for_permit"] = False
    try:
        p.parse_request(raw)
    except ValueError as exc:
        assert "explicitly true" in str(exc)
    else:
        raise AssertionError("expected authorization gate")


def test_ledger_prevents_duplicate_intent_and_records_state(tmp_path: Path):
    ledger = p.ReservationLedger(tmp_path / "ledger.sqlite3")
    key = p.idempotency_key(request())
    assert ledger.claim(key) is True
    assert ledger.claim(key) is False
    ledger.mark(key, "accepted", "call_42")
    assert ledger.get(key) == ("accepted", "call_42", None)


def test_execute_ambiguous_failure_marks_unknown_and_blocks_redial(tmp_path: Path):
    class BrokenCalls:
        def create(self, **kwargs):
            return {"id": "call_42"}

        def wait_for_result(self, call_id, *, timeout_seconds, interval_seconds):
            raise TimeoutError("ambiguous provider outcome")

    ledger = p.ReservationLedger(tmp_path / "ledger.sqlite3")
    try:
        p.execute(request(), BrokenCalls(), ledger)
    except RuntimeError as exc:
        assert "outcome is unknown" in str(exc)
    else:
        raise AssertionError("expected ambiguous outcome failure")
    state = ledger.get(p.idempotency_key(request()))
    assert state is not None
    assert state[0] == "outcome_unknown"
    assert state[1] == "call_42"
    try:
        p.execute(request(), BrokenCalls(), ledger)
    except RuntimeError as exc:
        assert "already reserved" in str(exc)
    else:
        raise AssertionError("duplicate intent should be blocked")


def test_result_schema_and_preview_are_serializable():
    structured = provider_result()["structured_result"]
    assert p.valid_structured_result(structured)
    extra = {**structured, "approval": "issued"}
    assert not p.valid_structured_result(extra)
    json.dumps(p.preview(request(), NOW))


def test_loopback_never_receives_the_real_api_key(monkeypatch):
    monkeypatch.setenv("CALLE_API_KEY", "real-production-secret")
    assert p.validate_base_url("http://127.0.0.1:8123") == "http://127.0.0.1:8123"
    assert p.api_key_for_base_url("http://127.0.0.1:8123") == p.LOOPBACK_TEST_API_KEY


def test_production_requires_the_real_api_key(monkeypatch):
    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    try:
        p.api_key_for_base_url(p.DEFAULT_BASE_URL)
    except ValueError as exc:
        assert "production" in str(exc)
    else:
        raise AssertionError("production execution should require CALLE_API_KEY")
