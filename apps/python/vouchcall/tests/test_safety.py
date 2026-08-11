"""Credential-free tests for safety boundaries: store, agent flow, prompts, encryption.

Run: python -m pytest tests/test_safety.py -v
No API keys needed.
"""
import sys
import os
import json
import sqlite3
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

    def test_schema_has_quality_status_column(self):
        conn = sqlite3.connect(str(self.db_path))
        cols = [r[1] for r in conn.execute("PRAGMA table_info(calls)").fetchall()]
        conn.close()
        assert "quality_status" in cols

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

    def test_get_references_returns_masked_phones(self):
        cid = self.store.add_candidate("Test", "Role")
        self.store.add_reference(cid, "Ref", "+14155551234", "Manager")
        refs = self.store.get_references(cid)
        assert refs[0]["phone"].endswith("1234")
        assert "4155" not in refs[0]["phone"]

    def test_get_references_for_calling_returns_real_phones(self):
        cid = self.store.add_candidate("Test", "Role")
        self.store.add_reference(cid, "Ref", "+14155551234", "Manager")
        refs = self.store.get_references_for_calling(cid)
        assert refs[0]["phone"] == "+14155551234"

    def test_save_call_with_quality_status(self):
        cid = self.store.add_candidate("Carol", "Designer")
        rid = self.store.add_reference(cid, "Ref", "+14155551234", "Manager")
        self.store.save_call(
            ref_id=rid, candidate_id=cid, calle_call_id="test_123",
            status="completed",
            scores={"collaboration": 8, "technical_ability": 7, "reliability": 9,
                    "communication": 8, "leadership": 6},
            strengths=["good"], growth_areas=["improve"],
            overall_recommendation="yes", key_quotes=["great work"],
            summary="Positive review.", transcript="Bot: hi\nUser: hello",
            quality_status="verified",
        )
        calls = self.store.get_calls_for_candidate(cid)
        assert len(calls) == 1
        assert calls[0]["collaboration_score"] == 8
        assert calls[0]["quality_status"] == "verified"

    def test_save_call_no_consent(self):
        cid = self.store.add_candidate("Test", "Role")
        rid = self.store.add_reference(cid, "Ref", "+10000000000", "Peer")
        self.store.save_call(
            ref_id=rid, candidate_id=cid, calle_call_id="nc_1",
            status="completed", scores={}, strengths=[], growth_areas=[],
            overall_recommendation="", key_quotes=[],
            summary="Declined consent.", quality_status="no_consent",
        )
        calls = self.store.get_calls_for_candidate(cid)
        assert calls[0]["quality_status"] == "no_consent"

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

    def test_get_completed_call_ids(self):
        cid = self.store.add_candidate("Eve", "SRE")
        rid = self.store.add_reference(cid, "Ref1", "+14155551234", "Manager")
        self.store.save_call(
            ref_id=rid, candidate_id=cid, calle_call_id="call_1",
            status="completed", scores={}, strengths=[], growth_areas=[],
            overall_recommendation="", key_quotes=[], summary="ok",
        )
        self.store.save_call(
            ref_id=rid, candidate_id=cid, calle_call_id="call_2",
            status="failed", scores={}, strengths=[], growth_areas=[],
            overall_recommendation="", key_quotes=[], summary="failed",
        )
        completed_ids = self.store.get_completed_call_ids(cid)
        assert "call_1" in completed_ids
        assert "call_2" not in completed_ids

    def test_get_refs_by_quality(self):
        cid = self.store.add_candidate("Test", "Role")
        rid1 = self.store.add_reference(cid, "GoodRef", "+10000000001", "Manager")
        rid2 = self.store.add_reference(cid, "BadRef", "+10000000002", "Peer")
        self.store.save_call(
            ref_id=rid1, candidate_id=cid, calle_call_id="c1",
            status="completed", scores={}, strengths=[], growth_areas=[],
            overall_recommendation="", key_quotes=[], summary="ok",
            quality_status="verified",
        )
        self.store.save_call(
            ref_id=rid2, candidate_id=cid, calle_call_id="c2",
            status="completed", scores={}, strengths=[], growth_areas=[],
            overall_recommendation="", key_quotes=[], summary="declined",
            quality_status="no_consent",
        )
        no_consent_refs = self.store.get_refs_by_quality(cid, {"no_consent"})
        assert "BadRef" in no_consent_refs
        assert "GoodRef" not in no_consent_refs

    def test_migrate_quality_status_idempotent(self):
        conn = sqlite3.connect(str(self.db_path))
        from store import _migrate_quality_status
        _migrate_quality_status(conn)
        _migrate_quality_status(conn)
        cols = [r[1] for r in conn.execute("PRAGMA table_info(calls)").fetchall()]
        assert cols.count("quality_status") == 1
        conn.close()


