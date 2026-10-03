#!/usr/bin/env python3
"""Tests for the call-cross-lingual-emotion-preservation skill.

Run:
    python3 -m pytest skills/call-cross-lingual-emotion-preservation/scripts/test_emotion_preservation.py -v
    python3 skills/call-cross-lingual-emotion-preservation/scripts/test_emotion_preservation.py
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
EXAMPLE_SOURCE = SKILL_DIR / "references" / "example-source-context.json"
EXAMPLE_RELAY = SKILL_DIR / "references" / "example-relay-transcript.json"

sys.path.insert(0, str(SCRIPTS))
from emotion_preservation import (  # noqa: E402
    build_parity_card,
    craft_goal,
    intensity_of,
    load_call_result,
    load_source_context,
    mask_pii,
)


def _write_result(tmp: Path, payload: dict) -> Path:
    p = tmp / "call-result.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def test_load_list_of_turns_nested_result():
    data = load_call_result(EXAMPLE_RELAY)
    assert data["status"] == "completed"
    assert data["turns"][0]["speaker"] == "agent"
    assert "Maria Lopez" in data["turns"][0]["text"]


def test_load_plain_string_transcript_wraps_as_single_turn():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": "agent: hello there"})
        data = load_call_result(p)
    assert len(data["turns"]) == 1
    assert data["turns"][0]["speaker"] == "agent"


def test_load_accepts_flat_top_level_transcript():
    data = load_call_result(EXAMPLE_SOURCE)
    assert data["status"] == "COMPLETED"
    assert len(data["turns"]) == 3


def test_load_empty_transcript_returns_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": []})
        data = load_call_result(p)
    assert data["turns"] == []


def test_mask_ten_digit_phone_keeps_last_two():
    # run "1 415 555 0166" is 14 chars (11 digits) -> 12 hashes + last 2 chars
    assert mask_pii("call +1 415 555 0166 now") == "call +############66 now"


def test_mask_exactly_seven_digits_is_masked():
    assert mask_pii("ref 555-0166 closed") == "ref ######66 closed"


def test_short_digit_runs_untouched():
    text = "Deliver 2 units on route 12345, ward 10"
    assert mask_pii(text) == text


def test_mask_separators_count_toward_one_run():
    assert mask_pii("id 415.555.0166 x9") == "id ##########66 x9"


def test_mask_trailing_separator_not_part_of_run():
    assert mask_pii("num 5550166, please") == "num #####66, please"


def test_intensity_high_markers():
    result = intensity_of("This is urgent. Deliver immediately, right now.")
    assert result["level"] == "high"
    assert result["score"] >= 4


def test_intensity_medium_markers():
    result = intensity_of("She is worried and would like it soon.")
    assert result["level"] == "medium"
    assert result["score"] >= 1


def test_intensity_low_neutral_text():
    result = intensity_of("The delivery address is confirmed for the records.")
    assert result["level"] == "low"
    assert result["score"] == 0


def test_intensity_markers_listed():
    result = intensity_of("Urgent, she is in pain today.")
    assert "urgent" in [m.lower() for m in result["markers"]]
    assert "pain" in [m.lower() for m in result["markers"]]


def test_load_source_context_from_call_result_json():
    text = load_source_context(EXAMPLE_SOURCE)
    assert "urgent" in text.lower()
    assert "heart medication" in text


def test_load_source_context_from_plain_text():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "note.txt"
        p.write_text("Operator note: caller sounded urgent about medication.", encoding="utf-8")
        text = load_source_context(p)
    assert "urgent" in text


def test_load_source_context_json_without_transcript_raises():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "notacall.json"
        p.write_text('{"status": "completed"}', encoding="utf-8")
        try:
            load_source_context(p)
        except ValueError as exc:
            assert "transcript" in str(exc).lower()
        else:
            raise AssertionError("expected ValueError")


def _card_from_fixtures() -> dict:
    source = load_source_context(EXAMPLE_SOURCE)
    relay = load_call_result(EXAMPLE_RELAY)
    return build_parity_card(source, relay["turns"])


def test_card_fixture_flattened_with_relay_goal():
    card = _card_from_fixtures()
    assert card["skill"] == "call-cross-lingual-emotion-preservation"
    assert card["analysis_mode"] == "heuristic"
    assert card["drift"] == "FLATTENED"
    assert card["parity_score"] == 0.5
    assert card["source_intensity"]["level"] == "high"
    assert card["relay_intensity"]["level"] == "medium"
    assert card["recommended_action"]["action"] == "re_relay_with_calibrated_goal"
    assert card["reason"] is None
    assert "disclaimer" in card and card["disclaimer"]


def test_card_evidence_has_both_sides():
    card = _card_from_fixtures()
    sides = {e["side"] for e in card["evidence"]}
    assert sides == {"source", "relay"}


def test_card_masks_digits_in_evidence():
    card = _card_from_fixtures()
    for entry in card["evidence"]:
        assert "5550166" not in json.dumps(entry)
        assert "415" not in entry["span"] or "#" in entry["span"]


def test_card_preserved_when_levels_match():
    source = "She is worried and would like it soon."
    relay = [
        {"speaker": "agent", "text": "She is concerned and would like it soon."},
        {"speaker": "callee", "text": "We can arrange that."},
    ]
    card = build_parity_card(source, relay)
    assert card["drift"] == "PRESERVED"
    assert card["parity_score"] == 1.0
    assert card["recommended_action"]["action"] == "proceed"


def test_card_amplified_when_relay_exceeds_source():
    source = "She is worried about the delivery."
    relay = [
        {"speaker": "agent", "text": "This is an emergency, we need it immediately, right now."},
        {"speaker": "callee", "text": "Understood."},
    ]
    card = build_parity_card(source, relay)
    assert card["drift"] == "AMPLIFIED"
    assert card["parity_score"] == 0.5
    assert card["recommended_action"]["action"] == "re_relay_with_calibrated_goal"


def test_card_flattened_far_gets_zero_parity():
    source = "Urgent, immediately, she is in pain."
    relay = [
        {"speaker": "agent", "text": "Calling about a delivery arrangement for the records."},
        {"speaker": "callee", "text": "Fine."},
    ]
    card = build_parity_card(source, relay)
    assert card["drift"] == "FLATTENED"
    assert card["parity_score"] == 0.0


def test_card_relay_goal_guidance_matches_craft():
    from emotion_preservation import craft_goal
    card = _card_from_fixtures()
    plan = craft_goal("emotion-relay", intensity="high")
    assert card["recommended_action"]["guidance"] == plan["goal"]


def test_card_empty_source_abstains():
    card = build_parity_card("", [{"speaker": "agent", "text": "Hello."}])
    assert card["emotion_assessment"] == "unclear"
    assert card["reason"] == "empty_source_context"


def test_card_no_relay_agent_turns_abstains():
    card = build_parity_card("Urgent please.", [{"speaker": "callee", "text": "Hello?"}])
    assert card["emotion_assessment"] == "unclear"
    assert card["reason"] == "no_agent_turns_in_relay"


def test_card_empty_turns_abstains():
    card = build_parity_card("Urgent please.", [])
    assert card["emotion_assessment"] == "unclear"


def test_craft_known_scenario_builds_goal():
    plan = craft_goal("emotion-relay")
    assert plan["skill"] == "call-cross-lingual-emotion-preservation"
    assert plan["mode"] == "craft"
    assert plan["scenario"] == "emotion-relay"
    assert plan["language"] == "en"
    assert plan["intensity"] == "high"
    assert "strongest natural urgency phrasing" in plan["goal"]


def test_craft_intensity_variants():
    assert "concerned request" in craft_goal("emotion-relay", intensity="medium")["goal"]
    assert "calm, neutral tone" in craft_goal("emotion-relay", intensity="low")["goal"]


def test_craft_unknown_scenario_raises():
    try:
        craft_goal("translation")
    except ValueError as exc:
        assert "unknown scenario" in str(exc).lower()
    else:
        raise AssertionError("expected ValueError")


def test_craft_invalid_intensity_raises():
    try:
        craft_goal("emotion-relay", intensity="extreme")
    except ValueError as exc:
        assert "intensity" in str(exc).lower()
    else:
        raise AssertionError("expected ValueError")


def test_craft_language_passthrough():
    assert craft_goal("emotion-relay", language="es")["language"] == "es"


def _run_cli(*args: str) -> subprocess.CompletedProcess:
    cmd = [sys.executable, str(SCRIPTS / "emotion_preservation.py"), *args]
    return subprocess.run(cmd, capture_output=True, text=True)


def test_cli_analyze_fixtures_outputs_card():
    proc = _run_cli(
        "analyze",
        "--source-context", str(EXAMPLE_SOURCE),
        "--relay-transcript", str(EXAMPLE_RELAY),
    )
    assert proc.returncode == 0
    card = json.loads(proc.stdout)
    assert card["drift"] == "FLATTENED"
    assert card["recommended_action"]["action"] == "re_relay_with_calibrated_goal"


def test_cli_analyze_missing_source_exits_2():
    proc = _run_cli("analyze", "--source-context", "missing.json", "--relay-transcript", str(EXAMPLE_RELAY))
    assert proc.returncode == 2
    assert "not found" in proc.stderr.lower()


def test_cli_analyze_missing_relay_exits_2():
    proc = _run_cli("analyze", "--source-context", str(EXAMPLE_SOURCE), "--relay-transcript", "missing.json")
    assert proc.returncode == 2


def test_cli_analyze_invalid_relay_json_exits_2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "bad.json"
        p.write_text("{not json", encoding="utf-8")
        proc = _run_cli("analyze", "--source-context", str(EXAMPLE_SOURCE), "--relay-transcript", str(p))
    assert proc.returncode == 2


def test_cli_analyze_non_dict_relay_json_exits_2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "list.json"
        p.write_text("[1, 2, 3]", encoding="utf-8")
        proc = _run_cli("analyze", "--source-context", str(EXAMPLE_SOURCE), "--relay-transcript", str(p))
    assert proc.returncode == 2


def test_cli_analyze_includes_call_id_when_present():
    proc = _run_cli(
        "analyze",
        "--source-context", str(EXAMPLE_SOURCE),
        "--relay-transcript", str(EXAMPLE_RELAY),
    )
    card = json.loads(proc.stdout)
    assert card["call_id"] == "example-relay-001"


def test_cli_craft_writes_out_file():
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "plan.json"
        proc = _run_cli("craft", "--scenario", "emotion-relay", "--intensity", "medium", "--out", str(out))
        assert proc.returncode == 0
        plan = json.loads(out.read_text(encoding="utf-8"))
    assert plan["mode"] == "craft"
    assert plan["intensity"] == "medium"


def test_cli_craft_unknown_scenario_exits_2():
    proc = _run_cli("craft", "--scenario", "nope")
    assert proc.returncode == 2


def test_cli_craft_invalid_intensity_exits_2():
    proc = _run_cli("craft", "--scenario", "emotion-relay", "--intensity", "extreme")
    assert proc.returncode == 2


def test_load_number_transcript_yields_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": 42})
        assert load_call_result(p)["turns"] == []


def test_load_whitespace_only_string_transcript_yields_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": "   "})
        assert load_call_result(p)["turns"] == []


def test_load_mixed_list_skips_non_dict_and_defaults_missing_text():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {
            "status": "completed",
            "transcript": [{"speaker": "CALLEE", "text": "hi"}, "junk", {"speaker": "agent"}, 5],
        })
        data = load_call_result(p)
    assert data["turns"] == [
        {"speaker": "CALLEE", "text": "hi"},
        {"speaker": "agent", "text": ""},
    ]


def test_load_source_context_agent_only_transcript_raises():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "src.json"
        p.write_text(json.dumps({
            "status": "completed",
            "transcript": [{"speaker": "agent", "text": "Hello, this is the clinic."}],
        }), encoding="utf-8")
        try:
            load_source_context(p)
        except ValueError as exc:
            assert "transcript" in str(exc).lower()
        else:
            raise AssertionError("expected ValueError")


def test_load_source_context_skips_non_dict_and_empty_text():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "src.json"
        p.write_text(json.dumps({
            "transcript": [
                {"speaker": "agent", "text": "ignore me"},
                "junk",
                {"speaker": "callee", "text": ""},
                {"speaker": "CALLEE", "text": "This is urgent, she needs it right now."},
            ],
        }), encoding="utf-8")
        text = load_source_context(p)
    assert "urgent" in text.lower()
    assert "ignore" not in text


def test_card_high_source_low_relay_flattened_far():
    card = build_parity_card(
        "Urgent, immediately please.",
        [{"speaker": "agent", "text": "Calling about a routine delivery."}],
    )
    assert card["drift"] == "FLATTENED"
    assert card["parity_score"] == 0.0
    assert card["recommended_action"]["action"] == "re_relay_with_calibrated_goal"


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
