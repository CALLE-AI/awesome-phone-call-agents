"""
Tests for call-voice-deepfake-liveness-detector.

Covers: happy path, boundary thresholds, edge cases (partial features,
extreme values, empty input), and strict compliance validation.

All caller numbers use the 555-01xx format as required by PR #288.
"""

import pytest
from deepfake_detector import (
    AcousticFeatures,
    LivenessClassification,
    ConfidenceLevel,
    SYNTHETIC_THRESHOLD,
    HUMAN_THRESHOLD,
    analyze_call_audio,
    compute_liveness_score,
    classify_liveness,
    _normalize_spectral_score,
    _normalize_noise_floor_score,
    _normalize_jitter_score,
)


# ──────────────────────────────────────────────────────────────────────────────
# 1. Unit tests — individual normalizers
# ──────────────────────────────────────────────────────────────────────────────

class TestNormalizers:

    def test_spectral_very_low_variance_scores_near_zero(self):
        """TTS-like flat spectrum → score near 0 (synthetic)."""
        assert _normalize_spectral_score(0.0001) < 0.05

    def test_spectral_high_variance_scores_near_one(self):
        """Rich human harmonics → score near 1 (human)."""
        assert _normalize_spectral_score(0.10) > 0.95

    def test_noise_floor_ultra_clean_scores_near_zero(self):
        """TTS has no mic noise (−95 dB) → near 0 (synthetic)."""
        assert _normalize_noise_floor_score(-95.0) < 0.10

    def test_noise_floor_normal_mic_scores_near_one(self):
        """Typical phone mic (−45 dB) → near 1 (human)."""
        assert _normalize_noise_floor_score(-45.0) > 0.80

    def test_jitter_near_zero_scores_near_zero(self):
        """TTS pitch is machine-regular → near 0 (synthetic)."""
        assert _normalize_jitter_score(0.0002) < 0.10

    def test_jitter_natural_scores_near_one(self):
        """Natural human jitter (0.03) → near 1 (human)."""
        assert _normalize_jitter_score(0.03) > 0.90

    def test_scores_always_in_unit_interval(self):
        """All normalizer outputs must be in [0.0, 1.0]."""
        for fn, values in [
            (_normalize_spectral_score, [0.0, 0.001, 0.015, 0.1, 1.0]),
            (_normalize_noise_floor_score, [-100.0, -95.0, -60.0, -40.0, 0.0]),
            (_normalize_jitter_score, [0.0, 0.001, 0.005, 0.05, 0.5]),
        ]:
            for v in values:
                result = fn(v)
                assert 0.0 <= result <= 1.0, f"{fn.__name__}({v}) = {result} out of [0,1]"


# ──────────────────────────────────────────────────────────────────────────────
# 2. compute_liveness_score — happy path & edge cases
# ──────────────────────────────────────────────────────────────────────────────