class TestEncryption:
    def test_encrypt_decrypt_roundtrip(self):
        from cryptography.fernet import Fernet
        key = Fernet.generate_key().decode()
        with patch("config.ENCRYPTION_KEY", key):
            from config import encrypt_field, decrypt_field
            original = "+14155551234"
            encrypted = encrypt_field(original)
            assert encrypted != original
            decrypted = decrypt_field(encrypted)
            assert decrypted == original

    def test_encrypt_empty_returns_empty(self):
        with patch("config.ENCRYPTION_KEY", "some_key"):
            from config import encrypt_field
            assert encrypt_field("") == ""

    def test_encrypt_no_key_returns_plaintext(self):
        with patch("config.ENCRYPTION_KEY", ""):
            from config import encrypt_field
            assert encrypt_field("+14155551234") == "+14155551234"

    def test_decrypt_no_key_returns_plaintext(self):
        with patch("config.ENCRYPTION_KEY", ""):
            from config import decrypt_field
            assert decrypt_field("some_value") == "some_value"

    def test_decrypt_wrong_key_returns_empty(self):
        from cryptography.fernet import Fernet
        key1 = Fernet.generate_key().decode()
        key2 = Fernet.generate_key().decode()
        with patch("config.ENCRYPTION_KEY", key1):
            from config import encrypt_field
            encrypted = encrypt_field("secret")
        with patch("config.ENCRYPTION_KEY", key2):
            from config import decrypt_field
            result = decrypt_field(encrypted)
            assert result == ""

    def test_decrypt_garbage_returns_empty(self):
        from cryptography.fernet import Fernet
        key = Fernet.generate_key().decode()
        with patch("config.ENCRYPTION_KEY", key):
            from config import decrypt_field
            assert decrypt_field("not_encrypted_data") == ""


class TestStoreEncryption:
    @pytest.fixture(autouse=True)
    def setup_db(self, tmp_path):
        self.db_path = tmp_path / "test_enc.db"
        from cryptography.fernet import Fernet
        self.key = Fernet.generate_key().decode()
        with patch("store.DB_PATH", self.db_path), patch("config.ENCRYPTION_KEY", self.key):
            import store
            self.store = store
            store.init_db()
            yield

    def test_phone_encrypted_in_db(self):
        with patch("config.ENCRYPTION_KEY", self.key):
            cid = self.store.add_candidate("Test", "Role")
            self.store.add_reference(cid, "Ref", "+14155551234", "Manager")
            conn = sqlite3.connect(str(self.db_path))
            row = conn.execute("SELECT phone FROM refs WHERE candidate_id = ?", (cid,)).fetchone()
            conn.close()
            assert row[0] != "+14155551234"
            assert "4155" not in row[0]

    def test_transcript_encrypted_in_db(self):
        with patch("config.ENCRYPTION_KEY", self.key):
            cid = self.store.add_candidate("Test", "Role")
            rid = self.store.add_reference(cid, "Ref", "+10000000000", "Peer")
            self.store.save_call(
                ref_id=rid, candidate_id=cid, calle_call_id="t1",
                status="completed", scores={}, strengths=[], growth_areas=[],
                overall_recommendation="", key_quotes=[],
                summary="ok", transcript="Bot: Hello\nUser: Hi there",
            )
            conn = sqlite3.connect(str(self.db_path))
            row = conn.execute("SELECT transcript FROM calls WHERE candidate_id = ?", (cid,)).fetchone()
            conn.close()
            assert "Hello" not in row[0]

    def test_transcript_decrypted_on_read(self):
        with patch("config.ENCRYPTION_KEY", self.key):
            cid = self.store.add_candidate("Test", "Role")
            rid = self.store.add_reference(cid, "Ref", "+10000000000", "Peer")
            self.store.save_call(
                ref_id=rid, candidate_id=cid, calle_call_id="t2",
                status="completed", scores={}, strengths=[], growth_areas=[],
                overall_recommendation="", key_quotes=[],
                summary="ok", transcript="Bot: Hello\nUser: Hi there",
            )
            calls = self.store.get_calls_for_candidate(cid)
            assert "Bot: Hello" in calls[0]["transcript"]


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

    def test_consent_question_in_prompt(self):
        from prompts import build_reference_call_goal
        goal = build_reference_call_goal(
            candidate_name="Test", reference_name="Ref",
            reference_relation="Peer", role_title="Role",
        )
        assert "analyzed by ai" in goal.lower() or "is that okay" in goal.lower()

    def test_consent_decline_ends_call(self):
        from prompts import build_reference_call_goal
        goal = build_reference_call_goal(
            candidate_name="Test", reference_name="Ref",
            reference_relation="Peer", role_title="Role",
        )
        assert "decline" in goal.lower() or "thank them and end" in goal.lower()

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


