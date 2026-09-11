import copy
import json
from pathlib import Path

import countersignal as c


EXPERIMENT_DATA = {
    "experiment_id": "permit-ops-001",
    "segment": "small construction firms that manage municipal permits",
    "problem": "staff spend repeated operator time resolving permit status ambiguity",
    "hypothesis": "the problem recurs often enough that firms already use a workaround",
    "questions": [
        "Tell me about the last time a permit status was unclear.",
        "How did your team resolve it?",
        "How often does this happen?",
        "What happens if nobody follows up?",
    ],
    "decision_rule": {"min_answered": 5, "support_if_at_least": 3, "weaken_if_at_least": 2},
}
RECIPIENT_DATA = {"phone": "+14155550123", "region": "US", "locale": "en-US"}


def experiment():
    return c.parse_experiment(EXPERIMENT_DATA)


def recipient():
    return c.parse_recipient(RECIPIENT_DATA)


def provider_result(**overrides):
    exp = experiment()
    rec = recipient()
    result = {
        "id": "call_123",
        "status": "completed",
        "task_completed": True,
        "completion_confidence": {"score": 0.95},
        "metadata": {
            "workflow_type": "falsifiable_customer_discovery",
            "experiment_id": exp.experiment_id,
            "protocol_hash": c.protocol_hash(exp),
        },
        "structured_result": {
            "continued_after_ai_disclosure": "yes",
            "disposition": "answered",
            "problem_occurred": "yes",
            "current_workaround": "yes",
            "would_take_followup": "yes",
            "contradicts_hypothesis": "no",
            "key_quote": "we call the city every week",
            "notes": "Uses a shared spreadsheet and manual calls.",
        },
        "recipients": [
            {
                "phone": rec.phone,
                "attempts": [
                    {
                        "transcript_turns": [
                            {"speaker": "assistant", "text": "How do you resolve it?"},
                            {"speaker": "recipient", "text": "Usually we call the city every week until someone clarifies it."},
                        ]
                    }
                ],
            }
        ],
    }
    result.update(overrides)
    return result


def test_protocol_hash_is_deterministic_and_changes_on_question_drift():
    exp = experiment()
    assert c.protocol_hash(exp) == c.protocol_hash(exp)
    drifted = copy.deepcopy(EXPERIMENT_DATA)
    drifted["questions"][0] = "Would you buy a permit automation service?"
    assert c.protocol_hash(c.parse_experiment(drifted)) != c.protocol_hash(exp)


def test_preview_masks_phone_and_never_calls():
    p = c.preview(experiment(), recipient())
    assert p["creates_phone_call"] is False
    assert p["call_arguments"]["recipients"][0]["phones"][0] != RECIPIENT_DATA["phone"]
    assert "Do not sell" in p["call_arguments"]["task"]


def test_supporting_result_must_be_grounded_and_bound():
    classified = c.classify_call(experiment(), recipient(), provider_result(), expected_call_id="call_123")
    assert classified["bucket"] == "supporting"

    wrong_metadata = provider_result(metadata={"experiment_id": "other"})
    assert c.classify_call(experiment(), recipient(), wrong_metadata, expected_call_id="call_123")["bucket"] == "invalid"

    ungrounded = provider_result()
    ungrounded["structured_result"] = {**ungrounded["structured_result"], "key_quote": "this sentence was never said"}
    assert c.classify_call(experiment(), recipient(), ungrounded, expected_call_id="call_123")["bucket"] == "invalid"


def test_refusal_and_voicemail_never_enter_answered_denominator():
    refused = provider_result()
    refused["structured_result"] = {
        **refused["structured_result"],
        "continued_after_ai_disclosure": "no",
        "disposition": "refused",
        "key_quote": "no thank you",
    }
    refused["recipients"][0]["attempts"][0]["transcript_turns"][1]["text"] = "No thank you, I do not want to participate."
    assert c.classify_call(experiment(), recipient(), refused)["bucket"] == "nonresponse"

    decision = c.experiment_decision(experiment(), ["supporting", "supporting", "nonresponse", "invalid"])
    assert decision["answered_denominator"] == 2
    assert decision["decision"] == "collect_more"


