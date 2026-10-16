#!/usr/bin/env python3
"""Tests for the call-total-cost-disclosure-auditor skill.

Run:
    python3 -m pytest skills/call-total-cost-disclosure-auditor/scripts/test_total_cost_disclosure_auditor.py -v
    python3 skills/call-total-cost-disclosure-auditor/scripts/test_total_cost_disclosure_auditor.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_DIR = SCRIPTS.parent
EXAMPLE_FLAT = SKILL_DIR / "references" / "example-transcript.json"
EXAMPLE_DRIP = SKILL_DIR / "references" / "example-transcript-drip.json"
EXAMPLE_PARTIAL = SKILL_DIR / "references" / "example-transcript-partial.json"

sys.path.insert(0, str(SCRIPTS))
from total_cost_disclosure_auditor import (  # noqa: E402
    _norm_amount,
    analyze_turns,
    craft_goal,
    load_call_result,
    main,
    mask_pii,
)


def _write_result(tmp: Path, payload: dict) -> Path:
    p = tmp / "call-result.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def _turns(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"speaker": s, "text": t} for s, t in pairs]


def _run_cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "total_cost_disclosure_auditor.py"), *args],
        capture_output=True,
        text=True,
    )


# ---------------------------------------------------------------- masking / loading


def test_mask_pii_keeps_last_two():
    masked = mask_pii("call +14155550174 now")
    assert "55550" not in masked
    assert "+#########74" in masked


def test_load_flat_shape():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": _turns(("agent", "Hi"), ("callee", "Hello"))})
        data = load_call_result(p)
    assert data["turns"][1]["speaker"] == "callee"


def test_load_wrapped_shape():
    payload = {"status": "COMPLETED", "result": {"transcript": _turns(("agent", "Hi"), ("callee", "Hello"))}}
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), payload)
        data = load_call_result(p)
    assert data["turns"][0]["speaker"] == "agent"


def test_load_wrapped_nested_call_id():
    payload = {"call_id": "run-top", "result": {"call_id": "run-nested", "transcript": []}}
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), payload)
        data = load_call_result(p)
    assert data["call_id"] == "run-top"


def test_load_string_transcript():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "C", "transcript": "Hello there."})
        turns = load_call_result(p)["turns"]
    assert turns == [{"speaker": "agent", "text": "Hello there."}]


def test_load_non_dict_raises():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "arr.json"
        p.write_text(json.dumps(["x"]), encoding="utf-8")
        try:
            load_call_result(p)
            raise AssertionError("expected ValueError")
        except ValueError as exc:
            assert "JSON object" in str(exc)


def test_null_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "C", "transcript": None})
        assert load_call_result(p)["turns"] == []


def test_number_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "C", "transcript": 3})
        assert load_call_result(p)["turns"] == []


def test_whitespace_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "C", "transcript": "   "})
        assert load_call_result(p)["turns"] == []


def test_mixed_list_skips_non_dicts():
    payload = {"status": "C", "transcript": [{"speaker": "agent", "text": "Hello"}, "junk", None, {"speaker": "callee", "text": "Yes"}]}
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), payload)
        assert len(load_call_result(p)["turns"]) == 2


# ---------------------------------------------------------------- elicitation lexicon


def test_elicitation_would_you_like():
    payload = analyze_turns(_turns(("agent", "The total is $45. Would you like to book the table?"), ("callee", "Yes, go ahead.")))
    assert payload["commitment_elicitation"]["turn_index"] == 0
    assert "Would you like to book" in payload["commitment_elicitation"]["snippet"]


def test_elicitation_shall_i():
    payload = analyze_turns(_turns(("agent", "Shall I confirm the order?"), ("callee", "Yes.")))
    assert payload["commitment_elicitation"]["turn_index"] == 0


def test_elicitation_can_i_go_ahead():
    payload = analyze_turns(_turns(("agent", "Can I go ahead and book it?"), ("callee", "Sure.")))
    assert payload["commitment_elicitation"]["turn_index"] == 0


def test_elicitation_would_you_like_place_order():
    payload = analyze_turns(_turns(("agent", "Would you like to place your order now?"), ("callee", "Yes.")))
    assert payload["commitment_elicitation"]["turn_index"] == 0


def test_elicitation_let_us_signed_up():
    payload = analyze_turns(_turns(("agent", "Let us get you signed up today."), ("callee", "Sure.")))
    assert payload["commitment_elicitation"]["turn_index"] == 0


def test_elicitation_i_will_go_ahead():
    payload = analyze_turns(_turns(("agent", "I will go ahead and book it, sound good?"), ("callee", "Yes.")))
    assert payload["commitment_elicitation"]["turn_index"] == 0


def test_elicitation_shall_i_go_ahead_and():
    # Regression: "go ahead and" between "shall i" and the verb is one of the
    # most natural real-world commitment phrasings and was missed.
    payload = analyze_turns(
        _turns(
            ("agent", "The total is $45 and there is a refundable $10 deposit."),
            ("agent", "Shall I go ahead and reserve it?"),
            ("callee", "Sure, please do."),
        )
    )
    assert payload["commitment_elicitation"]["turn_index"] == 1
    assert "Shall I go ahead and reserve" in payload["commitment_elicitation"]["snippet"]
    assert payload["verdict"] == "FULL_DISCLOSURE_BEFORE_CONSENT"


def test_elicitation_should_i_go_ahead_and_book():
    payload = analyze_turns(_turns(("agent", "Should I go ahead and book it for you?"), ("callee", "Yes.")))
    assert payload["commitment_elicitation"]["turn_index"] == 0
    assert "Should I go ahead and book" in payload["commitment_elicitation"]["snippet"]


# ---------------------------------------------------------------- consent polarity


def test_consent_first_sentence_sure():
    payload = analyze_turns(_turns(("agent", "The total is $45."), ("agent", "Would you like to book?"), ("callee", "Sure, please do.")))
    assert payload["consent_point"] == 2


def test_consent_okay_book_it():
    payload = analyze_turns(_turns(("agent", "The total is $45."), ("agent", "Would you like to book?"), ("callee", "Okay, book it please.")))
    assert payload["consent_point"] == 2


def test_consent_no_but_not_consent():
    payload = analyze_turns(_turns(("agent", "Would you like to book?"), ("callee", "No, but go ahead if you must.")))
    assert payload["consent_point"] is None


def test_consent_negated_first_word():
    # First sentence starts with a negation token; consent is decided by the
    # first sentence only, so "Hmm, ..." is not consent.
    payload = analyze_turns(_turns(("agent", "Would you like to book?"), ("callee", "Hmm, sure, please do.")))
    assert payload["consent_point"] is None


def test_no_consent_evaluates_pre_elicitation():
    payload = analyze_turns(
        _turns(
            ("agent", "The total is $45 and there is a $5 fee."),
            ("agent", "Would you like to book it?"),
            ("callee", "Let me think about it."),
        )
    )
    assert payload["consent_point"] is None
    assert payload["verdict"] == "FULL_DISCLOSURE_BEFORE_CONSENT"


def test_consent_surely_not_consent():
    # "Surely" must not satisfy the ^sure token: word boundary required.
    payload = analyze_turns(_turns(("agent", "Would you like to book?"), ("callee", "Surely, no.")))
    assert payload["consent_point"] is None


def test_consent_yesterday_sure_not_consent():
    # First sentence starts with "Yesterday"; not a consent opener.
    payload = analyze_turns(_turns(("agent", "Would you like to book?"), ("callee", "Yesterday, sure, whatever.")))
    assert payload["consent_point"] is None


# ---------------------------------------------------------------- verdicts


def test_full_disclosure_before_consent():
    payload = analyze_turns(
        _turns(
            ("agent", "The plan is $45 per month with no additional fees. Would you like to sign up for it?"),
            ("callee", "Yes."),
        )
    )
    assert payload["verdict"] == "FULL_DISCLOSURE_BEFORE_CONSENT"
    assert payload["disclosures"]["total_amount"]["covered"] is True
    assert payload["disclosures"]["recurring"] == {"required": True, "covered": True}
    assert payload["disclosures"]["fees_restrictions"] == {"required": True, "covered": True}
    assert payload["drip_evidence"] is None


def test_partial_missing_recurring():
    # Recurring terms mentioned only AFTER consent: required (mentioned in the
    # call) but not covered pre-consent, and not drip (a term, not an amount).
    payload = analyze_turns(
        _turns(
            ("agent", "The total is $45, no additional fees. Would you like to book?"),
            ("callee", "Yes, go ahead."),
            ("agent", "It renews monthly."),
        )
    )
    assert payload["verdict"] == "PARTIAL_DISCLOSURE"
    assert payload["disclosures"]["recurring"] == {"required": True, "covered": False}
    assert payload["drip_evidence"] is None
    assert "recurring" in payload["reason"]


def test_partial_missing_fees():
    payload = analyze_turns(
        _turns(
            ("agent", "The total is $45 per month."),
            ("agent", "Would you like to subscribe to the plan?"),
            ("callee", "Not yet, maybe next week."),
            ("agent", "One note: a $5 service fee applies."),
        )
    )
    assert payload["verdict"] == "PARTIAL_DISCLOSURE"
    assert payload["disclosures"]["fees_restrictions"] == {"required": True, "covered": False}
    assert "fees" in payload["reason"]


def test_recurring_absent_not_required():
    payload = analyze_turns(
        _turns(
            ("agent", "The total is $45 and there are no additional fees. Would you like to book?"),
            ("callee", "Yes."),
        )
    )
    assert payload["disclosures"]["recurring"]["required"] is False
    assert payload["verdict"] == "FULL_DISCLOSURE_BEFORE_CONSENT"


def test_fee_negation_counts_covered():
    payload = analyze_turns(
        _turns(
            ("agent", "The fee is $45, fully refundable with free cancellation. Would you like to book?"),
            ("callee", "Yes, go ahead."),
        )
    )
    assert payload["disclosures"]["fees_restrictions"] == {"required": True, "covered": True}
    assert payload["verdict"] == "FULL_DISCLOSURE_BEFORE_CONSENT"


def test_commitment_without_amount():
    payload = analyze_turns(_turns(("agent", "Would you like to book the table?"), ("callee", "Yes.")))
    assert payload["verdict"] == "COMMITMENT_WITHOUT_AMOUNT"
    assert payload["disclosures"]["total_amount"]["covered"] is False
    assert "amount" in payload["reason"]


# ---------------------------------------------------------------- drip pricing


def test_drip_fee_post_consent():
    payload = analyze_turns(
        _turns(
            ("agent", "The total comes to $45."),
            ("agent", "Do you want to place the order?"),
            ("callee", "Yes, go ahead."),
            ("agent", "Great, just so you know, there is a $6 handling fee added at checkout."),
        )
    )
    assert payload["verdict"] == "DRIP_PRICING_DETECTED"
    assert payload["drip_evidence"]["turn_index"] == 3
    assert payload["drip_evidence"]["kind"] == "fee_first_mentioned_post_consent"
    assert "handling fee" in payload["drip_evidence"]["sentence"]


def test_drip_new_amount_post_consent():
    payload = analyze_turns(
        _turns(
            ("agent", "The total is $45. Would you like to book?"),
            ("callee", "Yes."),
            ("agent", "Also, guest parking is $6."),
        )
    )
    assert payload["verdict"] == "DRIP_PRICING_DETECTED"
    assert payload["drip_evidence"]["turn_index"] == 2
    assert payload["drip_evidence"]["kind"] == "new_amount_post_consent"


def test_drip_requires_consent():
    payload = analyze_turns(
        _turns(
            ("agent", "The total comes to $45."),
            ("agent", "Do you want to place the order?"),
            ("callee", "Let me think about it."),
            ("agent", "Great, just so you know, there is a $6 handling fee added at checkout."),
        )
    )
    assert payload["drip_evidence"] is None
    assert payload["verdict"] != "DRIP_PRICING_DETECTED"


# ---------------------------------------------------------------- amounts


def test_multi_amount_first_pre_consent():
    payload = analyze_turns(
        _turns(
            ("agent", "The total is $45, that is 45 dollars. Would you like to book?"),
            ("callee", "Yes, go ahead."),
            ("agent", "Confirmed, $45 has been booked."),
        )
    )
    assert payload["counts"]["amounts_pre_consent"] == 2
    assert payload["drip_evidence"] is None
    assert payload["verdict"] == "FULL_DISCLOSURE_BEFORE_CONSENT"


def test_amount_number_only_dollars_form():
    payload = analyze_turns(
        _turns(
            ("agent", "The total comes to 30 dollars. Would you like to proceed?"),
            ("callee", "Yes."),
        )
    )
    assert payload["disclosures"]["total_amount"]["covered"] is True
    assert payload["verdict"] == "FULL_DISCLOSURE_BEFORE_CONSENT"


def test_total_phrase_amount_full_capture():
    # Regression: "total is $45" must capture the full digit run, not "$4".
    payload = analyze_turns(
        _turns(
            ("agent", "The total is $45."),
            ("agent", "Would you like to book?"),
            ("callee", "Yes."),
            ("agent", "Confirmed: $45 charged."),
        )
    )
    assert payload["verdict"] == "FULL_DISCLOSURE_BEFORE_CONSENT"
    assert payload["drip_evidence"] is None


def test_total_phrase_amounts_normalize_equal():
    # All three surface forms of the same amount normalize to "45".
    assert _norm_amount("$45.") == "45"
    assert _norm_amount("45 dollars") == "45"
    assert _norm_amount("total is $45") == "45"


# ---------------------------------------------------------------- no commitment


def test_no_commit_no_monetary_commitment():
    payload = analyze_turns(_turns(("agent", "The total is $45 per month."), ("callee", "Okay, tell me more.")))
    assert payload["verdict"] == "NO_MONETARY_COMMITMENT"
    assert payload["commitment_elicitation"] is None
    assert payload["consent_point"] is None
    assert "counts" in payload


# ---------------------------------------------------------------- payload shape


def test_payload_shape():
    payload = analyze_turns(_turns(("agent", "The total is $45. Would you like to book?"), ("callee", "Yes, go ahead.")))
    assert set(payload.keys()) == {
        "verdict",
        "commitment_elicitation",
        "consent_point",
        "disclosures",
        "drip_evidence",
        "reason",
        "counts",
        "disclaimer",
    }
    assert set(payload["disclosures"].keys()) == {"total_amount", "recurring", "fees_restrictions"}
    assert set(payload["counts"].keys()) == {"agent_turns", "amounts_pre_consent", "fee_mentions_total"}
    assert set(payload["commitment_elicitation"].keys()) == {"turn_index", "snippet"}
    assert payload["counts"]["agent_turns"] == 1


def test_reason_field_names_deciding_element():
    no_amount = analyze_turns(_turns(("agent", "Would you like to book?"), ("callee", "Yes.")))
    assert "amount" in no_amount["reason"]
    partial = analyze_turns(
        _turns(
            ("agent", "The total is $45. Would you like to book?"),
            ("callee", "Yes."),
            ("agent", "It renews monthly."),
        )
    )
    assert "recurring" in partial["reason"]


def test_masked_snippet():
    payload = analyze_turns(
        _turns(
            ("agent", "The total comes to $45."),
            ("agent", "Do you want to place the order?"),
            ("callee", "Yes, go ahead."),
            ("agent", "Just so you know, there is a $6 handling fee, call us at 415-555-0174."),
        )
    )
    sentence = payload["drip_evidence"]["sentence"]
    assert "555" not in sentence
    assert sentence.endswith("74.")


def test_call_id_surfaced():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"call_id": "demo-cost-001", "status": "COMPLETED", "transcript": _turns(("agent", "Would you like to book?"), ("callee", "Yes."))},
        )
        proc = _run_cli("analyze", "--transcript", str(p))
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["call_id"] == "demo-cost-001"
    assert list(card.keys())[0] == "call_id"


# ---------------------------------------------------------------- wrapped / fixtures


def test_wrapped_result_shape():
    payload = {"status": "COMPLETED", "result": {"call_id": "run-cost-9", "transcript": _turns(("agent", "Would you like to book?"), ("callee", "Yes."))}}
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), payload)
        data = load_call_result(p)
    assert data["call_id"] == "run-cost-9"
    card = analyze_turns(data["turns"])
    assert "verdict" in card


def test_flat_fixture_file():
    proc = _run_cli("analyze", "--transcript", str(EXAMPLE_FLAT))
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["call_id"] == "demo-cost-001"
    assert card["verdict"] == "FULL_DISCLOSURE_BEFORE_CONSENT"
    assert card["consent_point"] == 3
    assert card["drip_evidence"] is None


def test_drip_fixture_file():
    proc = _run_cli("analyze", "--transcript", str(EXAMPLE_DRIP))
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["verdict"] == "DRIP_PRICING_DETECTED"
    assert card["drip_evidence"]["kind"] == "fee_first_mentioned_post_consent"


def test_flat_partial_fixture_file():
    proc = _run_cli("analyze", "--transcript", str(EXAMPLE_PARTIAL))
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["call_id"] == "demo-cost-002"
    assert card["verdict"] == "PARTIAL_DISCLOSURE"
    assert card["disclosures"]["recurring"] == {"required": True, "covered": False}
    assert card["drip_evidence"] is None
    assert "recurring terms" in card["reason"]


def test_string_transcript_no_commit():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "C", "transcript": "Hello, this is a test."})
        proc = _run_cli("analyze", "--transcript", str(p))
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["verdict"] == "NO_MONETARY_COMMITMENT"


# ---------------------------------------------------------------- CLI edges


def test_cli_invalid_json_exit2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "bad.json"
        p.write_text("not json {", encoding="utf-8")
        proc = _run_cli("analyze", "--transcript", str(p))
    assert proc.returncode == 2
    assert "ERROR" in proc.stderr


def test_cli_missing_required_arg_exit2():
    proc = _run_cli("analyze")
    assert proc.returncode == 2


def test_cli_json_array_exit2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "arr.json"
        p.write_text(json.dumps([1, 2]), encoding="utf-8")
        proc = _run_cli("analyze", "--transcript", str(p))
    assert proc.returncode == 2
    assert "JSON object" in proc.stderr


# ---------------------------------------------------------------- craft


def test_craft_transparent_offer():
    plan = craft_goal("transparent-offer")
    assert set(plan.keys()) == {"skill", "scenario", "language", "goal_template", "checklist"}
    assert plan["skill"] == "call-total-cost-disclosure-auditor"
    assert plan["scenario"] == "transparent-offer"
    assert plan["language"] == "en"
    assert plan["checklist"] == [
        "offer block before commitment",
        "single commitment question",
        "recurring frequency stated when applicable",
        "no new amounts after commitment",
    ]
    assert "total" in plan["goal_template"].lower()
    assert "before" in plan["goal_template"].lower()


def test_craft_unknown_scenario_exit2():
    proc = _run_cli("craft", "--scenario", "bogus")
    assert proc.returncode == 2


def test_main_returns_int():
    assert main(["craft", "--scenario", "transparent-offer"]) == 0


# ---------------------------------------------------------------- runner


def _run_all() -> int:
    failures = 0
    globals_map = globals()
    tests = [(k, v) for k, v in globals_map.items() if k.startswith("test_") and callable(v)]
    for name, fn in tests:
        try:
            fn()
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"FAIL {name}: {exc}")
    print(f"{len(tests) - failures}/{len(tests)} tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(_run_all())