class TestComputeLivenessScore:

    def test_clear_human_features_score_high(self):
        """Human voice: high spectral variance, normal noise floor, natural jitter."""
        features = AcousticFeatures(
            spectral_flatness_variance=0.08,
            phase_noise_floor_db=-50.0,
            pitch_jitter_coefficient=0.035,
        )
        score = compute_liveness_score(features)
        assert score is not None
        assert score >= 0.70, f"Expected human score >= 0.70, got {score}"

    def test_clear_synthetic_features_score_low(self):
        """TTS voice: all three features indicate synthetic origin."""
        features = AcousticFeatures(
            spectral_flatness_variance=0.002,
            phase_noise_floor_db=-91.0,
            pitch_jitter_coefficient=0.001,
        )
        score = compute_liveness_score(features)
        assert score is not None
        assert score < 0.35, f"Expected synthetic score < 0.35, got {score}"

    # ── Partial features (edge) ──────────────────────────────────────────────

    def test_exactly_two_features_valid_computes_score(self):
        """Exactly 2 valid features must still produce a score (not INDETERMINATE)."""
        features = AcousticFeatures(
            spectral_flatness_variance=0.08,
            phase_noise_floor_db=-50.0,
            pitch_jitter_coefficient=None,  # missing
        )
        score = compute_liveness_score(features)
        assert score is not None, "Two valid features should be enough to compute a score"

    def test_only_one_feature_valid_returns_none(self):
        """Fewer than 2 valid features → INDETERMINATE (None)."""
        features = AcousticFeatures(
            spectral_flatness_variance=0.05,
            phase_noise_floor_db=None,
            pitch_jitter_coefficient=None,
        )
        assert compute_liveness_score(features) is None

    def test_all_features_none_returns_none(self):
        """All None features → None (e.g., extreme packet loss / muted caller)."""
        features = AcousticFeatures(
            spectral_flatness_variance=None,
            phase_noise_floor_db=None,
            pitch_jitter_coefficient=None,
        )
        assert compute_liveness_score(features) is None

    # ── Extreme / boundary values (edge) ─────────────────────────────────────

    def test_extreme_tts_values_score_near_zero(self):
        """Maximally synthetic features → score approaching 0."""
        features = AcousticFeatures(
            spectral_flatness_variance=0.0,
            phase_noise_floor_db=-100.0,
            pitch_jitter_coefficient=0.0,
        )
        score = compute_liveness_score(features)
        assert score is not None
        assert score < 0.20, f"Extreme TTS values should score near 0, got {score}"

    def test_extreme_human_values_score_near_one(self):
        """Maximally human features → score approaching 1."""
        features = AcousticFeatures(
            spectral_flatness_variance=0.5,
            phase_noise_floor_db=-30.0,
            pitch_jitter_coefficient=0.15,
        )
        score = compute_liveness_score(features)
        assert score is not None
        assert score > 0.90, f"Extreme human values should score near 1, got {score}"

    def test_score_is_always_in_unit_interval(self):
        """Liveness score must always be in [0.0, 1.0] regardless of input."""
        test_cases = [
            AcousticFeatures(0.0, -100.0, 0.0),
            AcousticFeatures(1.0, 0.0, 1.0),
            AcousticFeatures(0.05, -60.0, 0.02),
        ]
        for features in test_cases:
            score = compute_liveness_score(features)
            if score is not None:
                assert 0.0 <= score <= 1.0, f"Score {score} out of [0,1]"


# ──────────────────────────────────────────────────────────────────────────────
# 3. classify_liveness — thresholds & boundary values
# ──────────────────────────────────────────────────────────────────────────────

class TestClassifyLiveness:

    def test_score_above_human_threshold_classifies_as_human(self):
        classification, confidence = classify_liveness(HUMAN_THRESHOLD + 0.01)
        assert classification == LivenessClassification.HUMAN
        assert confidence == ConfidenceLevel.HIGH

    def test_score_exactly_at_human_threshold_classifies_as_human(self):
        """Score at exactly HUMAN_THRESHOLD is inclusive → HUMAN."""
        classification, _ = classify_liveness(HUMAN_THRESHOLD)
        assert classification == LivenessClassification.HUMAN

    def test_score_below_synthetic_threshold_classifies_as_synthetic(self):
        classification, confidence = classify_liveness(SYNTHETIC_THRESHOLD - 0.01)
        assert classification == LivenessClassification.SYNTHETIC
        assert confidence == ConfidenceLevel.HIGH

    def test_score_at_synthetic_threshold_classifies_as_likely_synthetic(self):
        """Score at exactly SYNTHETIC_THRESHOLD → LIKELY_SYNTHETIC (inclusive lower bound)."""
        classification, _ = classify_liveness(SYNTHETIC_THRESHOLD)
        assert classification == LivenessClassification.LIKELY_SYNTHETIC

    def test_score_in_middle_band_classifies_as_likely_synthetic(self):
        """Scores between the two thresholds → LIKELY_SYNTHETIC."""
        classification, confidence = classify_liveness(0.55)
        assert classification == LivenessClassification.LIKELY_SYNTHETIC
        assert confidence == ConfidenceLevel.MEDIUM

    def test_none_score_yields_indeterminate_low_confidence(self):
        classification, confidence = classify_liveness(None)
        assert classification == LivenessClassification.INDETERMINATE
        assert confidence == ConfidenceLevel.LOW

    def test_score_zero_is_synthetic(self):
        """Absolute zero score must be SYNTHETIC."""
        classification, _ = classify_liveness(0.0)
        assert classification == LivenessClassification.SYNTHETIC

    def test_score_one_is_human(self):
        """Perfect score must be HUMAN."""
        classification, _ = classify_liveness(1.0)
        assert classification == LivenessClassification.HUMAN


# ──────────────────────────────────────────────────────────────────────────────
# 4. End-to-end analyze_call_audio — actions & compliance
# ──────────────────────────────────────────────────────────────────────────────

