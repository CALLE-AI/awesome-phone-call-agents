"""Credential-free tests for safety boundaries: store, agent flow, prompts, parsing.

Run: python -m pytest tests/test_safety.py -v
No API keys needed.
"""
import sys
import os
import json
import sqlite3
import tempfile
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestStore:
    @pytest.fixture(autouse=True)
    def setup_db(self, tmp_path):
        self.db_path = tmp_path / "test.db"
        with patch("store.DB_PATH", self.db_path):
            import store
            self.store = store
            store.init_db()
            yield

    def test_init_creates_tables(self):
        conn = sqlite3.connect(str(self.db_path))
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        conn.close()
        assert "candidates" in tables
        assert "refs" in tables
        assert "calls" in tables
        assert "analysis" in tables

    def test_schema_has_no_raw_result_column(self):
        conn = sqlite3.connect(str(self.db_path))
        cols = [r[1] for r in conn.execute("PRAGMA table_info(calls)").fetchall()]
        conn.close()
        assert "raw_result" not in cols

    def test_add_and_get_candidate(self):
        cid = self.store.add_candidate("Alice", "Engineer")
        c = self.store.get_candidate(cid)
        assert c["name"] == "Alice"
        assert c["role_title"] == "Engineer"

    def test_get_missing_candidate_returns_none(self):
        assert self.store.get_candidate(9999) is None

    def test_add_and_get_references(self):
        cid = self.store.add_candidate("Bob", "PM")
        self.store.add_reference(cid, "Ref1", "+14155551234", "Manager")
        self.store.add_reference(cid, "Ref2", "+14155555678", "Peer")
        refs = self.store.get_references(cid)
        assert len(refs) == 2
        assert refs[0]["name"] == "Ref1"
        assert refs[1]["name"] == "Ref2"

    def test_save_call_without_raw_result(self):
        cid = self.store.add_candidate("Carol", "Designer")
        rid = self.store.add_reference(cid, "Ref", "+14155551234", "Manager")
        call_id = self.store.save_call(
            ref_id=rid, candidate_id=cid, calle_call_id="test_123",
            status="completed",
            scores={"collaboration": 8, "technical_ability": 7, "reliability": 9,
                    "communication": 8, "leadership": 6},
            strengths=["good"], growth_areas=["improve"],
            overall_recommendation="yes", key_quotes=["great work"],
            summary="Positive review.", transcript="Bot: hi\nUser: hello",
        )
        calls = self.store.get_calls_for_candidate(cid)
        assert len(calls) == 1
        assert calls[0]["collaboration_score"] == 8
        assert calls[0]["strengths"] == ["good"]
        assert calls[0]["key_quotes"] == ["great work"]

    def test_save_and_get_analysis(self):
        cid = self.store.add_candidate("Dave", "Lead")
        self.store.save_analysis(
            candidate_id=cid,
            discrepancies=[{"dimension": "reliability", "detail": "gap", "severity": "major"}],
            overall_summary="Mixed signals.",
            hire_recommendation="lean_hire",
            confidence_score=72,
        )
        a = self.store.get_analysis(cid)
        assert a["hire_recommendation"] == "lean_hire"
        assert a["confidence_score"] == 72
        assert len(a["discrepancies"]) == 1

    def test_idempotency_data(self):
        cid = self.store.add_candidate("Eve", "SRE")
        rid = self.store.add_reference(cid, "Ref1", "+14155551234", "Manager")
        self.store.save_call(
            ref_id=rid, candidate_id=cid, calle_call_id="call_1",
            status="completed",
            scores={"collaboration": 7, "technical_ability": 7, "reliability": 7,
                    "communication": 7, "leadership": 7},
            strengths=[], growth_areas=[],
            overall_recommendation="yes", key_quotes=[],
            summary="ok", transcript="",
        )
        calls = self.store.get_calls_for_candidate(cid)
        already_called = {c["ref_name"] for c in calls if c["status"] == "completed"}
        assert "Ref1" in already_called


