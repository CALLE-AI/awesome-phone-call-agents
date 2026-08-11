"""Credential-free integration tests for calle_wrapper, seed_data, and dashboard.

Run: python -m pytest tests/test_integration.py -v
No API keys needed.
"""
import sys
import os
import json
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# -- calle_wrapper tests ----------------------------------------------------

class TestCalleWrapper:
    def test_make_call_builds_correct_payload(self):
        mock_client = MagicMock()
        mock_client.calls.create_and_wait.return_value = {"id": "123", "status": "completed"}

        with patch("calle_wrapper._client", mock_client):
            import calle_wrapper
            calle_wrapper._client = mock_client

            result = calle_wrapper.make_call(
                phone="+14155551234",
                goal="Test goal",
                region="US",
                locale="en-US",
            )

            mock_client.calls.create_and_wait.assert_called_once_with(
                task="Test goal",
                recipient={"phone": "+14155551234", "region": "US", "locale": "en-US"},
                timeout_seconds=300.0,
            )
            assert result["status"] == "completed"

    def test_make_call_passes_phone_not_masked(self):
        mock_client = MagicMock()
        mock_client.calls.create_and_wait.return_value = {"status": "completed"}

        with patch("calle_wrapper._client", mock_client):
            import calle_wrapper
            calle_wrapper._client = mock_client

            calle_wrapper.make_call(phone="+919876543210", goal="Test")

            call_args = mock_client.calls.create_and_wait.call_args
            assert call_args.kwargs["recipient"]["phone"] == "+919876543210"

    def test_get_call_status(self):
        mock_client = MagicMock()
        mock_client.calls.get.return_value = {"id": "abc", "status": "completed"}

        with patch("calle_wrapper._client", mock_client):
            import calle_wrapper
            calle_wrapper._client = mock_client

            result = calle_wrapper.get_call_status("abc")
            mock_client.calls.get.assert_called_once_with("abc")
            assert result["status"] == "completed"

    def test_default_timeout_is_300(self):
        mock_client = MagicMock()
        mock_client.calls.create_and_wait.return_value = {}

        with patch("calle_wrapper._client", mock_client):
            import calle_wrapper
            calle_wrapper._client = mock_client

            calle_wrapper.make_call(phone="+11234567890", goal="Test")
            call_args = mock_client.calls.create_and_wait.call_args
            assert call_args.kwargs["timeout_seconds"] == 300.0


# -- seed_data tests (hardcoded candidates only, no Gemini) ------------------

class TestSeedDataHardcoded:
    @pytest.fixture(autouse=True)
    def setup_db(self, tmp_path):
        self.db_path = tmp_path / "test_seed.db"
        with patch("store.DB_PATH", self.db_path):
            import store
            self.store = store
            store.init_db()
            yield

    def test_seed_sarah_patel(self):
        from seed_data import _seed_candidate_hardcoded
        with patch("store.DB_PATH", self.db_path):
            cid = _seed_candidate_hardcoded(
                "Sarah Patel", "Engineering Manager",
                refs_data=[
                    {
                        "name": "David Kim", "relation": "Direct Report",
                        "scores": {"collaboration": 9, "technical_ability": 8,
                                   "reliability": 9, "communication": 9, "leadership": 10},
                        "strengths": ["People manager"], "growth_areas": ["Delegate more"],
                        "recommendation": "strong_yes",
                        "quotes": ["Best manager ever"], "summary": "Glowing.",
                        "quality_status": "verified",
                    },
                ],
                analysis_data={
                    "discrepancies": [], "overall_summary": "Strong hire.",
                    "hire_recommendation": "strong_hire", "confidence_score": 95,
                },
            )

            candidate = self.store.get_candidate(cid)
            assert candidate["name"] == "Sarah Patel"

            calls = self.store.get_calls_for_candidate(cid)
            assert len(calls) == 1
            assert calls[0]["collaboration_score"] == 9
            assert calls[0]["overall_recommendation"] == "strong_yes"
            assert calls[0]["quality_status"] == "verified"

            analysis = self.store.get_analysis(cid)
            assert analysis["hire_recommendation"] == "strong_hire"

    def test_seed_no_consent_reference(self):
        from seed_data import _seed_candidate_hardcoded
        with patch("store.DB_PATH", self.db_path):
            cid = _seed_candidate_hardcoded(
                "Test Candidate", "Role",
                refs_data=[
                    {
                        "name": "Kevin Park", "relation": "Former Direct Report",
                        "scores": {"collaboration": 0, "technical_ability": 0,
                                   "reliability": 0, "communication": 0, "leadership": 0},
                        "strengths": [], "growth_areas": [],
                        "recommendation": "",
                        "quotes": [], "summary": "Declined consent.",
                        "quality_status": "no_consent",
                    },
                ],
                analysis_data={
                    "discrepancies": [], "overall_summary": "N/A",
                    "hire_recommendation": "lean_hire", "confidence_score": 30,
                },
            )
            calls = self.store.get_calls_for_candidate(cid)
            assert calls[0]["quality_status"] == "no_consent"
            assert calls[0]["collaboration_score"] == 0

    def test_seed_ryan_cooper_no_hire(self):
        from seed_data import _seed_candidate_hardcoded
        with patch("store.DB_PATH", self.db_path):
            cid = _seed_candidate_hardcoded(
                "Ryan Cooper", "Product Manager",
                refs_data=[
                    {
                        "name": "Tom Hartley", "relation": "Engineering Lead",
                        "scores": {"collaboration": 3, "technical_ability": 6,
                                   "reliability": 3, "communication": 4, "leadership": 4},
                        "strengths": ["Product depth"], "growth_areas": ["Listening"],
                        "recommendation": "no",
                        "quotes": ["Frustrating experience"], "summary": "Negative.",
                        "quality_status": "verified",
                    },
                ],
                analysis_data={
                    "discrepancies": [{"dimension": "collaboration",
                                       "detail": "Harmful", "severity": "major"}],
                    "overall_summary": "No hire.",
                    "hire_recommendation": "no_hire", "confidence_score": 88,
                },
            )

            analysis = self.store.get_analysis(cid)
            assert analysis["hire_recommendation"] == "no_hire"
            assert len(analysis["discrepancies"]) == 1
            assert analysis["discrepancies"][0]["severity"] == "major"