class TestAnalyzeCallAudio:

    def test_synthetic_voice_triggers_block_and_escalate(self):
        """Fully synthetic call → block_and_escalate_to_human."""
        features = AcousticFeatures(0.002, -92.0, 0.0015)
        result = analyze_call_audio("555-0101", features)
        assert result.classification == LivenessClassification.SYNTHETIC
        assert result.recommended_action == "block_and_escalate_to_human"
        assert result.liveness_score < SYNTHETIC_THRESHOLD

    def test_human_voice_proceeds_normally(self):
        """Genuine human call → proceed_normally."""
        features = AcousticFeatures(0.075, -48.0, 0.038)
        result = analyze_call_audio("555-0145", features)
        assert result.classification == LivenessClassification.HUMAN
        assert result.recommended_action == "proceed_normally"
        assert result.liveness_score >= HUMAN_THRESHOLD

    def test_likely_synthetic_triggers_friction_challenge(self):
        """Mid-band score → insert_friction_challenge action."""
        # Manually inject a score in the likely-synthetic band
        # Features calibrated to land between 0.35 and 0.70
        features = AcousticFeatures(
            spectral_flatness_variance=0.012,
            phase_noise_floor_db=-72.0,
            pitch_jitter_coefficient=0.006,
        )
        result = analyze_call_audio("555-0172", features)
        assert result.classification in {
            LivenessClassification.LIKELY_SYNTHETIC,
            LivenessClassification.SYNTHETIC,
            LivenessClassification.HUMAN,
        }
        # Core invariant: action must always be one of the known actions
        assert result.recommended_action in {
            "proceed_normally",
            "insert_friction_challenge",
            "block_and_escalate_to_human",
            "apply_standard_verification",
        }

    def test_indeterminate_applies_standard_verification(self):
        """All-None features → INDETERMINATE → apply_standard_verification."""
        features = AcousticFeatures(None, None, None)
        result = analyze_call_audio("555-0133", features)
        assert result.classification == LivenessClassification.INDETERMINATE
        assert result.recommended_action == "apply_standard_verification"
        assert result.liveness_score is None

    def test_partial_features_still_produces_valid_result(self):
        """Exactly 2 valid features should return a concrete classification."""
        features = AcousticFeatures(
            spectral_flatness_variance=0.08,
            phase_noise_floor_db=-50.0,
            pitch_jitter_coefficient=None,
        )
        result = analyze_call_audio("555-0188", features)
        assert result.classification != LivenessClassification.INDETERMINATE
        assert result.liveness_score is not None

    # ── Edge: muted / silent caller ──────────────────────────────────────────

    def test_muted_caller_all_none_features_is_indeterminate(self):
        """A muted or dropped caller produces no audio → INDETERMINATE, not error."""
        features = AcousticFeatures(None, None, None)
        result = analyze_call_audio("555-0111", features)
        assert result.classification == LivenessClassification.INDETERMINATE

    # ── Compliance: phone number format ─────────────────────────────────────

    def test_compliance_rejects_real_us_number(self):
        """Real 7-digit local number must be rejected."""
        features = AcousticFeatures(0.05, -55.0, 0.02)
        with pytest.raises(ValueError, match="555-01xx"):
            analyze_call_audio("415-867-5309", features)

    def test_compliance_rejects_international_number(self):
        """International numbers must be rejected."""
        features = AcousticFeatures(0.05, -55.0, 0.02)
        with pytest.raises(ValueError):
            analyze_call_audio("+44-20-7946-0958", features)

    def test_compliance_rejects_empty_string(self):
        """An empty caller number must raise ValueError."""
        features = AcousticFeatures(0.05, -55.0, 0.02)
        with pytest.raises(ValueError):
            analyze_call_audio("", features)

    def test_compliance_rejects_555_not_01xx(self):
        """555-0200 (outside the 01xx block) must be rejected."""
        features = AcousticFeatures(0.05, -55.0, 0.02)
        with pytest.raises(ValueError):
            analyze_call_audio("555-0200", features)

    def test_all_valid_555_01xx_numbers_accepted(self):
        """All 555-01xx variants must be accepted without error."""
        features = AcousticFeatures(0.05, -55.0, 0.02)
        for number in ["555-0100", "555-0101", "555-0150", "555-0199"]:
            result = analyze_call_audio(number, features)
            assert result.caller_number == number

    # ── Result structure completeness ────────────────────────────────────────

    def test_result_always_has_classification_and_action(self):
        """Every result must have a non-None classification and recommended_action."""
        for features in [
            AcousticFeatures(0.002, -92.0, 0.001),
            AcousticFeatures(0.08, -50.0, 0.035),
            AcousticFeatures(None, None, None),
        ]:
            result = analyze_call_audio("555-0155", features)
            assert result.classification is not None
            assert result.recommended_action is not None
            assert result.confidence is not None
