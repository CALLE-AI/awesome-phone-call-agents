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
