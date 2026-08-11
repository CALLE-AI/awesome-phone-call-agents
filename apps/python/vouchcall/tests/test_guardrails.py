"""Credential-free unit tests for guardrails, validation, masking, and quality assessment.

Run: python -m pytest tests/test_guardrails.py -v
No API keys needed.
"""
import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from config import mask_phone, validate_e164, sanitize_name
from llm import (
    _clamp_score,
    _fuzzy_match,
    _check_score_recommendation_coherence,
    _compute_confidence,
    _validate_call_analysis,
    _validate_cross_analysis,
    _count_transcript_turns,
    _count_questions_answered,
    _keyword_check_identity,
    _keyword_check_consent,
    _AMBIGUOUS,
    VALID_RECOMMENDATIONS,
    VALID_HIRE_RECOMMENDATIONS,
    VALID_SEVERITIES,
    VALID_QUALITY_STATUSES,
    QUESTION_MARKERS,
    IDENTITY_AFFIRMATIVE,
    IDENTITY_NEGATIVE,
    CONSENT_AFFIRMATIVE,
    CONSENT_NEGATIVE,
)


class TestMaskPhone:
    def test_masks_like_credit_card(self):
        assert mask_phone("+14155551234") == "********1234"

    def test_preserves_last_four(self):
        assert mask_phone("+919876543210") == "*********3210"

    def test_short_phone(self):
        assert mask_phone("123") == "****"

    def test_empty_phone(self):
        assert mask_phone("") == "****"

    def test_exactly_five_chars(self):
        result = mask_phone("12345")
        assert result == "*2345"


class TestValidateE164:
    def test_valid_us(self):
        assert validate_e164("+14155551234") == "+14155551234"

    def test_valid_india(self):
        assert validate_e164("+919876543210") == "+919876543210"

    def test_strips_whitespace(self):
        assert validate_e164("+1 415 555 1234") == "+14155551234"

    def test_strips_dashes(self):
        assert validate_e164("+1-415-555-1234") == "+14155551234"

    def test_strips_parens(self):
        assert validate_e164("+1 (415) 555-1234") == "+14155551234"

    def test_rejects_no_plus(self):
        with pytest.raises(ValueError):
            validate_e164("14155551234")

    def test_rejects_too_short(self):
        with pytest.raises(ValueError):
            validate_e164("+1234")

    def test_rejects_leading_zero(self):
        with pytest.raises(ValueError):
            validate_e164("+0123456789")

    def test_rejects_letters(self):
        with pytest.raises(ValueError):
            validate_e164("+1415abc1234")

    def test_rejects_empty(self):
        with pytest.raises(ValueError):
            validate_e164("")


class TestClampScore:
    def test_normal_value(self):
        assert _clamp_score(7, "test") == 7

    def test_clamps_high(self):
        assert _clamp_score(15, "test") == 10

    def test_clamps_low(self):
        assert _clamp_score(0, "test") == 1

    def test_handles_string(self):
        assert _clamp_score("8", "test") == 8

    def test_handles_none(self):
        assert _clamp_score(None, "test") == 0

    def test_handles_garbage(self):
        assert _clamp_score("not_a_number", "test") == 0

    def test_handles_float_string(self):
        assert _clamp_score("7.5", "test") == 0


class TestFuzzyMatch:
    TRANSCRIPT = "Bot: What are Alex's strengths? User: He was one of the best engineers in our team."

    def test_exact_match(self):
        assert _fuzzy_match("one of the best engineers", self.TRANSCRIPT)

    def test_case_insensitive(self):
        assert _fuzzy_match("ONE OF THE BEST ENGINEERS", self.TRANSCRIPT)

    def test_close_match(self):
        assert _fuzzy_match("one of the best engineer in our team", self.TRANSCRIPT)

    def test_no_match(self):
        assert not _fuzzy_match("terrible at everything", self.TRANSCRIPT)

    def test_empty_quote(self):
        assert not _fuzzy_match("", self.TRANSCRIPT)

    def test_threshold_065_rejects_weak_match(self):
        assert not _fuzzy_match("some random sentence about teams", self.TRANSCRIPT)

    def test_threshold_065_accepts_strong_match(self):
        assert _fuzzy_match("he was one of the best engineers in our team", self.TRANSCRIPT)


