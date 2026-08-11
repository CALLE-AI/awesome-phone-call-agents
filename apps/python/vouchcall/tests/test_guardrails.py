"""Credential-free unit tests for guardrails, validation, and masking.

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
    VALID_RECOMMENDATIONS,
    VALID_HIRE_RECOMMENDATIONS,
    VALID_SEVERITIES,
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
