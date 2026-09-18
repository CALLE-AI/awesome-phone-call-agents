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