class TestScoreRecommendationCoherence:
    def test_high_scores_override_no(self):
        scores = {"a": 9, "b": 8, "c": 9, "d": 8, "e": 9}
        assert _check_score_recommendation_coherence(scores, "no") == "yes"

    def test_high_scores_override_hesitant(self):
        scores = {"a": 9, "b": 8, "c": 9, "d": 8, "e": 9}
        assert _check_score_recommendation_coherence(scores, "hesitant") == "yes"

    def test_low_scores_override_strong_yes(self):
        scores = {"a": 2, "b": 3, "c": 1, "d": 2, "e": 3}
        assert _check_score_recommendation_coherence(scores, "strong_yes") == "hesitant"

    def test_low_scores_override_yes(self):
        scores = {"a": 2, "b": 3, "c": 1, "d": 2, "e": 3}
        assert _check_score_recommendation_coherence(scores, "yes") == "hesitant"

    def test_mid_scores_keep_recommendation(self):
        scores = {"a": 5, "b": 6, "c": 5, "d": 6, "e": 5}
        assert _check_score_recommendation_coherence(scores, "neutral") == "neutral"

    def test_empty_scores_keep_recommendation(self):
        assert _check_score_recommendation_coherence({}, "strong_yes") == "strong_yes"

    def test_single_high_score_overrides(self):
        scores = {"a": 0, "b": 0, "c": 9}
        assert _check_score_recommendation_coherence(scores, "no") == "yes"

    def test_all_zero_scores_keeps_recommendation(self):
        scores = {"a": 0, "b": 0, "c": 0}
        assert _check_score_recommendation_coherence(scores, "no") == "no"


class TestComputeConfidence:
    def test_zero_completed(self):
        assert _compute_confidence([]) == 30

    def test_one_completed(self):
        calls = [{"status": "completed", "collaboration_score": 8}]
        result = _compute_confidence(calls)
        assert 25 <= result <= 50

    def test_consistent_refs_high_confidence(self):
        calls = [
            {"status": "completed", "collaboration_score": 8, "reliability_score": 7},
            {"status": "completed", "collaboration_score": 8, "reliability_score": 8},
            {"status": "completed", "collaboration_score": 7, "reliability_score": 7},
        ]
        result = _compute_confidence(calls)
        assert result >= 75

    def test_divergent_refs_low_confidence(self):
        calls = [
            {"status": "completed", "collaboration_score": 9, "reliability_score": 9},
            {"status": "completed", "collaboration_score": 3, "reliability_score": 2},
        ]
        result = _compute_confidence(calls)
        assert result <= 60

    def test_skips_non_completed(self):
        calls = [
            {"status": "completed", "collaboration_score": 8},
            {"status": "failed", "collaboration_score": 2},
        ]
        result = _compute_confidence(calls)
        assert result <= 50

    def test_capped_at_98(self):
        calls = [
            {"status": "completed", "collaboration_score": 5, "reliability_score": 5},
            {"status": "completed", "collaboration_score": 5, "reliability_score": 5},
            {"status": "completed", "collaboration_score": 5, "reliability_score": 5},
            {"status": "completed", "collaboration_score": 5, "reliability_score": 5},
            {"status": "completed", "collaboration_score": 5, "reliability_score": 5},
        ]
        assert _compute_confidence(calls) <= 98


