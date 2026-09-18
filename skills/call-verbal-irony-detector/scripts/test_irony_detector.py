#!/usr/bin/env python3
"""Tests for the call-verbal-irony-detector skill.

Run:
    python3 -m pytest skills/call-verbal-irony-detector/scripts/test_irony_detector.py -v
    python3 skills/call-verbal-irony-detector/scripts/test_irony_detector.py
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
EXAMPLE_IRONIC = SKILL_DIR / "references" / "example-transcript.json"
EXAMPLE_SINCERE = SKILL_DIR / "references" / "example-transcript-sincere.json"

sys.path.insert(0, str(SCRIPTS))
from irony_detector import (  # noqa: E402
    analyze_turns,
    craft_goal,
    load_call_result,
    mask_pii,
    score_turn,
)


def _write_result(tmp: Path, payload: dict) -> Path:
    p = tmp / "call-result.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def test_load_list_of_turns_nested_result():
    data = load_call_result(EXAMPLE_IRONIC)
    assert data["status"] == "COMPLETED"
    assert data["turns"][0]["speaker"] == "agent"
    assert data["turns"][3]["speaker"] == "callee"
    assert "Just perfect" in data["turns"][3]["text"]


def test_load_plain_string_transcript_wraps_as_single_turn():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": "agent: hello there"})
        data = load_call_result(p)
    assert len(data["turns"]) == 1
    assert data["turns"][0]["speaker"] == "agent"


def test_load_accepts_flat_top_level_transcript():
    data = load_call_result(EXAMPLE_SINCERE)
    assert data["status"] == "completed"
    assert len(data["turns"]) == 5


def test_load_empty_transcript_returns_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": []})
        data = load_call_result(p)
    assert data["turns"] == []


def test_mask_ten_digit_phone_keeps_last_two():
    # run "1 415 555 0100" is 14 chars (11 digits) -> 12 hashes + last 2 chars
    assert mask_pii("call +1 415 555 0100 now") == "call +############00 now"


def test_mask_exactly_seven_digits_is_masked():
    # run "555-0100" is 8 chars (7 digits) -> 6 hashes + last 2 chars
    assert mask_pii("ref 555-0100 closed") == "ref ######00 closed"


def test_short_digit_runs_untouched():
    text = "Tuesday 10:00, 3rd time, order 12345"
    assert mask_pii(text) == text


def test_mask_separators_count_toward_one_run():
    # run "415.555.0100" is 12 chars -> 10 hashes + last 2 chars
    assert mask_pii("id 415.555.0100 x9") == "id ##########00 x9"


def test_mask_trailing_separator_not_part_of_run():
    assert mask_pii("num 5550100, please") == "num #####00, please"


def test_score_direct_marker_positive_after_complaint():
    context = "You cancelled it and I waited 40 minutes on hold."
    result = score_turn("Oh, great. Just perfect.", context)
    assert result.score >= 3
    assert "oh_great" in result.rules
    assert result.context_contrast is True


def test_score_multiple_markers_cap_at_four():
    result = score_turn("Oh, great, just perfect, yeah right.", "")
    assert result.score == 4


def test_score_contrast_rule_positive_after_complaint():
    result = score_turn("Great, thanks for that.", "My refund was late again.")
    assert result.score == 1
    assert result.context_contrast is True
    assert "context_contrast" in result.rules


def test_score_contrast_requires_positive_word():
    result = score_turn("Still no refund then.", "My refund was late again.")
    assert result.score == 0
    assert result.context_contrast is False


def test_score_positive_without_complaint_context_not_flagged():
    result = score_turn("Great, thank you for sorting that out.", "Your appointment is on Tuesday.")
    assert result.score == 0


def test_score_negative_only_turn_not_irony():
    result = score_turn("This is terrible service.", "My refund was late again.")
    assert result.score == 0


def test_thanks_a_lot_without_complaint_not_scored():
    result = score_turn("Thanks a lot for your help.", "")
    assert result.score == 0


def test_best_ever_sincere_not_scored():
    result = score_turn("That is the best service I have ever had.", "")
    assert result.score == 0


def test_thanks_a_lot_after_complaint_is_irony():
    result = score_turn("Thanks a lot.", "You cancelled it and I waited twice.")
    assert result.score == 3
    assert "thanks_a_lot" in result.rules
    assert "context_contrast" in result.rules


def _analyze_fixture(path: Path) -> dict:
    data = load_call_result(path)
    return analyze_turns(data["turns"])


def test_analyze_ironic_fixture_high_confidence_card():
    card = _analyze_fixture(EXAMPLE_IRONIC)
    assert card["skill"] == "call-verbal-irony-detector"
    assert card["analysis_mode"] == "heuristic"
    assert card["irony_detected"] is True
    assert card["confidence"] == "high"
    assert card["stated_sentiment"] == "positive"
    assert card["inferred_sentiment"] == "negative"
    assert card["recommended_action"]["action"] == "retry_with_deescalation_goal"
    assert "disclaimer" in card and card["disclaimer"]


def test_analyze_evidence_points_at_the_ironic_turn():
    card = _analyze_fixture(EXAMPLE_IRONIC)
    span = card["evidence"][0]
    assert span["turn_index"] == 3
    assert span["speaker"] == "callee"
    assert "Oh, great" in span["span"]
    assert "oh_great" in span["rules"]


def test_analyze_masks_phone_numbers_in_evidence():
    card = _analyze_fixture(EXAMPLE_IRONIC)
    for span in card["evidence"]:
        assert "55550123" not in json.dumps(span)
        assert "415" not in span["span"] or "#" in span["span"]


def test_analyze_sincere_fixture_detects_nothing():
    card = _analyze_fixture(EXAMPLE_SINCERE)
    assert card["irony_detected"] is False
    assert card["confidence"] == "none"
    assert card["recommended_action"]["action"] == "continue"
    assert card["evidence"] == []


def test_analyze_low_confidence_uses_verify_prompt():
    turns = [
        {"speaker": "agent", "text": "Your refund was late, we apologise."},
        {"speaker": "callee", "text": "Great, thanks for that."},
    ]
    card = analyze_turns(turns)
    assert card["confidence"] == "low"
    assert card["recommended_action"]["action"] == "verify_literal_intent_prompt"


def test_analyze_no_callee_turns_abstains():
    card = analyze_turns([{"speaker": "agent", "text": "Hello? Hello?"}])
    assert card["irony_assessment"] == "unclear"
    assert card["reason"] == "insufficient_callee_signal"
    assert card["irony_detected"] is False


def test_analyze_empty_turns_abstains():
    card = analyze_turns([])
    assert card["irony_assessment"] == "unclear"


def test_analyze_medium_confidence_between_low_and_high():
    # one marker and no complaint vocabulary in context -> score 2 -> medium
    turns = [
        {"speaker": "agent", "text": "Would you like a replacement?"},
        {"speaker": "callee", "text": "Oh, brilliant."},
    ]
    card = analyze_turns(turns)
    assert card["confidence"] == "medium"
    assert card["recommended_action"]["action"] == "retry_with_deescalation_goal"


def test_craft_known_scenario_builds_goal():
    plan = craft_goal("complaint-followup")
    assert plan["skill"] == "call-verbal-irony-detector"
    assert plan["mode"] == "craft"
    assert plan["scenario"] == "complaint-followup"
    assert plan["language"] == "en"
    assert "acknowledging their frustration" in plan["goal"]
    assert "confirm the literal intent" in plan["goal"].lower()


def test_craft_unknown_scenario_raises():
    try:
        craft_goal("win-back")
    except ValueError as exc:
        assert "unknown scenario" in str(exc).lower()
    else:
        raise AssertionError("expected ValueError")


def test_craft_language_passthrough():
    assert craft_goal("complaint-followup", language="vi")["language"] == "vi"


def test_craft_goal_matches_card_guidance():
    plan = craft_goal("complaint-followup")
    card = _analyze_fixture(EXAMPLE_IRONIC)
    assert plan["goal"] == card["recommended_action"]["guidance"]


def _run_cli(*args: str) -> subprocess.CompletedProcess:
    cmd = [sys.executable, str(SCRIPTS / "irony_detector.py"), *args]
    return subprocess.run(cmd, capture_output=True, text=True)


def test_cli_analyze_ironic_fixture_outputs_card():
    proc = _run_cli("analyze", "--transcript", str(EXAMPLE_IRONIC))
    assert proc.returncode == 0
    card = json.loads(proc.stdout)
    assert card["irony_detected"] is True


def test_cli_analyze_sincere_fixture_outputs_card():
    proc = _run_cli("analyze", "--transcript", str(EXAMPLE_SINCERE))
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["irony_detected"] is False


def test_cli_analyze_missing_file_exits_2():
    proc = _run_cli("analyze", "--transcript", "does-not-exist.json")
    assert proc.returncode == 2
    assert "not found" in proc.stderr.lower()


def test_cli_analyze_invalid_json_exits_2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "bad.json"
        p.write_text("{not json", encoding="utf-8")
        proc = _run_cli("analyze", "--transcript", str(p))
    assert proc.returncode == 2


def test_cli_analyze_non_dict_json_exits_2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "list.json"
        p.write_text("[1, 2, 3]", encoding="utf-8")
        proc = _run_cli("analyze", "--transcript", str(p))
    assert proc.returncode == 2


def test_cli_analyze_includes_call_id_when_present():
    proc = _run_cli("analyze", "--transcript", str(EXAMPLE_SINCERE))
    card = json.loads(proc.stdout)
    assert card["call_id"] == "example-sincere-001"


def test_cli_craft_writes_out_file():
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "plan.json"
        proc = _run_cli("craft", "--scenario", "complaint-followup", "--out", str(out))
        assert proc.returncode == 0
        plan = json.loads(out.read_text(encoding="utf-8"))
    assert plan["mode"] == "craft"


def test_cli_craft_unknown_scenario_exits_2():
    proc = _run_cli("craft", "--scenario", "nope")
    assert proc.returncode == 2


def test_card_has_reason_none_when_assessed():
    card = _analyze_fixture(EXAMPLE_IRONIC)
    assert card["reason"] is None


def _main() -> int:
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except AssertionError:
                failures += 1
                print(f"FAIL {name}")
    print(f"{failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(_main())
