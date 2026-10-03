#!/usr/bin/env python3
"""Tests for the call-data-minimization-auditor skill.

Run:
    python3 -m pytest skills/call-data-minimization-auditor/scripts/test_data_minimization_auditor.py -v
    python3 skills/call-data-minimization-auditor/scripts/test_data_minimization_auditor.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_DIR = SCRIPTS.parent
EXAMPLE_GOAL = SKILL_DIR / "references" / "example-goal.txt"
EXAMPLE_VAGUE_GOAL = SKILL_DIR / "references" / "example-goal-vague.txt"
EXAMPLE_UNVERIFIABLE_GOAL = SKILL_DIR / "references" / "example-goal-unverifiable.txt"
EXAMPLE_TRANSCRIPT = SKILL_DIR / "references" / "example-transcript.json"
EXAMPLE_OVERCOLLECTION = SKILL_DIR / "references" / "example-transcript-overcollection.json"
EXAMPLE_UNVERIFIABLE = SKILL_DIR / "references" / "example-transcript-unverifiable.json"

sys.path.insert(0, str(SCRIPTS))
from data_minimization_auditor import (  # noqa: E402
    analyze_data_requests,
    craft_goal,
    derive_goal_scope,
    load_call_result,
    load_goal_text,
    main,
    mask_pii,
)

GOAL_NAME_PHONE = (
    "You are calling to confirm the caller's full name and callback phone "
    "number, and nothing else."
)
GOAL_VAGUE = "Book the follow-up call."
GOAL_CARD = "You need to collect the caller's card number for payment, and nothing else."
GOAL_INCOME = "You need to confirm the caller's annual income, and nothing else."
GOAL_DOB = "You need to verify the caller's date of birth, and nothing else."


def _write_result(tmp: Path, payload: dict, name: str = "call-result.json") -> Path:
    p = tmp / name
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def _write_goal(tmp: Path, text: str, name: str = "goal.txt") -> Path:
    p = tmp / name
    p.write_text(text, encoding="utf-8")
    return p


def _turns(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"speaker": s, "text": t} for s, t in pairs]


def _run_cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "data_minimization_auditor.py"), *args],
        capture_output=True,
        text=True,
    )


# ---------------------------------------------------------------- masking / loading


def test_mask_pii_keeps_last_two():
    masked = mask_pii("number 415-555-0167 here")
    assert "##########67" in masked
    assert "415" not in masked
    assert "555" not in masked


def test_load_flat_shape():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": _turns(("agent", "Hi"), ("callee", "Hello"))})
        data = load_call_result(p)
    assert data["turns"][1]["speaker"] == "callee"


def test_load_wrapped_shape():
    payload = {
        "status": "COMPLETED",
        "result": {"transcript": _turns(("agent", "Hello"), ("callee", "Hi"))},
    }
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), payload)
        data = load_call_result(p)
    assert len(data["turns"]) == 2
    assert data["status"] == "COMPLETED"


def test_load_wrapped_nested_call_id():
    payload = {
        "call_id": "outer-1",
        "status": "COMPLETED",
        "result": {"call_id": "inner-2", "transcript": _turns(("agent", "Hello"))},
    }
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), payload)
        data = load_call_result(p)
    assert data["call_id"] == "outer-1"


def test_load_string_transcript():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": "Hello there."})
        data = load_call_result(p)
    assert data["turns"] == [{"speaker": "agent", "text": "Hello there."}]


def test_load_non_dict_raises():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "arr.json"
        p.write_text(json.dumps(["x"]), encoding="utf-8")
        try:
            load_call_result(p)
            raise AssertionError("expected ValueError")
        except ValueError as exc:
            assert "JSON object" in str(exc)


# ---------------------------------------------------------------- goal scope


def test_scope_from_json_required_list():
    goal = json.dumps({"goal": "Schedule the visit.", "required_fields": ["full name", "email address"]})
    with tempfile.TemporaryDirectory() as td:
        p = _write_goal(Path(td), goal)
        text = load_goal_text(p)
    assert derive_goal_scope(text) == {"full_name", "email"}


def test_scope_from_plain_text():
    assert derive_goal_scope(GOAL_NAME_PHONE) == {"full_name", "phone_number"}


def test_scope_empty_unverifiable():
    card = analyze_data_requests(
        _turns(
            ("agent", "Can you give me your email address?"),
            ("callee", "It is dana@example.com."),
        ),
        GOAL_VAGUE,
    )
    assert card["verdict"] == "GOAL_FILE_LACKS_FIELD_LIST"
    assert all(r["scope"] == "unverifiable" for r in card["requests"])


# ---------------------------------------------------------------- out-of-scope / sensitivity


def test_out_of_scope_ssn_flagged():
    card = analyze_data_requests(
        _turns(("agent", "Can you provide your social security number for verification?"), ("callee", "Okay.")),
        GOAL_NAME_PHONE,
    )
    req = card["requests"][0]
    assert req["category"] == "national_id"
    assert req["scope"] == "out_of_scope"
    assert card["verdict"] == "OVERCOLLECTION_DETECTED"


def test_out_of_scope_card_flagged():
    card = analyze_data_requests(
        _turns(("agent", "Can you give me your card number?"), ("callee", "Sure.")),
        GOAL_NAME_PHONE,
    )
    assert card["requests"][0]["category"] == "payment_card"
    assert card["requests"][0]["scope"] == "out_of_scope"


def test_out_of_scope_employer_flagged():
    card = analyze_data_requests(
        _turns(("agent", "Tell me, where do you work?"), ("callee", "Why?")),
        GOAL_NAME_PHONE,
    )
    assert card["requests"][0]["category"] == "employer"
    assert card["requests"][0]["scope"] == "out_of_scope"


def test_in_scope_card_not_flagged():
    card = analyze_data_requests(
        _turns(
            ("agent", "Can you give me your card number?"),
            ("callee", "Sure, it is 4111 1111 1111 1113."),
            ("agent", "Got it, thank you."),
        ),
        GOAL_CARD,
    )
    assert card["requests"][0]["scope"] == "in_scope"
    assert card["verdict"] == "MINIMAL"


def test_high_sensitivity_tagged():
    card = analyze_data_requests(
        _turns(("agent", "Can you provide your social security number?"), ("callee", "No.")),
        GOAL_NAME_PHONE,
    )
    assert card["requests"][0]["sensitivity"] == "high"


def test_standard_sensitivity_tagged():
    card = analyze_data_requests(
        _turns(("agent", "Can I have your full name, please?"), ("callee", "My name is Dana Whitfield.")),
        GOAL_NAME_PHONE,
    )
    assert card["requests"][0]["sensitivity"] == "standard"


# ---------------------------------------------------------------- request rule


def test_request_needs_cue():
    card = analyze_data_requests(
        _turns(("agent", "Your date of birth is on file."), ("callee", "Okay.")),
        GOAL_DOB,
    )
    assert card["requests"] == []
    assert card["verdict"] == "NO_DATA_REQUESTED"


def test_callee_volunteer_never_flagged():
    card = analyze_data_requests(
        _turns(
            ("agent", "Hello, this is Example Clinic."),
            ("callee", "Hi, my social security number is 123-45-6789."),
        ),
        GOAL_NAME_PHONE,
    )
    assert card["requests"] == []
    assert card["verdict"] == "NO_DATA_REQUESTED"


def test_category_noun_without_cue_not_a_request():
    # Agent statement containing a category noun without a request cue is
    # not a request: "I have your phone number on file already."
    card = analyze_data_requests(
        _turns(("agent", "I have your phone number on file already."), ("callee", "Okay.")),
        GOAL_NAME_PHONE,
    )
    assert card["requests"] == []


def test_elliptical_question_request_detected():
    # Regression: elliptical follow-ups ("And the best number to reach you?")
    # carry no cue word; their trailing question mark must make them requests.
    card = analyze_data_requests(
        _turns(
            ("agent", "Can I have your full name, please?"),
            ("callee", "It's Dana Moss."),
            ("agent", "And the best number to reach you?"),
            ("callee", "415-555-0167."),
        ),
        GOAL_NAME_PHONE,
    )
    assert len(card["requests"]) == 2
    elliptical = card["requests"][1]
    assert elliptical["category"] == "phone_number"
    assert elliptical["scope"] == "in_scope"
    assert card["verdict"] == "MINIMAL"


def test_elliptical_dob_question_detected():
    card = analyze_data_requests(
        _turns(("agent", "And your date of birth?"), ("callee", "March 14.")),
        GOAL_NAME_PHONE,
    )
    assert len(card["requests"]) == 1
    assert card["requests"][0]["category"] == "date_of_birth"
    assert card["requests"][0]["scope"] == "out_of_scope"
    assert card["verdict"] == "OVERCOLLECTION_DETECTED"


def test_statement_still_not_request():
    # Guard: a declarative sentence about a category (no cue, no question
    # mark) is never a request.
    card = analyze_data_requests(
        _turns(("agent", "Your card number is stored securely."), ("callee", "Okay.")),
        GOAL_CARD,
    )
    assert card["requests"] == []


def test_cue_what_is_uncontracted():
    # The uncontracted "what is" is a request cue, not just "what's".
    card = analyze_data_requests(
        _turns(("agent", "What is your date of birth?"), ("callee", "March 14.")),
        GOAL_NAME_PHONE,
    )
    req = card["requests"][0]
    assert req["category"] == "date_of_birth"
    assert req["scope"] == "out_of_scope"
    assert card["verdict"] == "OVERCOLLECTION_DETECTED"


# ---------------------------------------------------------------- redundancy


def test_redundant_after_provided():
    card = analyze_data_requests(
        _turns(
            ("agent", "Can I have your full name, please?"),
            ("callee", "My name is Dana Whitfield."),
            ("agent", "And once more, can you confirm your full name?"),
            ("callee", "Dana Whitfield."),
        ),
        GOAL_NAME_PHONE,
    )
    reask = [r for r in card["requests"] if r["redundant"]]
    assert len(reask) == 1
    assert reask[0]["turn_index"] == 2
    assert card["verdict"] == "OVERCOLLECTION_DETECTED"


def test_redundant_excused_by_sorry():
    card = analyze_data_requests(
        _turns(
            ("agent", "Can I have your full name, please?"),
            ("callee", "My name is Dana Whitfield."),
            ("agent", "Sorry, I didn't catch that, can you confirm your full name?"),
            ("callee", "Whitfield, Dana."),
        ),
        GOAL_NAME_PHONE,
    )
    assert all(not r["redundant"] for r in card["requests"])
    assert card["verdict"] == "MINIMAL"


def test_politeness_sorry_not_excused():
    # Politeness sorry ("Sorry to bother you again") is not a hearing
    # excuse; the re-ask stays redundant.
    card = analyze_data_requests(
        _turns(
            ("agent", "Can I have your full name, please?"),
            ("callee", "My name is Dana Whitfield."),
            ("agent", "Sorry to bother you again, but can you confirm your full name?"),
            ("callee", "Dana Whitfield."),
        ),
        GOAL_NAME_PHONE,
    )
    reask = [r for r in card["requests"] if r["redundant"]]
    assert len(reask) == 1
    assert reask[0]["turn_index"] == 2
    assert card["verdict"] == "OVERCOLLECTION_DETECTED"


def test_hearing_sorry_excused():
    # Hearing-scoped sorry ("Sorry, I didn't catch that") still excuses
    # a re-ask in the same turn.
    card = analyze_data_requests(
        _turns(
            ("agent", "Can I have your full name, please?"),
            ("callee", "My name is Dana Whitfield."),
            ("agent", "Sorry, I didn't catch that. Can you tell me your full name again?"),
            ("callee", "Dana Whitfield."),
        ),
        GOAL_NAME_PHONE,
    )
    assert all(not r["redundant"] for r in card["requests"])
    assert card["verdict"] == "MINIMAL"


def test_redundant_excused_same_turn_different_sentence():
    # Excuse sentence elsewhere in the SAME turn as the re-ask also excuses it.
    card = analyze_data_requests(
        _turns(
            ("agent", "Can I have your full name, please?"),
            ("callee", "My name is Dana Whitfield."),
            ("agent", "Sorry, I didn't catch that. Can you tell me your full name again?"),
            ("callee", "Dana Whitfield."),
        ),
        GOAL_NAME_PHONE,
    )
    assert all(not r["redundant"] for r in card["requests"])
    assert card["verdict"] == "MINIMAL"


def test_explicit_already_gave_you_universal():
    card = analyze_data_requests(
        _turns(
            ("agent", "Can you tell me your annual income?"),
            ("callee", "I already gave you my income."),
            ("agent", "Could you confirm your income again?"),
            ("callee", "Fine."),
        ),
        GOAL_INCOME,
    )
    reask = [r for r in card["requests"] if r["redundant"]]
    assert len(reask) == 1
    assert card["verdict"] == "OVERCOLLECTION_DETECTED"


# ---------------------------------------------------------------- echo


def test_echo_high_sensitivity_flagged():
    card = analyze_data_requests(
        _turns(
            ("agent", "Can you give me your card number?"),
            ("callee", "Sure, it is 4111 1111 1111 1113."),
            ("agent", "I have your card number as 4111 1111 1111 1113, thank you."),
        ),
        GOAL_NAME_PHONE,
    )
    echoed = [r for r in card["requests"] if r["echo"]]
    assert len(echoed) == 1
    assert echoed[0]["category"] == "payment_card"


def test_echo_in_scope_still_flagged():
    card = analyze_data_requests(
        _turns(
            ("agent", "Can you give me your card number?"),
            ("callee", "Sure, it is 4111 1111 1111 1113."),
            ("agent", "I have your card number as 4111 1111 1111 1113, thank you."),
        ),
        GOAL_CARD,
    )
    echoed = [r for r in card["requests"] if r["echo"]]
    assert len(echoed) == 1
    assert echoed[0]["scope"] == "in_scope"
    assert card["verdict"] == "OVERCOLLECTION_DETECTED"


def test_echo_high_sensitivity_flagged():
    card = analyze_data_requests(
        _turns(
            ("agent", "Can you give me your card number?"),
            ("callee", "Sure, it is 4111 1111 1111 1113."),
            ("agent", "I have your card number as 4111 1111 1111 1113, thank you."),
        ),
        GOAL_NAME_PHONE,
    )
    echoed = [r for r in card["requests"] if r["echo"]]
    assert len(echoed) == 1
    assert echoed[0]["category"] == "payment_card"
    # Echo evidence points at the echoing turn and sentence, not the ask.
    assert echoed[0]["echo_turn_index"] == 2
    assert "#################13" in echoed[0]["echo_sentence"]
    assert "4111" not in echoed[0]["echo_sentence"]


def test_volunteered_card_echo_detected():
    # A volunteered high-sensitivity number echoed in full is a finding
    # even with no request: it lands in "echoes", verdict still fires.
    card = analyze_data_requests(
        _turns(
            ("agent", "Hello, this is Example Clinic calling about your appointment."),
            ("callee", "Hi. My card number is 4111 1111 1111 1113, by the way."),
            ("agent", "Let me read that back: 4111 1111 1111 1113."),
        ),
        GOAL_NAME_PHONE,
    )
    assert card["requests"] == []
    assert card["echoes"] == [
        {
            "turn_index": 2,
            "category": "payment_card",
            "sentence": "Let me read that back: #################13.",
        }
    ]
    assert card["verdict"] == "OVERCOLLECTION_DETECTED"


def test_security_code_with_card_context_flagged():
    card = analyze_data_requests(
        _turns(("agent", "Can you confirm the security code on your card, please?"), ("callee", "Sure.")),
        GOAL_NAME_PHONE,
    )
    req = card["requests"][0]
    assert req["category"] == "payment_card"
    assert req["scope"] == "out_of_scope"


def test_security_code_gate_not_flagged():
    # Standalone "security code" (gate/door/building) is not card data.
    card = analyze_data_requests(
        _turns(("agent", "What is the security code at the gate?"), ("callee", "1234.")),
        GOAL_NAME_PHONE,
    )
    assert card["requests"] == []
    assert card["verdict"] == "NO_DATA_REQUESTED"


# ---------------------------------------------------------------- verdicts


def test_no_data_requested():
    card = analyze_data_requests(
        _turns(("agent", "Hello, this is Example Clinic calling."), ("callee", "Hi.")),
        GOAL_NAME_PHONE,
    )
    assert card["verdict"] == "NO_DATA_REQUESTED"


def test_verdict_minimal():
    card = analyze_data_requests(
        _turns(
            ("agent", "Can I have your full name, please?"),
            ("callee", "My name is Dana Whitfield."),
        ),
        GOAL_NAME_PHONE,
    )
    assert card["verdict"] == "MINIMAL"


def test_verdict_overcollection():
    card = analyze_data_requests(
        _turns(("agent", "First, can you verify your date of birth?"), ("callee", "March 14.")),
        GOAL_NAME_PHONE,
    )
    assert card["verdict"] == "OVERCOLLECTION_DETECTED"


def test_verdict_unverifiable_goal():
    card = analyze_data_requests(
        _turns(("agent", "Can you tell me your email address?"), ("callee", "No.")),
        GOAL_VAGUE,
    )
    assert card["verdict"] == "GOAL_FILE_LACKS_FIELD_LIST"


# ---------------------------------------------------------------- payload


def test_payload_shape():
    card = analyze_data_requests(
        _turns(("agent", "Can I have your full name, please?"), ("callee", "My name is Dana Whitfield.")),
        GOAL_NAME_PHONE,
    )
    assert card["verdict"] == "MINIMAL"
    assert set(card.keys()) == {"verdict", "requests", "counts", "goal_scope_categories", "disclaimer"}
    assert "echoes" not in card
    assert set(card["requests"][0].keys()) == {"turn_index", "category", "sensitivity", "scope", "redundant", "echo", "sentence"}
    assert set(card["counts"].keys()) == {"requests", "out_of_scope", "redundant", "echo", "high_sensitivity"}
    assert card["goal_scope_categories"] == ["full_name", "phone_number"]
    assert "goal file is the sole ground truth" in card["disclaimer"]


def test_counts_consistent():
    card = analyze_data_requests(
        _turns(
            ("agent", "Can I have your full name, please?"),
            ("callee", "My name is Dana Whitfield."),
            ("agent", "And can you verify your date of birth?"),
            ("callee", "March 14."),
            ("agent", "Can you confirm your full name again?"),
            ("callee", "Dana."),
        ),
        GOAL_NAME_PHONE,
    )
    reqs = card["requests"]
    assert card["counts"]["requests"] == len(reqs)
    assert card["counts"]["out_of_scope"] == sum(1 for r in reqs if r["scope"] == "out_of_scope")
    assert card["counts"]["redundant"] == sum(1 for r in reqs if r["redundant"])
    assert card["counts"]["echo"] == sum(1 for r in reqs if r["echo"])
    assert card["counts"]["high_sensitivity"] == sum(1 for r in reqs if r["sensitivity"] == "high")


def test_masked_evidence_output():
    card = analyze_data_requests(
        _turns(
            ("agent", "Please read me the card number 4111 1111 1111 1112 for verification."),
            ("callee", "Okay."),
        ),
        GOAL_NAME_PHONE,
    )
    sentence = card["requests"][0]["sentence"]
    assert "4111" not in sentence
    assert "#################12" in sentence


def test_call_id_surfaced():
    proc = _run_cli("analyze", "--transcript", str(EXAMPLE_TRANSCRIPT), "--goal-file", str(EXAMPLE_GOAL))
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout)["call_id"] == "demo-minimization-001"


# ---------------------------------------------------------------- CLI


def test_cli_invalid_json_exit2():
    with tempfile.TemporaryDirectory() as td:
        bad = Path(td) / "bad.json"
        bad.write_text("{not json", encoding="utf-8")
        goal = _write_goal(Path(td), GOAL_NAME_PHONE)
        proc = _run_cli("analyze", "--transcript", str(bad), "--goal-file", str(goal))
    assert proc.returncode == 2


def test_cli_missing_transcript_exit2():
    proc = _run_cli("analyze", "--goal-file", str(EXAMPLE_GOAL))
    assert proc.returncode == 2


def test_cli_missing_goal_file_exit2():
    proc = _run_cli("analyze", "--transcript", str(EXAMPLE_TRANSCRIPT))
    assert proc.returncode == 2


def test_cli_goal_file_not_found_exit2():
    proc = _run_cli("analyze", "--transcript", str(EXAMPLE_TRANSCRIPT), "--goal-file", "nope.txt")
    assert proc.returncode == 2
    assert "goal file not found" in proc.stderr


def test_cli_json_array_exit2():
    with tempfile.TemporaryDirectory() as td:
        arr = Path(td) / "arr-goal.json"
        arr.write_text(json.dumps(["a"]), encoding="utf-8")
        proc = _run_cli("analyze", "--transcript", str(EXAMPLE_TRANSCRIPT), "--goal-file", str(arr))
    assert proc.returncode == 2


# ---------------------------------------------------------------- fixture files


def test_wrapped_result_shape():
    payload = {
        "status": "COMPLETED",
        "result": {
            "call_id": "demo-minimization-001",
            "transcript": _turns(("agent", "Hello."), ("callee", "Hi.")),
        },
    }
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), payload)
        data = load_call_result(p)
    assert data["call_id"] == "demo-minimization-001"
    assert len(data["turns"]) == 2


def test_flat_fixture_file():
    data = load_call_result(EXAMPLE_TRANSCRIPT)
    card = analyze_data_requests(data["turns"], load_goal_text(EXAMPLE_GOAL))
    assert card["verdict"] == "MINIMAL"
    assert card["goal_scope_categories"] == ["full_name", "phone_number"]
    assert card["counts"]["requests"] == 2
    assert all(r["scope"] == "in_scope" for r in card["requests"])
    assert all(not r["redundant"] and not r["echo"] for r in card["requests"])


def test_overcollection_fixture_file():
    data = load_call_result(EXAMPLE_OVERCOLLECTION)
    card = analyze_data_requests(data["turns"], load_goal_text(EXAMPLE_GOAL))
    assert card["verdict"] == "OVERCOLLECTION_DETECTED"
    cats = [r["category"] for r in card["requests"]]
    assert "date_of_birth" in cats
    assert card["counts"]["out_of_scope"] >= 2
    assert card["counts"]["redundant"] == 1
    assert card["counts"]["echo"] == 1


def test_volunteered_echo_counts_in_echo_total():
    # counts.echo must count standalone volunteered echoes too, not only
    # request-attached ones; otherwise an OVERCOLLECTION verdict can carry
    # counts.echo 0.
    card = analyze_data_requests(
        _turns(
            ("agent", "Hello, this is Example Clinic calling about your appointment."),
            ("callee", "Hi. My card number is 4111 1111 1111 1113, by the way."),
            ("agent", "Let me read that back: 4111 1111 1111 1113."),
        ),
        GOAL_NAME_PHONE,
    )
    assert card["counts"]["echo"] == 1


def test_flat_unverifiable_fixture_file():
    proc = _run_cli(
        "analyze",
        "--transcript",
        str(EXAMPLE_UNVERIFIABLE),
        "--goal-file",
        str(EXAMPLE_UNVERIFIABLE_GOAL),
    )
    assert proc.returncode == 0
    report = json.loads(proc.stdout)
    assert report["call_id"] == "demo-minimization-002"
    assert report["verdict"] == "GOAL_FILE_LACKS_FIELD_LIST"
    assert len(report["requests"]) == 2
    assert all(r["scope"] == "unverifiable" for r in report["requests"])
    assert report["goal_scope_categories"] == []


def test_vague_goal_fixture_files():
    assert derive_goal_scope(load_goal_text(EXAMPLE_VAGUE_GOAL)) == set()
    assert derive_goal_scope(load_goal_text(EXAMPLE_UNVERIFIABLE_GOAL)) == set()


def test_string_transcript_no_requests():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": "Hello there."})
        data = load_call_result(p)
    assert analyze_data_requests(data["turns"], GOAL_NAME_PHONE)["verdict"] == "NO_DATA_REQUESTED"


def test_null_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": None})
        data = load_call_result(p)
    assert data["turns"] == []
    assert analyze_data_requests(data["turns"], GOAL_NAME_PHONE)["verdict"] == "NO_DATA_REQUESTED"


def test_number_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": 3})
        data = load_call_result(p)
    assert data["turns"] == []


def test_whitespace_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": "   "})
        data = load_call_result(p)
    assert data["turns"] == []


def test_mixed_list_skips_non_dicts():
    payload = {
        "status": "COMPLETED",
        "transcript": [{"speaker": "agent", "text": "Hello"}, "junk", None, {"speaker": "callee", "text": "Yes"}],
    }
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), payload)
        data = load_call_result(p)
    assert len(data["turns"]) == 2


# ---------------------------------------------------------------- craft


def test_craft_minimal_intake():
    plan = craft_goal("minimal-intake")
    assert plan["skill"] == "call-data-minimization-auditor"
    assert plan["scenario"] == "minimal-intake"
    assert plan["language"] == "en"
    assert "I don't need that information for this call." in plan["goal_template"]
    assert "last two digits only" in plan["goal_template"]
    assert "will not ask for it again" in plan["goal_template"]
    assert plan["checklist"] == [
        "explicit required-fields list",
        "polite refusal line",
        "masked-confirmation policy",
        "no-re-asking rule",
    ]


def test_craft_unknown_scenario_exit2():
    proc = _run_cli("craft", "--scenario", "bogus")
    assert proc.returncode == 2


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
    total = len(tests)
    print(f"{total - failures}/{total} tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(_run_all())