class TestValidateCallAnalysis:
    TRANSCRIPT = "User: He was one of the best engineers. User: I'd hire him again in a heartbeat."

    def test_clamps_scores(self):
        raw = {"collaboration_score": 15, "technical_ability_score": -1,
               "reliability_score": "abc", "communication_score": 5,
               "leadership_score": None, "overall_recommendation": "yes",
               "strengths": [], "growth_areas": [], "key_quotes": [], "ref_summary": "ok"}
        result = _validate_call_analysis(raw, "")
        assert result["collaboration_score"] == 10
        assert result["technical_ability_score"] == 1
        assert result["reliability_score"] == 0
        assert result["communication_score"] == 5
        assert result["leadership_score"] == 0

    def test_invalid_recommendation_defaults(self):
        raw = {"overall_recommendation": "maybe", "collaboration_score": 5,
               "technical_ability_score": 5, "reliability_score": 5,
               "communication_score": 5, "leadership_score": 5,
               "strengths": [], "growth_areas": [], "key_quotes": [], "ref_summary": ""}
        result = _validate_call_analysis(raw, "")
        assert result["overall_recommendation"] in VALID_RECOMMENDATIONS

    def test_verifies_quotes_against_transcript(self):
        raw = {"collaboration_score": 7, "technical_ability_score": 7,
               "reliability_score": 7, "communication_score": 7,
               "leadership_score": 7, "overall_recommendation": "yes",
               "strengths": [], "growth_areas": [],
               "key_quotes": [
                   "one of the best engineers",
                   "this quote was completely fabricated by the LLM",
               ],
               "ref_summary": "Good."}
        result = _validate_call_analysis(raw, self.TRANSCRIPT)
        assert "one of the best engineers" in result["key_quotes"]
        assert "this quote was completely fabricated by the LLM" not in result["key_quotes"]
        assert result["_quotes_verified"] is True

    def test_non_list_fields_default(self):
        raw = {"collaboration_score": 5, "technical_ability_score": 5,
               "reliability_score": 5, "communication_score": 5,
               "leadership_score": 5, "overall_recommendation": "neutral",
               "strengths": "not a list", "growth_areas": None,
               "key_quotes": 42, "ref_summary": ""}
        result = _validate_call_analysis(raw, "")
        assert result["strengths"] == []
        assert result["growth_areas"] == []
        assert result["key_quotes"] == []

    def test_coherence_override(self):
        raw = {"collaboration_score": 9, "technical_ability_score": 9,
               "reliability_score": 9, "communication_score": 9,
               "leadership_score": 9, "overall_recommendation": "no",
               "strengths": [], "growth_areas": [], "key_quotes": [], "ref_summary": ""}
        result = _validate_call_analysis(raw, "")
        assert result["overall_recommendation"] == "yes"

    def test_evidence_validation_zeros_ungrounded_scores(self):
        transcript = "Bot: How was collaboration? User: Alex was a great team player and helped everyone."
        raw = {
            "collaboration_score": 8, "technical_ability_score": 7,
            "reliability_score": 7, "communication_score": 7,
            "leadership_score": 7, "overall_recommendation": "yes",
            "strengths": [], "growth_areas": [], "key_quotes": [], "ref_summary": "",
            "evidence": {
                "collaboration": "great team player and helped everyone",
                "technical_ability": "completely fabricated evidence not in transcript",
            },
        }
        result = _validate_call_analysis(raw, transcript)
        assert result["collaboration_score"] == 8
        assert result["technical_ability_score"] == 0
        assert "collaboration" in result["evidence"]
        assert "technical_ability" not in result["evidence"]

    def test_evidence_non_dict_defaults_to_empty(self):
        raw = {
            "collaboration_score": 5, "technical_ability_score": 5,
            "reliability_score": 5, "communication_score": 5,
            "leadership_score": 5, "overall_recommendation": "neutral",
            "strengths": [], "growth_areas": [], "key_quotes": [], "ref_summary": "",
            "evidence": "not a dict",
        }
        result = _validate_call_analysis(raw, "some transcript")
        assert result["evidence"] == {}

    def test_ref_summary_defaults_to_empty_string(self):
        raw = {
            "collaboration_score": 5, "technical_ability_score": 5,
            "reliability_score": 5, "communication_score": 5,
            "leadership_score": 5, "overall_recommendation": "neutral",
            "strengths": [], "growth_areas": [], "key_quotes": [],
            "ref_summary": 42,
        }
        result = _validate_call_analysis(raw, "")
        assert result["ref_summary"] == ""


