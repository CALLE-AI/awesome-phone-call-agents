#!/usr/bin/env python3
"""Tests for the call-semantic-barge-in-analyzer skill.

Run:
    python3 -m pytest skills/call-semantic-barge-in-analyzer/scripts/test_barge_in_analyzer.py -v
    python3 skills/call-semantic-barge-in-analyzer/scripts/test_barge_in_analyzer.py
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
EXAMPLE_ENGAGED = SKILL_DIR / "references" / "example-transcript.json"
EXAMPLE_FRUSTRATED = SKILL_DIR / "references" / "example-transcript-frustrated.json"

sys.path.insert(0, str(SCRIPTS))
from barge_in_analyzer import (  # noqa: E402
    build_pacing_card,
    classify_callee_turn,
    craft_goal,
    load_call_result,
    mask_pii,
)


def _write_result(tmp: Path, payload: dict) -> Path:
    p = tmp / "call-result.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def test_load_list_of_turns_nested_result():
    data = load_call_result(EXAMPLE_ENGAGED)
    assert data["status"] == "COMPLETED"
    assert data["turns"][0]["speaker"] == "agent"
    assert data["turns"][1]["speaker"] == "callee"
    assert "lab results" in data["turns"][0]["text"]


def test_load_plain_string_transcript_wraps_as_single_turn():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": "agent: hello there"})
        data = load_call_result(p)
    assert len(data["turns"]) == 1
    assert data["turns"][0]["speaker"] == "agent"


def test_load_accepts_flat_top_level_transcript():
    data = load_call_result(EXAMPLE_FRUSTRATED)
    assert data["status"] == "completed"
    assert len(data["turns"]) == 7


def test_load_empty_transcript_returns_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": []})
        data = load_call_result(p)
    assert data["turns"] == []
