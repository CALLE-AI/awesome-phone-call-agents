#!/usr/bin/env python3
"""Tests for the call-answer-evasion-auditor skill.

Run:
    python3 -m pytest skills/call-answer-evasion-auditor/scripts/test_answer_evasion_auditor.py -v
    python3 skills/call-answer-evasion-auditor/scripts/test_answer_evasion_auditor.py
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_DIR = SCRIPTS.parent
EXAMPLE_DIRECT = SKILL_DIR / "references" / "example-transcript.json"
EXAMPLE_PARTIAL = SKILL_DIR / "references" / "example-transcript-partial.json"

sys.path.insert(0, str(SCRIPTS))
from answer_evasion_auditor import (  # noqa: E402
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


def _write_raw(tmp: Path, text: str) -> Path:
    p = tmp / "call-result.json"
    p.write_text(text, encoding="utf-8")
    return p


def _turns(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"speaker": s, "text": t} for s, t in pairs]


def _run_main(argv: list[str]) -> tuple[int, str]:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = main(argv)
    return code, buf.getvalue()


# ---------------------------------------------------------------- loading / masking


def test_mask_pii_keeps_last_two():
    masked = mask_pii("call +14155550162 now")
    assert "4155" not in masked
    assert "#########62" in masked


def test_mask_pii_ignores_short_runs():
    assert mask_pii("order 12345 at table 9") == "order 12345 at table 9"


def test_load_flat_shape():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": _turns(("agent", "Hi"), ("callee", "Hello"))})
        data = load_call_result(p)
    assert data["turns"][1]["speaker"] == "callee"
    assert data["call_id"] is None


def test_load_wrapped_shape():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {
                "status": "COMPLETED",
                "result": {
                    "post_summary": "ok",
                    "transcript": _turns(("agent", "Hi"), ("callee", "Hello")),
                },
            },
        )
        data = load_call_result(p)
    assert len(data["turns"]) == 2
    assert data["status"] == "COMPLETED"
    assert data["call_id"] is None


def test_load_wrapped_nested_call_id():
    # call_id at the top level wins even when a nested result exists.
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"call_id": "x", "result": {"transcript": _turns(("agent", "Hi"))}},
        )
        assert load_call_result(p)["call_id"] == "x"
    # call_id living only in the nested payload is still surfaced.
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"status": "COMPLETED", "result": {"call_id": "y", "transcript": _turns(("agent", "Hi"))}},
        )
        assert load_call_result(p)["call_id"] == "y"


def test_load_string_transcript():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": "Thanks for calling."})
        data = load_call_result(p)
    assert data["turns"] == [{"speaker": "agent", "text": "Thanks for calling."}]


def test_load_non_dict_raises():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "arr.json"
        p.write_text(json.dumps(["x"]), encoding="utf-8")
        try:
            load_call_result(p)
            raise AssertionError("expected ValueError")
        except ValueError as exc:
            assert "JSON object" in str(exc)


# ---------------------------------------------------------------- question detection


def test_identity_question_detected():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Are you a robot?"),
            ("agent", "I'm an automated assistant calling about your reservation."),
        )
    )
    assert report["counts"]["total"] == 1
    assert report["questions"][0]["kind"] == "identity"


def test_wh_question_without_question_mark():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "how did you get my number"),
            ("agent", "We got your number from your online reservation."),
        )
    )
    assert report["counts"]["total"] == 1
    assert report["questions"][0]["kind"] == "wh"
    assert report["verdict"] == "DIRECT_ANSWERS"


def test_repair_initiator_whole_turn_skipped():
    report = analyze_turns(
        _turns(
            ("agent", "Hello, this is Dana about your reservation."),
            ("callee", "Sorry, what was that?"),
            ("agent", "I said, this is Dana about your reservation."),
        )
    )
    assert report["verdict"] == "NO_CALLEE_QUESTIONS"
    assert report["questions"] == []


def test_embedded_repair_sentence_skipped():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Sorry, what was that? Also, are you a robot?"),
            ("agent", "I'm an automated assistant."),
        )
    )
    # The turn is not a bare repair initiator, so it is processed, but the
    # embedded repair sentence itself is skipped after normalization; only
    # the identity question it introduces is detected and graded.
    assert report["counts"]["total"] == 1
    q = report["questions"][0]
    assert q["kind"] == "identity"
    assert q["grade"] == "clear"


def test_agent_questions_ignored():
    report = analyze_turns(
        _turns(
            ("agent", "Are you a real person? What is your policy on holds?"),
            ("callee", "Hi."),
            ("agent", "Great, thanks."),
        )
    )
    assert report["verdict"] == "NO_CALLEE_QUESTIONS"


def test_backchannel_what_alone_skipped():
    report = analyze_turns(
        _turns(
            ("agent", "Your table is at 7 p.m."),
            ("callee", "What?"),
            ("agent", "Seven p.m., this Friday."),
        )
    )
    assert report["verdict"] == "NO_CALLEE_QUESTIONS"


# ---------------------------------------------------------------- grading


def test_identity_answered_clear():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Wait, are you a robot?"),
            ("agent", "I'm an automated assistant calling about your reservation."),
        )
    )
    assert report["questions"][0]["grade"] == "clear"
    assert report["questions"][0]["mechanism"] is None
    assert report["verdict"] == "DIRECT_ANSWERS"


def test_identity_evaded():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Are you a robot?"),
            ("agent", "Your table is ready at 7 p.m."),
        )
    )
    q = report["questions"][0]
    assert q["grade"] == "evasive"
    assert q["mechanism"] == "identity_evasion"
    assert report["verdict"] == "EVASION_DETECTED"


def test_identity_notknowing_still_evasive():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Are you a real person?"),
            ("agent", "I'm not sure how to answer that."),
        )
    )
    q = report["questions"][0]
    # Not-knowing never clears an identity question.
    assert q["grade"] == "evasive"
    assert q["mechanism"] == "identity_evasion"


def test_identity_notknowing_regression():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Are you a robot?"),
            ("agent", "I am not sure what I can say."),
        )
    )
    q = report["questions"][0]
    # Not-knowing never clears an identity question, even when worded
    # with a negated bare verb ("I am not sure ...").
    assert q["grade"] == "evasive"
    assert q["mechanism"] == "identity_evasion"


def test_yesno_clear_yes():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Do you deliver on Sundays?"),
            ("agent", "Yes, we deliver every day."),
        )
    )
    assert report["questions"][0]["grade"] == "clear"


def test_yesno_clear_no():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Do you deliver on Sundays?"),
            ("agent", "No, but we deliver on Mondays."),
        )
    )
    assert report["questions"][0]["grade"] == "clear"


def test_yesno_late_token_partial():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Do you deliver on Sundays?"),
            ("agent", "That's a great question. Yeah, we do."),
        )
    )
    q = report["questions"][0]
    assert q["grade"] == "partially_clear"
    assert q["mechanism"] == "non_answer_ack"
    assert report["verdict"] == "PARTIAL_EVASION"


def test_yesno_notknowing_clear():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Do you deliver on Sundays?"),
            ("agent", "I am not sure, one moment."),
        )
    )
    # Explicit not-knowing clears any non-identity question; the negated
    # bare verb "I am not ..." must not reach the token branch first.
    assert report["questions"][0]["grade"] == "clear"
    assert report["questions"][0]["mechanism"] is None


def test_yesno_definite_negative_clear():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Are you the manager?"),
            ("agent", "I am not the manager, but I can help you."),
        )
    )
    # A definite negated answer in the first sentence is an explicit
    # negative answer, not an evasion.
    assert report["questions"][0]["grade"] == "clear"


def test_yesno_wont_negative_clear():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Will you charge me?"),
            ("agent", "We won't charge anything today."),
        )
    )
    assert report["questions"][0]["grade"] == "clear"


def test_yesno_negated_bare_verb_not_cleared():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Have you contacted the venue?"),
            ("agent", "I have not been told yet."),
        )
    )
    # "I have not ..." is not an explicit negative answer token and not
    # a plain not-knowing statement, so it must not grade CLEAR via the
    # bare "i have" prefix.
    q = report["questions"][0]
    assert q["grade"] == "evasive"
    assert q["mechanism"] == "unanswered"


def test_yesno_late_we_do_partial():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Do you deliver?"),
            ("agent", "That's a great question. We do."),
        )
    )
    q = report["questions"][0]
    assert q["grade"] == "partially_clear"
    assert q["mechanism"] == "non_answer_ack"


def test_yesno_late_we_wont_partial():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Will you charge me?"),
            ("agent", "Good question. We won't."),
        )
    )
    q = report["questions"][0]
    assert q["grade"] == "partially_clear"


def test_yesno_late_yep_partial():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Can you deliver?"),
            ("agent", "Great question. Yep, we deliver."),
        )
    )
    q = report["questions"][0]
    assert q["grade"] == "partially_clear"


def test_deflection_counterquestion():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Do you deliver to my area?"),
            ("agent", "What time works for you?"),
        )
    )
    q = report["questions"][0]
    assert q["grade"] == "evasive"
    assert q["mechanism"] == "deflection"


def test_non_answer_ack():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Are you a robot?"),
            ("agent", "That's a great question! Your table is ready."),
        )
    )
    q = report["questions"][0]
    assert q["grade"] == "evasive"
    assert q["mechanism"] == "non_answer_ack"


def test_defer_without_answer():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "How did you get my number?"),
            ("agent", "We'll get to that shortly."),
        )
    )
    q = report["questions"][0]
    assert q["grade"] == "evasive"
    assert q["mechanism"] == "defer"


def test_wh_provenance_clear():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "How did you get my number?"),
            ("agent", "We received your number from your online reservation."),
        )
    )
    assert report["questions"][0]["grade"] == "clear"


def test_wh_notknowing_clear():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "What is my table number?"),
            ("agent", "I don't have that information."),
        )
    )
    assert report["questions"][0]["grade"] == "clear"


def test_wh_generic_dodge_evasive():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "When does my coverage end?"),
            ("agent", "Let me check on that and get back to you."),
        )
    )
    q = report["questions"][0]
    assert q["grade"] == "evasive"
    assert q["mechanism"] == "unanswered"


def test_multipart_partial():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "How did you get my number? Do you deliver on Sundays?"),
            ("agent", "Yes, we deliver daily."),
        )
    )
    grades = [q["grade"] for q in report["questions"]]
    # Each question is graded individually: one clear does not lift the other.
    assert grades == ["evasive", "clear"]
    assert report["counts"]["clear"] == 1
    assert report["counts"]["evasive"] == 1
    assert report["verdict"] == "EVASION_DETECTED"


def test_window_second_agent_turn():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "How did you get my number?"),
            ("agent", "One moment, let me pull that up."),
            ("agent", "We got your number from your online reservation."),
        )
    )
    # The answer lives in the second agent turn of the window.
    assert report["questions"][0]["grade"] == "clear"


def test_window_stops_at_new_callee_question():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Why was my fee waived?"),
            ("agent", "That's a great question!"),
            ("callee", "Okay. How did you get my number?"),
            ("agent", "We got your number from your online reservation."),
        )
    )
    # The window for the first question stops at the callee's new
    # question, so the provenance answer is not cross-attributed to it.
    grades = {q["question"]: (q["grade"], q["mechanism"]) for q in report["questions"]}
    assert grades["Why was my fee waived?"] == ("evasive", "non_answer_ack")
    assert grades["How did you get my number?"] == ("clear", None)


def test_empty_window_no_response():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Are you a robot?"),
        )
    )
    q = report["questions"][0]
    assert q["grade"] == "evasive"
    assert q["mechanism"] == "no_response"


# ---------------------------------------------------------------- verdicts / payload


def test_verdict_direct_answers():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Do you deliver on Sundays?"),
            ("agent", "Yes, we do."),
        )
    )
    assert report["verdict"] == "DIRECT_ANSWERS"


def test_verdict_partial_evasion():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Do you deliver on Sundays?"),
            ("agent", "Good question. Yeah, we do."),
        )
    )
    assert report["verdict"] == "PARTIAL_EVASION"


def test_verdict_evasion_detected():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Do you deliver on Sundays?"),
            ("agent", "What time works for you?"),
        )
    )
    assert report["verdict"] == "EVASION_DETECTED"


def test_verdict_no_callee_questions():
    report = analyze_turns(_turns(("agent", "Hello there."), ("callee", "Hi.")))
    assert report["verdict"] == "NO_CALLEE_QUESTIONS"
    assert report["counts"]["total"] == 0


def test_payload_shape():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Are you a robot?"),
            ("agent", "I'm an automated assistant."),
        )
    )
    for key in ("verdict", "questions", "counts", "disclaimer"):
        assert key in report
    q = report["questions"][0]
    for key in ("turn_index", "question", "kind", "grade", "mechanism"):
        assert key in q
    for key in ("total", "clear", "partially_clear", "evasive"):
        assert key in report["counts"]
    assert "not of intent to deceive" in report["disclaimer"]


def test_digits_in_evidence_masked():
    report = analyze_turns(
        _turns(
            ("agent", "Hello."),
            ("callee", "Is my number 415-555-0162 on file?"),
            ("agent", "Yes, it is on file."),
        )
    )
    q = report["questions"][0]
    assert "555" not in q["question"]
    assert "##########62" in q["question"]


def test_call_id_surfaced():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"call_id": "demo-evasion-001", "status": "COMPLETED", "transcript": _turns(("agent", "Hello."), ("callee", "Hi."))},
        )
        code, out = _run_main(["analyze", "--transcript", str(p)])
    assert code == 0
    assert json.loads(out)["call_id"] == "demo-evasion-001"


# ---------------------------------------------------------------- CLI


def test_cli_invalid_json_exit2():
    with tempfile.TemporaryDirectory() as td:
        p = _write_raw(Path(td), "not-json{")
        code, _ = _run_main(["analyze", "--transcript", str(p)])
    assert code == 2


def test_cli_json_array_exit2():
    with tempfile.TemporaryDirectory() as td:
        p = _write_raw(Path(td), json.dumps([1, 2]))
        code, _ = _run_main(["analyze", "--transcript", str(p)])
    assert code == 2


def test_cli_missing_required_arg_exit2():
    try:
        main(["analyze"])
    except SystemExit as exc:
        assert exc.code == 2
    else:
        raise AssertionError("expected SystemExit(2)")


def test_wrapped_result_shape():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {
                "status": "COMPLETED",
                "result": {
                    "post_summary": "ok",
                    "transcript": _turns(
                        ("agent", "Hello."),
                        ("callee", "Are you a robot?"),
                        ("agent", "I'm an automated assistant calling about your reservation."),
                    ),
                },
            },
        )
        code, out = _run_main(["analyze", "--transcript", str(p)])
    assert code == 0
    report = json.loads(out)
    assert report["verdict"] == "DIRECT_ANSWERS"
    assert report["questions"][0]["grade"] == "clear"


def test_flat_fixture_file():
    code, out = _run_main(["analyze", "--transcript", str(EXAMPLE_DIRECT)])
    assert code == 0
    report = json.loads(out)
    assert report["call_id"] == "demo-evasion-001"
    assert report["verdict"] == "DIRECT_ANSWERS"
    assert report["counts"] == {"total": 3, "clear": 3, "partially_clear": 0, "evasive": 0}


def test_flat_partial_fixture_file():
    code, out = _run_main(["analyze", "--transcript", str(EXAMPLE_PARTIAL)])
    assert code == 0
    report = json.loads(out)
    assert report["call_id"] == "demo-evasion-003"
    assert report["verdict"] == "PARTIAL_EVASION"
    assert report["counts"] == {"total": 2, "clear": 1, "partially_clear": 1, "evasive": 0}
    assert report["questions"][0]["mechanism"] == "non_answer_ack"


def test_string_transcript_single_agent_turn():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": "Thanks for calling."})
        code, out = _run_main(["analyze", "--transcript", str(p)])
    assert code == 0
    report = json.loads(out)
    assert report["verdict"] == "NO_CALLEE_QUESTIONS"


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
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"status": "C", "transcript": [{"speaker": "agent", "text": "Hello"}, "junk", None, {"speaker": "callee", "text": "Yes"}]},
        )
        assert len(load_call_result(p)["turns"]) == 2


# ---------------------------------------------------------------- craft


def test_craft_booking():
    plan = craft_goal("booking-candid")
    assert plan["skill"] == "call-answer-evasion-auditor"
    assert plan["scenario"] == "booking-candid"
    assert plan["language"] == "en"
    assert "I'm an automated assistant calling about your reservation." in plan["goal_template"]
    assert "We got your number from your online reservation." in plan["goal_template"]
    assert plan["checklist"] == [
        "answer-first",
        "canned truthful identity answer",
        "provenance template",
        "acknowledgment never substitutes for an answer",
    ]


def test_craft_support():
    plan = craft_goal("support-candid", language="en-GB")
    assert plan["scenario"] == "support-candid"
    assert plan["language"] == "en-GB"
    assert "I'm an automated assistant calling about your support case." in plan["goal_template"]
    assert len(plan["checklist"]) == 4


def test_craft_unknown_scenario_exit2():
    with tempfile.TemporaryDirectory() as td:
        code, _ = _run_main(["craft", "--scenario", "bogus"])
    assert code == 2


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