class TestValidateCrossAnalysis:
    def test_invalid_hire_recommendation(self):
        raw = {"hire_recommendation": "maybe_hire", "discrepancies": [],
               "overall_summary": "ok", "confidence_score": 80}
        calls = [{"status": "completed"}, {"status": "completed"}]
        result = _validate_cross_analysis(raw, calls)
        assert result["hire_recommendation"] in VALID_HIRE_RECOMMENDATIONS

    def test_replaces_confidence_with_calculated(self):
        raw = {"hire_recommendation": "hire", "discrepancies": [],
               "overall_summary": "ok", "confidence_score": 99}
        calls = [
            {"status": "completed", "collaboration_score": 9, "reliability_score": 3},
            {"status": "completed", "collaboration_score": 3, "reliability_score": 9},
        ]
        result = _validate_cross_analysis(raw, calls)
        assert result["confidence_score"] != 99

    def test_filters_invalid_discrepancies(self):
        raw = {
            "hire_recommendation": "hire",
            "overall_summary": "ok",
            "confidence_score": 80,
            "discrepancies": [
                {"dimension": "collaboration", "detail": "gap", "severity": "major"},
                {"dimension": "", "detail": "no dimension", "severity": "minor"},
                {"dimension": "leadership", "detail": "", "severity": "minor"},
                "not a dict",
                {"dimension": "reliability", "detail": "slipped", "severity": "extreme"},
            ],
        }
        calls = [{"status": "completed"}, {"status": "completed"}]
        result = _validate_cross_analysis(raw, calls)
        assert len(result["discrepancies"]) == 2
        assert result["discrepancies"][0]["dimension"] == "collaboration"
        assert result["discrepancies"][1]["dimension"] == "reliability"
        assert result["discrepancies"][1]["severity"] == "minor"

    def test_non_list_discrepancies_default(self):
        raw = {"hire_recommendation": "hire", "discrepancies": "not a list",
               "overall_summary": "ok", "confidence_score": 80}
        calls = [{"status": "completed"}, {"status": "completed"}]
        result = _validate_cross_analysis(raw, calls)
        assert result["discrepancies"] == []


class TestSanitizeName:
    def test_normal_name(self):
        assert sanitize_name("Alex Morgan") == "Alex Morgan"

    def test_strips_control_chars(self):
        assert sanitize_name("Alex\nMorgan\t") == "AlexMorgan"

    def test_strips_null_bytes(self):
        assert sanitize_name("Alex\x00Morgan") == "AlexMorgan"

    def test_truncates_long_name(self):
        long_name = "A" * 200
        assert len(sanitize_name(long_name)) == 100

    def test_strips_whitespace(self):
        assert sanitize_name("  Alex Morgan  ") == "Alex Morgan"

    def test_empty_string(self):
        assert sanitize_name("") == ""

    def test_unicode_preserved(self):
        assert sanitize_name("Priya Sharma") == "Priya Sharma"


class TestCountTranscriptTurns:
    def test_normal_transcript(self):
        transcript = "Bot: Hello\nUser: Hi\nBot: How are you?\nUser: Good"
        assert _count_transcript_turns(transcript) == 4

    def test_empty_transcript(self):
        assert _count_transcript_turns("") == 0

    def test_none_transcript(self):
        assert _count_transcript_turns(None) == 0

    def test_no_prefixed_lines(self):
        assert _count_transcript_turns("just some random text") == 0

    def test_mixed_lines(self):
        transcript = "Bot: Hi\nsome noise\nUser: Hello\nmore noise"
        assert _count_transcript_turns(transcript) == 2


class TestCountQuestionsAnswered:
    def test_full_transcript(self):
        transcript = """Bot: How long did you work with Alex, and in what capacity?
User: I worked with him for 2 years as his manager.
Bot: What would you say were Alex's greatest strengths?
User: He was one of the best engineers in our team.
Bot: How did Alex work with the team?
User: Fantastic, he was a complete team player.
Bot: Was Alex reliable with deadlines and commitments?
User: Very reliable, never missed a deadline.
Bot: Were there any areas where Alex could grow or improve?
User: He could be more vocal in meetings.
Bot: On a scale of 1 to 10, how strongly would you recommend?
User: I'd say a 9."""
        count = _count_questions_answered(transcript)
        assert count >= 5

    def test_empty_transcript(self):
        assert _count_questions_answered("") == 0

    def test_none_transcript(self):
        assert _count_questions_answered(None) == 0

    def test_questions_without_answers(self):
        transcript = "Bot: What would you say were Alex's greatest strengths?\nBot: Next question."
        assert _count_questions_answered(transcript) == 0

    def test_short_answer_not_counted(self):
        transcript = "Bot: What would you say were Alex's greatest strengths?\nUser: Ok."
        assert _count_questions_answered(transcript) == 0


