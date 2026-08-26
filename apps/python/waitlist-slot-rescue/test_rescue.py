import importlib.util
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("waitlist_rescue", APP_ROOT / "rescue.py")
assert SPEC and SPEC.loader
rescue = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = rescue
SPEC.loader.exec_module(rescue)


def payload() -> dict:
    now = datetime.now(timezone.utc)
    return {
        "workflow_id": "rescue-demo-001",
        "slot_id": "slot-2030-001",
        "business_display_name": "Example Repair Studio",
        "service_category": "home-service",
        "service_label": "60-minute repair assessment",
        "slot_start": (now + timedelta(days=2)).isoformat(),
        "offer_expires_at": (now + timedelta(days=1)).isoformat(),
        "candidates": [
            {
                "candidate_id": "candidate-a",
                "phone": "+12025550111",
                "position": 1,
                "locale": "en-US",
                "consented_to_waitlist_calls": True,
            },
            {
                "candidate_id": "candidate-b",
                "phone": "+12025550122",
                "position": 2,
                "locale": "en-US",
                "consented_to_waitlist_calls": True,
            },
            {
                "candidate_id": "candidate-c",
                "phone": "+12025550133",
                "position": 3,
                "locale": "en-US",
                "consented_to_waitlist_calls": True,
            },
        ],
    }


def test_preview_masks_every_phone_and_places_no_call(tmp_path):
    request_path = tmp_path / "request.json"
    request_path.write_text(json.dumps(payload()), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "rescue.py", "--request", str(request_path)],
        cwd=APP_ROOT,
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    assert "+12025550111" not in result.stdout
    parsed = json.loads(result.stdout)
    assert parsed["mode"] == "preview"
    assert parsed["creates_phone_calls"] is False
    assert parsed["booking_created"] is False


def test_stops_at_first_acceptance_and_leaves_rest_untouched():
    request = rescue.parse_request(payload())
    fixtures = {
        "candidate-a": {"outcome": "declined", "evidence_summary": "Not available."},
        "candidate-b": {"outcome": "accepted", "evidence_summary": "Wants the slot."},
        "candidate-c": {"outcome": "accepted", "evidence_summary": "Should never run."},
    }
    result = rescue.run_rescue(request, rescue.FixtureTransport(fixtures), simulated=True)
    assert [attempt["candidate_id"] for attempt in result["attempts"]] == [
        "candidate-a",
        "candidate-b",
    ]
    assert result["selected_candidate_id"] == "candidate-b"
    assert result["untouched_candidate_ids"] == ["candidate-c"]
    assert result["booking_created"] is False
    assert result["human_confirmation_required"] is True


def test_ambiguous_outcome_halts_instead_of_calling_next_candidate():
    request = rescue.parse_request(payload())
    result = rescue.run_rescue(
        request,
        rescue.FixtureTransport(
            {
                "candidate-a": {"outcome": "unknown", "evidence_summary": "Unclear."},
                "candidate-b": {"outcome": "accepted", "evidence_summary": "Not reached."},
            }
        ),
        simulated=True,
    )
    assert result["status"] == "halted-ambiguous-outcome"
    assert len(result["attempts"]) == 1
    assert result["human_confirmation_required"] is False
    assert result["human_review_required"] is True
    assert result["untouched_candidate_ids"] == ["candidate-b", "candidate-c"]


def test_audit_trace_explains_dispatch_stop_and_handoff_without_phone_data():
    request = rescue.parse_request(payload())
    golden = rescue.run_rescue(
        request,
        rescue.FixtureTransport(
            {
                "candidate-a": {"outcome": "declined"},
                "candidate-b": {"outcome": "accepted"},
            }
        ),
        simulated=True,
    )
    assert [event["sequence"] for event in golden["audit_events"]] == list(
        range(1, len(golden["audit_events"]) + 1)
    )
    assert [event["event"] for event in golden["audit_events"]] == [
        "request.validated",
        "candidate.dispatch-authorized",
        "outcome.declined",
        "candidate.dispatch-authorized",
        "outcome.accepted",
        "workflow.handoff",
    ]
    assert golden["audit_events"][-1]["decision"] == "human-confirmation"
    assert "+120255501" not in json.dumps(golden["audit_events"])

    halted = rescue.run_rescue(
        request,
        rescue.FixtureTransport({"candidate-a": {"outcome": "unknown"}}),
        simulated=True,
    )
    assert halted["audit_events"][-1] == {
        "sequence": 4,
        "event": "workflow.halted",
        "decision": "human-review",
        "candidate_id": "candidate-a",
        "reason": "ambiguous-outcome-fails-closed",
    }
    assert halted["safety_invariants"]["automatic_redial_is_disabled"] is True