class TestAgentConstants:
    def test_permanent_quality_statuses(self):
        from agent import PERMANENT_QUALITY_STATUSES
        assert "no_consent" in PERMANENT_QUALITY_STATUSES
        assert "wrong_person" not in PERMANENT_QUALITY_STATUSES

    def test_retryable_quality_statuses(self):
        from agent import RETRYABLE_QUALITY_STATUSES
        assert "wrong_person" in RETRYABLE_QUALITY_STATUSES
        assert "insufficient" in RETRYABLE_QUALITY_STATUSES
        assert "no_consent" not in RETRYABLE_QUALITY_STATUSES


class TestLLMIdentityConsent:
    def test_llm_check_yes_no_returns_true_on_yes(self):
        from llm import _llm_check_yes_no
        mock_response = MagicMock()
        mock_response.text = "yes"
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = mock_response
        with patch("llm._get_client", return_value=mock_client):
            assert _llm_check_yes_no("Did they consent?", "some context") is True

    def test_llm_check_yes_no_returns_false_on_no(self):
        from llm import _llm_check_yes_no
        mock_response = MagicMock()
        mock_response.text = "no"
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = mock_response
        with patch("llm._get_client", return_value=mock_client):
            assert _llm_check_yes_no("Did they consent?", "some context") is False

    def test_llm_check_yes_no_returns_false_on_error(self):
        from llm import _llm_check_yes_no
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = Exception("API error")
        with patch("llm._get_client", return_value=mock_client):
            assert _llm_check_yes_no("Did they consent?", "some context") is False

    def test_check_identity_always_calls_llm(self):
        from llm import _check_identity_confirmed
        transcript = "Bot: Am I speaking with Jordan Lee?\nUser: Yes, this is Jordan."
        mock_response = MagicMock()
        mock_response.text = "yes"
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = mock_response
        with patch("llm._get_client", return_value=mock_client):
            result = _check_identity_confirmed(transcript, "Jordan Lee")
            assert result is True
            mock_client.models.generate_content.assert_called_once()

    def test_check_consent_always_calls_llm(self):
        from llm import _check_consent_given
        transcript = "Bot: This call will be analyzed by AI. Is that okay?\nUser: Sure, go ahead."
        mock_response = MagicMock()
        mock_response.text = "yes"
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = mock_response
        with patch("llm._get_client", return_value=mock_client):
            result = _check_consent_given(transcript)
            assert result is True
            mock_client.models.generate_content.assert_called_once()

    def test_identity_denied_by_llm(self):
        from llm import _check_identity_confirmed
        transcript = "Bot: Am I speaking with Jordan Lee?\nUser: Who is this?"
        mock_response = MagicMock()
        mock_response.text = "no"
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = mock_response
        with patch("llm._get_client", return_value=mock_client):
            result = _check_identity_confirmed(transcript, "Jordan Lee")
            assert result is False

    def test_consent_denied_by_llm(self):
        from llm import _check_consent_given
        transcript = "Bot: This call will be analyzed by AI. Is that okay?\nUser: No thanks."
        mock_response = MagicMock()
        mock_response.text = "no"
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = mock_response
        with patch("llm._get_client", return_value=mock_client):
            result = _check_consent_given(transcript)
            assert result is False


class TestCandidateConsent:
    @pytest.fixture(autouse=True)
    def setup_db(self, tmp_path):
        self.db_path = tmp_path / "test_consent.db"
        with patch("store.DB_PATH", self.db_path):
            import store
            self.store = store
            store.init_db()
            yield

    def test_record_and_check_consent(self):
        cid = self.store.add_candidate("Test", "Role")
        assert self.store.has_candidate_consent(cid) is False
        self.store.record_candidate_consent(cid)
        assert self.store.has_candidate_consent(cid) is True

    def test_consent_nonexistent_candidate(self):
        assert self.store.has_candidate_consent(9999) is False

    def test_record_consent_nonexistent_returns_false(self):
        assert self.store.record_candidate_consent(9999) is False

    def test_migrate_contact_consent_idempotent(self):
        conn = sqlite3.connect(str(self.db_path))
        from store import _migrate_contact_consent
        _migrate_contact_consent(conn)
        _migrate_contact_consent(conn)
        cols = [r[1] for r in conn.execute("PRAGMA table_info(candidates)").fetchall()]
        assert cols.count("contact_consent") == 1
        conn.close()