class TestKeywordCheckIdentity:
    def test_affirmative_yes(self):
        transcript = "Bot: Am I speaking with Jordan Lee?\nUser: Yes, this is Jordan."
        assert _keyword_check_identity(transcript, "Jordan Lee") is True

    def test_affirmative_thats_me(self):
        transcript = "Bot: Am I speaking with Priya Sharma?\nUser: Yeah, that's me."
        assert _keyword_check_identity(transcript, "Priya Sharma") is True

    def test_affirmative_speaking(self):
        transcript = "Bot: Am I speaking with Michael Chen?\nUser: Yes, speaking."
        assert _keyword_check_identity(transcript, "Michael Chen") is True

    def test_negative_wrong_person(self):
        transcript = "Bot: Am I speaking with Jordan Lee?\nUser: No, wrong number."
        assert _keyword_check_identity(transcript, "Jordan Lee") is False

    def test_ambiguous_response(self):
        transcript = "Bot: Am I speaking with Jordan Lee?\nUser: Who is calling?"
        result = _keyword_check_identity(transcript, "Jordan Lee")
        assert result is _AMBIGUOUS

    def test_first_name_match(self):
        transcript = "Bot: Am I speaking with Jordan Lee?\nUser: Jordan here."
        assert _keyword_check_identity(transcript, "Jordan Lee") is True

    def test_empty_transcript(self):
        assert _keyword_check_identity("", "Jordan Lee") is False

    def test_empty_name(self):
        assert _keyword_check_identity("Bot: Am I speaking with?\nUser: Yes", "") is False

    def test_no_identity_question(self):
        transcript = "Bot: Hello, how are you?\nUser: Fine thanks."
        assert _keyword_check_identity(transcript, "Jordan Lee") is False


class TestKeywordCheckConsent:
    def test_affirmative_yes(self):
        transcript = "Bot: This call will be analyzed by AI. Is that okay with you?\nUser: Yes, go ahead."
        assert _keyword_check_consent(transcript) is True

    def test_affirmative_sure(self):
        transcript = "Bot: This call will be analyzed by AI. Is that okay with you?\nUser: Sure, no problem."
        assert _keyword_check_consent(transcript) is True

    def test_affirmative_no_problem(self):
        transcript = "Bot: analyzed by AI. Is that okay?\nUser: No problem at all."
        assert _keyword_check_consent(transcript) is True

    def test_negative_decline(self):
        transcript = "Bot: This call will be analyzed by AI. Is that okay with you?\nUser: No, I'd rather not."
        assert _keyword_check_consent(transcript) is False

    def test_negative_not_comfortable(self):
        transcript = "Bot: analyzed by AI. Is that okay?\nUser: I'm not comfortable with that."
        assert _keyword_check_consent(transcript) is False

    def test_ambiguous_response(self):
        transcript = "Bot: This call will be analyzed by AI. Is that okay with you?\nUser: What does that mean exactly?"
        result = _keyword_check_consent(transcript)
        assert result is _AMBIGUOUS

    def test_empty_transcript(self):
        assert _keyword_check_consent("") is False

    def test_no_consent_question(self):
        transcript = "Bot: Hello, how are you?\nUser: Fine thanks."
        assert _keyword_check_consent(transcript) is False


class TestQualityConstants:
    def test_valid_quality_statuses(self):
        expected = {"verified", "partial", "insufficient", "no_consent", "wrong_person"}
        assert VALID_QUALITY_STATUSES == expected

    def test_question_markers_count(self):
        assert len(QUESTION_MARKERS) == 6

    def test_consent_affirmative_includes_no_problem(self):
        assert "no problem" in CONSENT_AFFIRMATIVE

    def test_consent_negative_includes_prefer_not(self):
        assert "prefer not" in CONSENT_NEGATIVE

    def test_identity_affirmative_includes_speaking(self):
        assert "speaking" in IDENTITY_AFFIRMATIVE