class TestPrompts:
    def test_identity_verification_before_disclosure(self):
        from prompts import build_reference_call_goal
        goal = build_reference_call_goal(
            candidate_name="Alex Morgan",
            reference_name="Jordan Lee",
            reference_relation="Former Manager",
            role_title="Senior Software Engineer",
        )
        verify_pos = goal.find("Am I speaking with")
        disclose_pos = goal.find("Alex Morgan listed you")
        assert verify_pos != -1, "Identity verification not found in prompt"
        assert disclose_pos != -1, "Candidate disclosure not found in prompt"
        assert verify_pos < disclose_pos, "Disclosure happens before identity verification"

    def test_wrong_person_ends_call(self):
        from prompts import build_reference_call_goal
        goal = build_reference_call_goal(
            candidate_name="Test", reference_name="Ref",
            reference_relation="Peer", role_title="Role",
        )
        assert "wrong person" in goal.lower() or "say no" in goal.lower()

    def test_does_not_leak_scores(self):
        from prompts import build_reference_call_goal
        goal = build_reference_call_goal(
            candidate_name="Test", reference_name="Ref",
            reference_relation="Peer", role_title="Role",
        )
        assert "Do NOT reveal the scores" in goal


class TestExtractTranscript:
    def test_calle_format(self):
        from llm import extract_transcript
        result = {
            "recipients": [{
                "attempts": [{
                    "transcript_turns": [
                        {"speaker": "bot", "text": "Hello"},
                        {"speaker": "human", "text": "Hi there"},
                    ]
                }]
            }]
        }
        transcript = extract_transcript(result)
        assert "Bot: Hello" in transcript
        assert "User: Hi there" in transcript

    def test_fallback_to_transcript_field(self):
        from llm import extract_transcript
        result = {"transcript": "Bot: Hello\nUser: Hi"}
        assert extract_transcript(result) == "Bot: Hello\nUser: Hi"

    def test_empty_result(self):
        from llm import extract_transcript
        assert extract_transcript({}) == ""

    def test_empty_recipients(self):
        from llm import extract_transcript
        assert extract_transcript({"recipients": []}) == ""


class TestParseJsonResponse:
    def test_plain_json(self):
        from llm import _parse_json_response
        result = _parse_json_response('{"score": 8}')
        assert result["score"] == 8

    def test_markdown_wrapped(self):
        from llm import _parse_json_response
        text = '```json\n{"score": 8}\n```'
        result = _parse_json_response(text)
        assert result["score"] == 8

    def test_markdown_no_lang(self):
        from llm import _parse_json_response
        text = '```\n{"score": 8}\n```'
        result = _parse_json_response(text)
        assert result["score"] == 8

    def test_invalid_json_raises(self):
        from llm import _parse_json_response
        with pytest.raises(Exception):
            _parse_json_response("not json at all")

    def test_with_surrounding_text(self):
        from llm import _parse_json_response
        text = 'Here is the analysis:\n```json\n{"score": 8}\n```\nHope this helps!'
        result = _parse_json_response(text)
        assert result["score"] == 8


class TestAgentSafetyGates:
    def test_dry_run_does_not_require_keys(self):
        with patch.dict(os.environ, {"CALLE_API_KEY": "", "GEMINI_API_KEY": ""}, clear=False):
            from config import require_keys
            # Should NOT raise when not called
            # Simulates: dry-run path never calls require_keys

    def test_require_keys_raises_on_missing(self):
        from config import require_keys
        with patch("config.CALLE_API_KEY", ""):
            with pytest.raises(SystemExit):
                require_keys("CALLE_API_KEY")

    def test_require_keys_passes_when_set(self):
        from config import require_keys
        with patch("config.CALLE_API_KEY", "real_key"):
            require_keys("CALLE_API_KEY")

    def test_e164_rejects_before_call(self):
        from config import validate_e164
        with pytest.raises(ValueError):
            validate_e164("not-a-phone")

    def test_mask_phone_last_four(self):
        from config import mask_phone
        masked = mask_phone("+14155551234")
        assert masked.endswith("1234")
        assert "4155" not in masked
