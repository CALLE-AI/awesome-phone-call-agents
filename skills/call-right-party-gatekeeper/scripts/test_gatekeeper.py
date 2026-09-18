#!/usr/bin/env python3
"""Tests for the call-right-party-gatekeeper skill.

Run:
    python3 -m pytest skills/call-right-party-gatekeeper/scripts/test_gatekeeper.py -v
    python3 skills/call-right-party-gatekeeper/scripts/test_gatekeeper.py
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
EXAMPLE_VERIFIED = SKILL_DIR / "references" / "example-transcript.json"
EXAMPLE_WRONG_PARTY = SKILL_DIR / "references" / "example-transcript-wrong-party.json"

sys.path.insert(0, str(SCRIPTS))
from gatekeeper import (  # noqa: E402
    build_gate_card,
    craft_goal,
    detect_signals,
    load_call_result,
    mask_pii,
)


def _write_result(tmp: Path, payload: dict) -> Path:
    p = tmp / "call-result.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def test_load_list_of_turns_nested_result():
    data = load_call_result(EXAMPLE_VERIFIED)
    assert data["status"] == "COMPLETED"
    assert data["turns"][0]["speaker"] == "agent"
    assert data["turns"][1]["speaker"] == "callee"
    assert "May I speak to Dana Reyes" in data["turns"][0]["text"]


def test_load_plain_string_transcript_wraps_as_single_turn():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": "agent: hello there"})
        data = load_call_result(p)
    assert len(data["turns"]) == 1
    assert data["turns"][0]["speaker"] == "agent"


def test_load_accepts_flat_top_level_transcript():
    data = load_call_result(EXAMPLE_WRONG_PARTY)
    assert data["status"] == "completed"
    assert len(data["turns"]) == 3


def test_load_empty_transcript_returns_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": []})
        data = load_call_result(p)
    assert data["turns"] == []


def test_mask_ten_digit_phone_keeps_last_two():
    # run "1 415 555 0142" is 14 chars (11 digits) -> 12 hashes + last 2 chars.
    # Note: expected value corrected from "00" (task-spec typo) to "42", the
    # actual last 2 chars of the run.
    assert mask_pii("call +1 415 555 0142 now") == "call +############42 now"


def test_mask_exactly_seven_digits_is_masked():
    assert mask_pii("ref 555-0142 closed") == "ref ######42 closed"


def test_short_digit_runs_untouched():
    text = "Thursday 10:00, 3rd attempt, order 12345"
    assert mask_pii(text) == text


def test_mask_separators_count_toward_one_run():
    assert mask_pii("id 415.555.0142 x9") == "id ##########42 x9"


def test_mask_trailing_separator_not_part_of_run():
    assert mask_pii("num 5550142, please") == "num #####42, please"
