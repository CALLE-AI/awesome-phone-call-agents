#!/usr/bin/env python3
"""Tests for the call-attest-challenge-auth skill.

Run:
    python3 -m pytest skills/call-attest-challenge-auth/scripts/test_attest_auth.py -v
    python3 skills/call-attest-challenge-auth/scripts/test_attest_auth.py
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
EXAMPLE_MISMATCH = SKILL_DIR / "references" / "example-transcript-mismatch.json"

sys.path.insert(0, str(SCRIPTS))
from attest_auth import (  # noqa: E402
    _levenshtein,
    _match_response,
    _normalize_tokens,
    build_attestation_card,
    craft_goal,
    derive_code,
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
    assert "4f2a91" in data["turns"][0]["text"]


def test_load_plain_string_transcript_wraps_as_single_turn():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": "agent: hello there"})
        data = load_call_result(p)
    assert len(data["turns"]) == 1
    assert data["turns"][0]["speaker"] == "agent"


def test_load_accepts_flat_top_level_transcript():
    data = load_call_result(EXAMPLE_MISMATCH)
    assert data["status"] == "completed"
    assert len(data["turns"]) == 3


def test_load_empty_transcript_returns_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": []})
        data = load_call_result(p)
    assert data["turns"] == []