def test_request_rejects_missing_consent_expired_offer_and_sensitive_category():
    raw = payload()
    raw["candidates"][0]["consented_to_waitlist_calls"] = False
    try:
        rescue.parse_request(raw)
    except ValueError as exc:
        assert "must be true" in str(exc)
    else:
        raise AssertionError("missing consent was accepted")

    raw = payload()
    raw["offer_expires_at"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    try:
        rescue.parse_request(raw)
    except ValueError as exc:
        assert "future" in str(exc)
    else:
        raise AssertionError("expired offer was accepted")

    raw = payload()
    raw["service_category"] = "medical"
    try:
        rescue.parse_request(raw)
    except ValueError as exc:
        assert "non-regulated" in str(exc)
    else:
        raise AssertionError("unsupported category was accepted")

    raw = payload()
    raw["candidates"][1]["phone"] = raw["candidates"][0]["phone"]
    try:
        rescue.parse_request(raw)
    except ValueError as exc:
        assert "phone must be unique" in str(exc)
    else:
        raise AssertionError("duplicate phone was accepted")


def test_execute_requires_explicit_confirmation_before_credentials(tmp_path):
    request_path = tmp_path / "request.json"
    request_path.write_text(json.dumps(payload()), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "rescue.py", "--request", str(request_path), "--execute"],
        cwd=APP_ROOT,
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert result.returncode == 2
    assert "--confirm-authorized-waitlist" in result.stderr


class FakeCalls:
    def __init__(self):
        self.created: list[dict] = []

    def create(self, **kwargs):
        self.created.append(kwargs)
        return {"id": f"call-{len(self.created)}"}

    def wait_for_result(self, call_id, **kwargs):
        assert kwargs == {"timeout_seconds": 30, "interval_seconds": 2}
        return {
            "status": "completed",
            "task_completed": True,
            "completion_confidence": {"score": 0.94, "label": "high"},
            "evidence": [{"summary": "The intended participant explicitly accepted."}],
            "turns": [{"role": "recipient", "text": "Yes, I want that slot."}],
            "structured_result": {
                "right_person": "yes",
                "continued_after_ai_disclosure": "yes",
                "waitlist_call_opt_out": "no",
                "wants_slot": "yes",
                "evidence_summary": "Confirmed using +12025550111.",
            },
        }


class FakeClient:
    def __init__(self):
        self.calls = FakeCalls()


def test_live_transport_uses_calle_and_redacts_returned_phone():
    request = rescue.parse_request(payload())
    client = FakeClient()
    transport = rescue.CalleTransport(client, timeout_seconds=30)
    result = rescue.run_rescue(request, transport, simulated=False)
    assert len(client.calls.created) == 1
    assert client.calls.created[0]["recipients"][0]["phones"] == ["+12025550111"]
    assert result["attempts"][0]["evidence_summary"] == "Confirmed using [phone-redacted]."
    assert result["attempts"][0]["classification_reason"] == "evidence-backed-acceptance"
    assert result["attempts"][0]["provider_diagnostics"] == {
        "provider_status": "completed",
        "task_completed": True,
        "confidence_score": 0.94,
        "confidence_label": "high",
        "has_provider_evidence": True,
        "has_transcript": True,
        "decision_fields": {
            "right_person": "yes",
            "continued_after_ai_disclosure": "yes",
            "waitlist_call_opt_out": "no",
            "wants_slot": "yes",
        },
        "classification_reason": "evidence-backed-acceptance",
    }
    assert result["creates_phone_calls"] is True


def test_call_task_uses_candidate_locale_and_turn_by_turn_questions():
    raw = payload()
    raw["candidates"][0]["locale"] = "de-DE"
    request = rescue.parse_request(raw)
    arguments = rescue.build_call_arguments(request, request.candidates[0])
    task = arguments["task"]

    assert arguments["recipients"][0]["locale"] == "de-DE"
    assert "BCP 47 locale de-DE" in task
    assert "ask only one question at a time" in task
    assert "wait for the participant's answer after every question" in task
    assert "Sound warm and conversational" in task
    assert "Acknowledge each answer before moving on" in task
    assert "ask once whether the participant can hear you" in task
    assert "do not read field names or ISO timestamps aloud" in task
    assert "Never treat silence, an interruption, a hang-up, or an unclear answer as agreement" in task


def test_answered_then_hung_up_is_unknown_and_requires_human_review():
    class HungUpCalls(FakeCalls):
        def wait_for_result(self, call_id, **kwargs):
            assert kwargs == {"timeout_seconds": 30, "interval_seconds": 2}
            return {
                "status": "completed",
                "task_completed": False,
                "completion_confidence": {"score": 0.1, "label": "low"},
                "evidence": [],
                "turns": [],
                "structured_result": {
                    "right_person": "unknown",
                    "continued_after_ai_disclosure": "unknown",
                    "waitlist_call_opt_out": "unknown",
                    "wants_slot": "unknown",
                    "evidence_summary": "",
                },
            }

    request = rescue.parse_request(payload())
    client = FakeClient()
    client.calls = HungUpCalls()
    result = rescue.run_rescue(
        request, rescue.CalleTransport(client, timeout_seconds=30), simulated=False
    )

    assert len(client.calls.created) == 1
    assert result["status"] == "halted-ambiguous-outcome"
    assert result["selected_candidate_id"] is None
    assert result["human_confirmation_required"] is False
    assert result["human_review_required"] is True
    assert result["attempts"][0]["outcome"] == "unknown"
    assert result["attempts"][0]["classification_reason"] == "task-not-completed"
    assert result["attempts"][0]["provider_diagnostics"]["has_transcript"] is False
    assert result["untouched_candidate_ids"] == ["candidate-b", "candidate-c"]


def test_provider_diagnostics_never_copy_transcript_evidence_or_arbitrary_labels():
    raw = completed_result()
    raw["status"] = "completed for +12025550111"
    raw["completion_confidence"]["label"] = "high for Alice"
    raw["turns"] = [{"role": "recipient", "text": "My number is +12025550111"}]
    raw["evidence"] = [{"summary": "Alice accepted using +12025550111"}]
    raw["structured_result"]["evidence_summary"] = "Alice accepted."

    diagnostics = rescue._privacy_safe_provider_diagnostics(raw, "test-reason")
    rendered = json.dumps(diagnostics)

    assert diagnostics["provider_status"] == "unknown"
    assert diagnostics["confidence_label"] == "unknown"
    assert diagnostics["has_transcript"] is True
    assert diagnostics["has_provider_evidence"] is True
    assert "+12025550111" not in rendered
    assert "Alice" not in rendered


def test_phone_redaction_handles_common_display_formats():
    text = "Call +49 40 1234 5678 or (202) 555-0111; keep order 1234567 unchanged."
    redacted = rescue.redact_phone_like_text(text)
    assert "+49 40 1234 5678" not in redacted
    assert "(202) 555-0111" not in redacted
    assert redacted.count("[phone-redacted]") == 2
    assert "1234567" in redacted


def test_idempotency_is_stable_and_candidate_specific():
    request = rescue.parse_request(payload())
    first = rescue.idempotency_key(request, request.candidates[0])
    assert first == rescue.idempotency_key(request, request.candidates[0])
    assert first != rescue.idempotency_key(request, request.candidates[1])


def completed_result(**structured_overrides):
    structured = {
        "right_person": "yes",
        "continued_after_ai_disclosure": "yes",
        "waitlist_call_opt_out": "no",
        "wants_slot": "yes",
        "evidence_summary": "Explicit response.",
        **structured_overrides,
    }
    return {
        "status": "completed",
        "task_completed": True,
        "completion_confidence": {"score": 0.93, "label": "high"},
        "evidence": [{"summary": "Grounded in the recipient response."}],
        "turns": [{"role": "recipient", "text": "Yes."}],
        "structured_result": structured,
    }


def test_completed_outcomes_require_independent_fields_and_evidence():
    assert rescue._classify_completed_result(completed_result()) == "accepted"
    assert rescue._classify_completed_result(completed_result(wants_slot="no")) == "declined"
    assert rescue._classify_completed_result(completed_result(right_person="no")) == "wrong-person"
    assert rescue._classify_completed_result(completed_result(waitlist_call_opt_out="yes")) == "opted-out"
    assert (
        rescue._classify_completed_result(
            completed_result(right_person="no", waitlist_call_opt_out="yes")
        )
        == "opted-out"
    )

    low_confidence = completed_result()
    low_confidence["completion_confidence"] = {"score": 0.4, "label": "low"}
    assert rescue._classify_completed_result(low_confidence) == "unknown"

    no_transcript = completed_result()
    no_transcript["turns"] = []
    assert rescue._classify_completed_result(no_transcript) == "unknown"

    unrelated_text = completed_result()
    unrelated_text["turns"] = []
    unrelated_text["recipients"] = [{"note": {"text": "This is not a transcript."}}]
    assert rescue._classify_completed_result(unrelated_text) == "unknown"

    malformed_evidence = completed_result()
    malformed_evidence["evidence"] = "generated claim"
    assert rescue._classify_completed_result(malformed_evidence) == "unknown"


def test_unrecognized_transport_outcome_halts_fail_closed():
    class InvalidTransport:
        def place(self, request, candidate):
            return {"outcome": "success", "evidence_summary": "Unsupported label."}

    result = rescue.run_rescue(
        rescue.parse_request(payload()), InvalidTransport(), simulated=True
    )
    assert result["status"] == "halted-ambiguous-outcome"
    assert result["attempts"][0]["outcome"] == "unknown"
    assert result["untouched_candidate_ids"] == ["candidate-b", "candidate-c"]


def test_no_answer_requires_positive_provider_evidence_and_no_conversation():
    verified = {
        "status": "failed",
        "structured_result": None,
        "evidence": [],
        "turns": [],
        "error": {"code": "no_answer", "message": "No answer"},
    }
    assert rescue._verified_no_answer(verified) is True

    ambiguous = {**verified, "error": {"code": "provider_error"}}
    assert rescue._verified_no_answer(ambiguous) is False

    contradictory = {**verified, "turns": [{"role": "recipient", "text": "Hello"}]}
    assert rescue._verified_no_answer(contradictory) is False


def test_expiry_is_rechecked_before_and_after_each_call():
    request = rescue.parse_request(payload())
    fixtures = rescue.FixtureTransport(
        {"candidate-a": {"outcome": "accepted", "evidence_summary": "Accepted."}}
    )
    before_expiry = request.offer_expires_at - timedelta(seconds=1)
    after_expiry = request.offer_expires_at + timedelta(seconds=1)

    calls = iter([before_expiry, after_expiry])
    result = rescue.run_rescue(request, fixtures, simulated=True, now=lambda: next(calls))
    assert result["status"] == "offer-expired-after-call-human-review"
    assert result["selected_candidate_id"] is None
    assert result["human_confirmation_required"] is False
    assert result["human_review_required"] is True
    assert result["untouched_candidate_ids"] == ["candidate-b", "candidate-c"]

    result = rescue.run_rescue(request, fixtures, simulated=True, now=lambda: after_expiry)
    assert result["status"] == "offer-expired"
    assert result["attempts"] == []
    assert result["human_review_required"] is False
    assert result["untouched_candidate_ids"] == [
        "candidate-a",
        "candidate-b",
        "candidate-c",
    ]