def test_disconfirming_evidence_has_priority_after_minimum_sample():
    d = c.experiment_decision(experiment(), ["supporting", "supporting", "supporting", "disconfirming", "disconfirming"])
    assert d["decision"] == "hypothesis_weakened"


def test_support_is_only_under_the_frozen_rule_and_not_population_inference():
    d = c.experiment_decision(experiment(), ["supporting", "supporting", "supporting", "neutral", "neutral"])
    assert d["decision"] == "hypothesis_supported_under_rule"
    assert "not a population-level" in d["claim_boundary"]


def test_invalid_experiment_rejects_mutable_or_weak_protocol_shape():
    bad = copy.deepcopy(EXPERIMENT_DATA)
    bad["questions"] = ["only one"]
    try:
        c.parse_experiment(bad)
    except ValueError as exc:
        assert "3-8" in str(exc)
    else:
        raise AssertionError("expected invalid experiment")


def test_idempotency_key_changes_by_recipient_and_protocol():
    exp = experiment()
    rec = recipient()
    key = c.idempotency_key(exp, rec)
    other = c.Recipient(phone="+14155550124", region="US", locale="en-US")
    assert c.idempotency_key(exp, other) != key
    drifted = copy.deepcopy(EXPERIMENT_DATA)
    drifted["problem"] += " after portal updates"
    assert c.idempotency_key(c.parse_experiment(drifted), rec) != key


def test_schema_requires_exact_fields():
    result = provider_result()["structured_result"]
    assert c.valid_structured_result(result)
    assert not c.valid_structured_result({**result, "invented": "field"})
    missing = dict(result)
    missing.pop("key_quote")
    assert not c.valid_structured_result(missing)


def test_serializable_preview_for_reviewer():
    json.dumps(c.preview(experiment(), recipient()))


def test_loopback_never_receives_the_real_api_key(monkeypatch):
    monkeypatch.setenv("CALLE_API_KEY", "real-production-secret")
    assert c.validate_base_url("http://127.0.0.1:8123") == "http://127.0.0.1:8123"
    assert c.api_key_for_base_url("http://127.0.0.1:8123") == c.LOOPBACK_TEST_API_KEY


def test_production_requires_the_real_api_key(monkeypatch):
    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    try:
        c.api_key_for_base_url(c.DEFAULT_BASE_URL)
    except ValueError as exc:
        assert "production" in str(exc)
    else:
        raise AssertionError("production execution should require CALLE_API_KEY")


def test_ledger_prevents_duplicate_intent(tmp_path):
    ledger = c.ReservationLedger(tmp_path / "ledger.sqlite3")
    key = c.idempotency_key(experiment(), recipient())
    assert ledger.claim(key) is True
    assert ledger.claim(key) is False
    ledger.mark(key, "accepted", "call_123")
    assert ledger.get(key) == ("accepted", "call_123", None)


def test_ambiguous_provider_outcome_blocks_blind_redial(tmp_path):
    class BrokenCalls:
        def create(self, **kwargs):
            return {"id": "call_123"}

        def wait_for_result(self, call_id, *, timeout_seconds, interval_seconds):
            raise TimeoutError("ambiguous")

    ledger = c.ReservationLedger(tmp_path / "ledger.sqlite3")
    try:
        c.execute(experiment(), recipient(), BrokenCalls(), ledger)
    except RuntimeError as exc:
        assert "outcome is unknown" in str(exc)
    else:
        raise AssertionError("expected ambiguous outcome")

    state = ledger.get(c.idempotency_key(experiment(), recipient()))
    assert state is not None
    assert state[0] == "outcome_unknown"
    assert state[1] == "call_123"

    try:
        c.execute(experiment(), recipient(), BrokenCalls(), ledger)
    except RuntimeError as exc:
        assert "already reserved" in str(exc)
    else:
        raise AssertionError("duplicate call should be blocked")


def test_judge_console_is_explicitly_no_call_and_contains_decision_states():
    html = (Path(__file__).with_name("judge-console.html")).read_text(encoding="utf-8")
    assert "Deterministic reviewer mode · NO CALL" in html
    assert "hypothesis_weakened" in html
    assert "Silence never enters the answered denominator" in html
    assert "fetch(" not in html