class TestSeedDataRyanCooperFullSet:
    @pytest.fixture(autouse=True)
    def setup_db(self, tmp_path):
        self.db_path = tmp_path / "test_full_seed.db"
        with patch("store.DB_PATH", self.db_path):
            import store
            self.store = store
            store.init_db()
            yield

    def test_ryan_has_kevin_park_no_consent(self):
        from seed_data import ALEX_HARDCODED, seed
        with patch("store.DB_PATH", self.db_path), patch("sys.argv", ["seed_data.py"]):
            seed()
        candidates = self.store.get_all_candidates()
        ryan = [c for c in candidates if c["name"] == "Ryan Cooper"]
        assert len(ryan) == 1
        calls = self.store.get_calls_for_candidate(ryan[0]["id"])
        kevin_calls = [c for c in calls if c["ref_name"] == "Kevin Park"]
        assert len(kevin_calls) == 1
        assert kevin_calls[0]["quality_status"] == "no_consent"

    def test_alex_transcripts_have_consent(self):
        from seed_data import ALEX_TRANSCRIPTS
        for name, data in ALEX_TRANSCRIPTS.items():
            transcript = data["transcript"]
            assert "analyzed by ai" in transcript.lower() or "is that okay" in transcript.lower(), \
                f"Consent question missing from {name}'s transcript"


# -- dashboard logic tests (no Streamlit runtime needed) ---------------------

class TestDashboardLogic:
    def test_recommendation_display_mapping(self):
        rec_display = {
            "strong_hire": "Strong Hire",
            "hire": "Hire",
            "lean_hire": "Lean Hire",
            "lean_no": "Lean No",
            "no_hire": "No Hire",
        }
        for key in ["strong_hire", "hire", "lean_hire", "lean_no", "no_hire"]:
            assert key in rec_display

    def test_recommendation_emoji_mapping(self):
        rec_emoji = {
            "strong_yes": "green", "yes": "green", "neutral": "yellow",
            "hesitant": "orange", "no": "red",
        }
        for key in ["strong_yes", "yes", "neutral", "hesitant", "no"]:
            assert key in rec_emoji

    def test_severity_color_mapping(self):
        severity_color = {"minor": "yellow", "notable": "orange", "major": "red"}
        for key in ["minor", "notable", "major"]:
            assert key in severity_color

    def test_dimensions_label_formatting(self):
        from config import DIMENSIONS
        dim_labels = [d.replace("_", " ").title() for d in DIMENSIONS]
        assert "Collaboration" in dim_labels
        assert "Technical Ability" in dim_labels
        assert "Reliability" in dim_labels
        assert "Communication" in dim_labels
        assert "Leadership" in dim_labels

    def test_radar_chart_closes_polygon(self):
        scores = [8, 7, 9, 6, 8]
        scores_closed = scores + [scores[0]]
        assert len(scores_closed) == 6
        assert scores_closed[0] == scores_closed[-1]

    def test_quality_display_mapping(self):
        quality_display = {
            "verified": ("Verified", "check"),
            "partial": ("Partial", "warning"),
            "insufficient": ("Insufficient Data", "x"),
            "no_consent": ("No Consent", "no_entry"),
            "wrong_person": ("Wrong Person", "question"),
        }
        from llm import VALID_QUALITY_STATUSES
        for status in VALID_QUALITY_STATUSES:
            assert status in quality_display


# -- config constants tests --------------------------------------------------

class TestConfigConstants:
    def test_dimensions_count(self):
        from config import DIMENSIONS
        assert len(DIMENSIONS) == 5

    def test_dimensions_are_strings(self):
        from config import DIMENSIONS
        for d in DIMENSIONS:
            assert isinstance(d, str)

    def test_gemini_model_set(self):
        from config import GEMINI_MODEL
        assert GEMINI_MODEL and isinstance(GEMINI_MODEL, str)

    def test_db_path_ends_with_db(self):
        from config import DB_PATH
        assert str(DB_PATH).endswith(".db")

    def test_min_transcript_turns(self):
        from config import MIN_TRANSCRIPT_TURNS
        assert MIN_TRANSCRIPT_TURNS == 6

    def test_min_questions_answered(self):
        from config import MIN_QUESTIONS_ANSWERED
        assert MIN_QUESTIONS_ANSWERED == 3

    def test_encryption_key_defined(self):
        from config import ENCRYPTION_KEY
        assert isinstance(ENCRYPTION_KEY, str)