class TestCountCallsForRef:
    @pytest.fixture(autouse=True)
    def setup_db(self, tmp_path):
        self.db_path = tmp_path / "test_count.db"
        with patch("store.DB_PATH", self.db_path):
            import store
            self.store = store
            store.init_db()
            yield

    def test_zero_calls(self):
        cid = self.store.add_candidate("Test", "Role")
        rid = self.store.add_reference(cid, "Ref", "+10000000000", "Peer")
        assert self.store.count_calls_for_ref(rid) == 0

    def test_counts_multiple_calls(self):
        cid = self.store.add_candidate("Test", "Role")
        rid = self.store.add_reference(cid, "Ref", "+10000000000", "Peer")
        for i in range(3):
            self.store.save_call(
                ref_id=rid, candidate_id=cid, calle_call_id=f"call_{i}",
                status="completed", scores={}, strengths=[], growth_areas=[],
                overall_recommendation="", key_quotes=[], summary="ok",
            )
        assert self.store.count_calls_for_ref(rid) == 3

    def test_counts_only_matching_ref(self):
        cid = self.store.add_candidate("Test", "Role")
        rid1 = self.store.add_reference(cid, "Ref1", "+10000000001", "Peer")
        rid2 = self.store.add_reference(cid, "Ref2", "+10000000002", "Manager")
        self.store.save_call(
            ref_id=rid1, candidate_id=cid, calle_call_id="c1",
            status="completed", scores={}, strengths=[], growth_areas=[],
            overall_recommendation="", key_quotes=[], summary="ok",
        )
        self.store.save_call(
            ref_id=rid2, candidate_id=cid, calle_call_id="c2",
            status="completed", scores={}, strengths=[], growth_areas=[],
            overall_recommendation="", key_quotes=[], summary="ok",
        )
        assert self.store.count_calls_for_ref(rid1) == 1
        assert self.store.count_calls_for_ref(rid2) == 1


class TestAssessCallQuality:
    def _mock_llm_yes_no(self, identity_answer, consent_answer):
        call_count = [0]
        def side_effect(question, context):
            call_count[0] += 1
            if "confirm they are" in question:
                return identity_answer
            if "consent" in question:
                return consent_answer
            return False
        return side_effect

    def test_verified_transcript(self):
        from llm import assess_call_quality
        transcript = """Bot: Am I speaking with Jordan Lee?
User: Yes, this is Jordan.
Bot: Great. Alex Morgan listed you as a reference. This call will be analyzed by AI. Is that okay with you?
User: Yes, go ahead.
Bot: How long did you work with Alex, and in what capacity?
User: I worked with him for 2 years as his manager.
Bot: What would you say were Alex's greatest strengths?
User: He was one of the best engineers in our team and a great team player.
Bot: How did Alex collaborate with others on the team?
User: Fantastic, he was always helping other engineers and doing thorough reviews.
Bot: Was Alex reliable with deadlines and commitments?
User: Very reliable, never had to chase him at all.
Bot: Were there areas where Alex could grow or improve?
User: He could be more vocal in larger meetings, that's about it.
Bot: On a scale of 1 to 10, how strongly would you recommend Alex?
User: I'd say a 9, I'd hire him again in a heartbeat."""
        with patch("llm._llm_check_yes_no", side_effect=self._mock_llm_yes_no(True, True)):
            result = assess_call_quality(transcript, "Jordan Lee")
        assert result["quality_status"] == "verified"
        assert result["identity_confirmed"] is True
        assert result["consent_given"] is True
        assert result["turn_count"] >= 6

    def test_wrong_person(self):
        from llm import assess_call_quality
        transcript = "Bot: Am I speaking with Jordan Lee?\nUser: No, wrong number."
        with patch("llm._llm_check_yes_no", side_effect=self._mock_llm_yes_no(False, True)):
            result = assess_call_quality(transcript, "Jordan Lee")
        assert result["quality_status"] == "wrong_person"

    def test_no_consent(self):
        from llm import assess_call_quality
        transcript = """Bot: Am I speaking with Jordan Lee?
User: Yes, speaking.
Bot: This call will be analyzed by AI. Is that okay with you?
User: No, I'd prefer not to do that."""
        with patch("llm._llm_check_yes_no", side_effect=self._mock_llm_yes_no(True, False)):
            result = assess_call_quality(transcript, "Jordan Lee")
        assert result["quality_status"] == "no_consent"

    def test_insufficient_turns(self):
        from llm import assess_call_quality
        transcript = """Bot: Am I speaking with Jordan Lee?
User: Yes, speaking.
Bot: This call will be analyzed by AI. Is that okay with you?
User: Sure, go ahead.
Bot: Thanks, goodbye."""
        with patch("llm._llm_check_yes_no", side_effect=self._mock_llm_yes_no(True, True)):
            result = assess_call_quality(transcript, "Jordan Lee")
        assert result["quality_status"] == "insufficient"
        assert result["turn_count"] < 6
