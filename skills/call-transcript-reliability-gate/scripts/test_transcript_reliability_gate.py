#!/usr/bin/env python3
"""Tests for the call-transcript-reliability-gate skill.

Run:
    python3 -m pytest skills/call-transcript-reliability-gate/scripts/test_transcript_reliability_gate.py -v
    python3 skills/call-transcript-reliability-gate/scripts/test_transcript_reliability_gate.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_DIR = SCRIPTS.parent
REPO_ROOT = SKILL_DIR.parent.parent
EXAMPLE_SUSPECT = SKILL_DIR / "references" / "example-transcript.json"
EXAMPLE_CLEAN = SKILL_DIR / "references" / "example-transcript-clean.json"

sys.path.insert(0, str(SCRIPTS))
from transcript_reliability_gate import (  # noqa: E402
    _find_loops,
    _script_switches,
    analyze_turns,
    craft_goal,
    grade_turn,
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


# ---------------------------------------------------------------- loading


def test_load_list_of_turns_nested_result():
    data = load_call_result(EXAMPLE_SUSPECT)
    assert data["status"] == "COMPLETED"
    assert len(data["turns"]) == 7
    assert data["turns"][0]["speaker"] == "agent"
    assert data["turns"][3]["speaker"] == "callee"


def test_load_flat_shape():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": _turns(("agent", "Hi"), ("callee", "Hello"))})
        data = load_call_result(p)
    assert data["turns"][1]["text"] == "Hello"


def test_load_string_transcript_single_agent_turn():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": "one long line"})
        data = load_call_result(p)
    assert data["turns"] == [{"speaker": "agent", "text": "one long line"}]


def test_load_whitespace_string_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": "   "})
        data = load_call_result(p)
    assert data["turns"] == []


def test_load_null_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": None})
        data = load_call_result(p)
    assert data["turns"] == []


def test_load_number_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": 12345})
        data = load_call_result(p)
    assert data["turns"] == []


def test_load_non_dict_raises():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "arr.json"
        p.write_text(json.dumps([1, 2]), encoding="utf-8")
        try:
            load_call_result(p)
            raise AssertionError("expected ValueError")
        except ValueError as exc:
            assert "JSON object" in str(exc)


def test_load_mixed_list_skips_non_dicts_and_defaults():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {
                "status": "COMPLETED",
                "transcript": [
                    {"speaker": "agent", "text": "Hello"},
                    "junk-string",
                    17,
                    None,
                    {"speaker": "callee"},
                    {"text": "no speaker given"},
                ],
            },
        )
        data = load_call_result(p)
    assert len(data["turns"]) == 3
    assert data["turns"][1] == {"speaker": "callee", "text": ""}
    assert data["turns"][2] == {"speaker": "unknown", "text": "no speaker given"}


# ---------------------------------------------------------------- masking


def test_mask_pii_masks_phone_keep_last_two():
    masked = mask_pii("call +14155550142 now")
    assert "4155550142" not in masked
    assert masked.endswith("42 now") or "42" in masked
    assert masked.count("#") >= 9


def test_mask_pii_leaves_short_runs_untouched():
    assert mask_pii("order 45912 on the 15th") == "order 45912 on the 15th"


def test_mask_pii_separators_treated_as_one_run():
    masked = mask_pii("dial 415-555-0142 x2")
    assert "555" not in masked


def test_mask_pii_unicode_digits_not_matched_but_not_broken():
    text = "reserve １２３４５６７ seats"
    assert mask_pii(text) == text


# ---------------------------------------------------------------- signals


def test_loop_repetition_detected():
    loops = _find_loops("Yeah that's fine yeah that's fine yeah that's fine go ahead.")
    assert loops == ["yeah that's fine"]


def test_backchannel_yes_repetition_not_a_loop():
    assert _find_loops("yes yes yes yes") == []


def test_okay_okay_not_a_loop():
    assert _find_loops("okay okay okay let me check") == []


def test_two_repeats_not_a_loop():
    assert _find_loops("see you tuesday see you tuesday bye") == []


def test_grade_turn_clean_text_no_rules():
    assert grade_turn("Yes, Tuesday at 10 a.m. works for me.")["rules"] == []


def test_boilerplate_phantom_detected():
    assert "boilerplate_phantom" in grade_turn("Thank you for watching. See you in the next video.")["rules"]


def test_sincere_thanks_not_boilerplate():
    assert grade_turn("Thank you for your help with the order.")["rules"] == []


def test_caption_credit_detected():
    assert "boilerplate_phantom" in grade_turn("Subtitles by the Amara.org community")["rules"]


def test_harm_violence_with_object_detected():
    rules = grade_turn("He said he would kill them all if she called again.")["rules"]
    assert "harm_violence" in rules


def test_price_hyperbole_not_harm():
    assert grade_turn("This price will kill me, but fine, confirm it.")["rules"] == []


def test_extremism_detected():
    assert "harm_extremism" in grade_turn("The group kept saying nazi slogans.")["rules"]


def test_cyrillic_insertion_detected():
    rules = grade_turn("Он сказал дождь and then the line went quiet.")["rules"]
    assert "non_english_insertion" in rules


def test_cjk_insertion_detected():
    # "please wait" in Han script, built from codepoints so this file stays
    # pure ASCII (the repository validator rejects Han codepoints in files).
    han_wait = "".join(chr(c) for c in (0x8BF7, 0x7A0D, 0x7B49))
    assert "non_english_insertion" in grade_turn(han_wait + " one moment please.")["rules"]


def test_accented_latin_name_not_a_switch():
    assert _script_switches("Jose Munoz confirmed,Mrs. Angelique Dube") == []


def test_short_foreign_word_not_a_switch():
    # Fewer than 4 consecutive codepoints from one script stays unflagged.
    assert _script_switches("ok да bye") == []


def test_separator_only_turn_empty_word_content():
    assert "empty_word_content" in grade_turn("...!?")["rules"]


def test_extreme_turn_length_detected():
    long_text = "word " * 121
    assert "extreme_turn_length" in grade_turn(long_text)["rules"]


def test_normal_turn_length_not_extreme():
    assert "extreme_turn_length" not in grade_turn("word " * 100)["rules"]


# ---------------------------------------------------------------- verdicts


def test_analyze_clean_fixture_reliable():
    data = load_call_result(EXAMPLE_CLEAN)
    card = analyze_turns(data["turns"])
    assert card["verdict"] == "RELIABLE"
    assert card["signals_summary"] == {}
    assert card["fields_to_reconfirm"] == []
    assert card["recommended_action"]["action"] == "proceed_with_caution"
    assert card["analysis_mode"] == "heuristic"


def test_analyze_suspect_fixture_loop_and_fields():
    data = load_call_result(EXAMPLE_SUSPECT)
    card = analyze_turns(data["turns"])
    assert card["verdict"] == "SUSPECT"
    assert card["signals_summary"].get("loop_repetition") == 1
    assert card["recommended_action"]["action"] == "reverify_key_fields"
    fields = card["fields_to_reconfirm"]
    assert "15" in fields or "tuesday" in fields
    assert card["harm_review_required"] is False
    assert card["analysis_mode"] == "heuristic"


def test_analyze_empty_transcript_unusable():
    card = analyze_turns([])
    assert card["verdict"] == "UNUSABLE"
    assert card["reliability_assessment"] == "unclear"
    assert card["reason"] == "empty_transcript"
    assert card["recommended_action"]["action"] == "do_not_act_on_transcript"


def test_analyze_no_callee_turns_unusable():
    card = analyze_turns(_turns(("agent", "Hello? Hello? Are you there?"), ("agent", "I will try again later.")))
    assert card["verdict"] == "UNUSABLE"
    assert card["signals_summary"]["no_callee_turns"] == 1
    assert card["recommended_action"]["action"] == "do_not_act_on_transcript"


def test_analyze_single_turn_call_unusable():
    card = analyze_turns(_turns(("callee", "Hello who is this?")))
    assert card["verdict"] == "UNUSABLE"
    assert card["signals_summary"]["single_turn_call"] == 1


def test_analyze_all_callee_turns_suspect_unusable():
    card = analyze_turns(
        _turns(
            ("agent", "Hello, this is Example Clinic calling about Tuesday."),
            ("callee", "Thank you for watching. Thank you for watching. Thank you for watching."),
            ("agent", "I will note that. Goodbye."),
        )
    )
    assert card["verdict"] == "UNUSABLE"


def test_analyze_harm_routes_to_human_review():
    card = analyze_turns(
        _turns(
            ("agent", "Hello, this is Example Clinic."),
            ("callee", "He said he would murder them, I do not know what is happening."),
            ("agent", "I am sorry to hear that. Goodbye."),
        )
    )
    assert card["harm_review_required"] is True
    assert card["recommended_action"]["action"] == "do_not_act_on_transcript"
    assert card["verdict"] in {"SUSPECT", "UNUSABLE"}


def test_analyze_suspect_agent_turn_with_values_reverify():
    card = analyze_turns(
        _turns(
            ("agent", "Thank you for watching. Anyway, is Tuesday the 15th correct?"),
            ("callee", "Yes, Tuesday the 15th is correct."),
            ("agent", "Thank you. Goodbye."),
        )
    )
    assert card["verdict"] == "SUSPECT"
    # The suspect agent turn contains "15", so the values inside it must be
    # re-confirmed even though the callee turn itself is clean.
    assert card["recommended_action"]["action"] == "reverify_key_fields"
    assert "15" in card["fields_to_reconfirm"]


def test_analyze_evidence_spans_mask_phone():
    card = analyze_turns(
        _turns(
            ("agent", "Is your number still 415-555-0142?"),
            ("callee", "Yes that is still my number."),
        )
    )
    # The agent turn is not a suspect turn by itself; force one:
    card = analyze_turns(
        _turns(
            ("agent", "Hello from Example Clinic."),
            ("callee", "Thank you for watching my number is 415-555-0142 yes."),
            ("agent", "Noted. Goodbye."),
        )
    )
    span = next(e for e in card["evidence"] if e["turn_index"] == 1)["span"]
    assert "4155550142" not in span.replace("-", "")


def test_analyze_date_words_in_fields():
    card = analyze_turns(
        _turns(
            ("agent", "Hello from Example Clinic."),
            ("callee", "Yeah that's fine yeah that's fine yeah that's fine on tuesday."),
            ("agent", "Thank you. Goodbye."),
        )
    )
    assert "tuesday" in card["fields_to_reconfirm"]


def test_analyze_whitespace_turn_reports_empty_turn():
    card = analyze_turns(
        _turns(
            ("agent", "Hello from Example Clinic about Tuesday."),
            ("callee", "   "),
            ("agent", "Are you still there?"),
            ("callee", "Yes, Tuesday works."),
            ("agent", "Great. Goodbye."),
        )
    )
    assert card["signals_summary"].get("empty_turn") == 1
    assert card["verdict"] == "SUSPECT"


def test_disclaimer_and_non_authorization_present():
    card = analyze_turns(_turns(("agent", "hi"), ("callee", "hello")))
    assert "not proof" in card["disclaimer"]
    assert card["skill"] == "call-transcript-reliability-gate"


# ---------------------------------------------------------------- craft


def test_craft_goal_emits_digit_by_digit_wording():
    plan = craft_goal("number-critical-call")
    assert plan["mode"] == "craft"
    assert "digit" in plan["goal"].lower()
    assert "read that date back" in plan["goal"]
    assert plan["language"] == "en"


def test_craft_goal_custom_language_passthrough():
    assert craft_goal("number-critical-call", language="en-US")["language"] == "en-US"


def test_craft_unknown_scenario_raises():
    try:
        craft_goal("free-lunch")
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "free-lunch" in str(exc)


# ---------------------------------------------------------------- CLI


def test_cli_analyze_fixture_exit0_and_valid_card():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "transcript_reliability_gate.py"), "analyze", "--transcript", str(EXAMPLE_SUSPECT)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["verdict"] in {"RELIABLE", "SUSPECT", "UNUSABLE"}


def test_cli_analyze_clean_fixture_reliable():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "transcript_reliability_gate.py"), "analyze", "--transcript", str(EXAMPLE_CLEAN)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["verdict"] == "RELIABLE"


def test_cli_analyze_surfaces_call_id():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"call_id": "run-abc123", "status": "COMPLETED", "transcript": _turns(("agent", "hi"), ("callee", "hello"))},
        )
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "transcript_reliability_gate.py"), "analyze", "--transcript", str(p)],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["call_id"] == "run-abc123"


def test_cli_analyze_missing_file_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "transcript_reliability_gate.py"), "analyze", "--transcript", "nope.json"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2
    assert "not found" in proc.stderr


def test_cli_analyze_invalid_json_exit2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "bad.json"
        p.write_text("{not json", encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "transcript_reliability_gate.py"), "analyze", "--transcript", str(p)],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 2
    assert "invalid JSON" in proc.stderr


def test_cli_craft_exit0_and_goal_present():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "transcript_reliability_gate.py"), "craft", "--scenario", "number-critical-call"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    plan = json.loads(proc.stdout)
    assert plan["goal"].startswith("You are placing a call")


def test_cli_craft_unknown_scenario_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "transcript_reliability_gate.py"), "craft", "--scenario", "bogus"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2


def test_cli_analyze_out_writes_file():
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "card.json"
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "transcript_reliability_gate.py"), "analyze", "--transcript", str(EXAMPLE_CLEAN), "--out", str(out)],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0
        assert json.loads(out.read_text(encoding="utf-8"))["verdict"] == "RELIABLE"


def test_main_returns_int(tmp_path=None):
    assert main(["craft", "--scenario", "number-critical-call"]) == 0


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
