"""
Tests for call-voice-deepfake-liveness-detector.

All caller numbers strictly use the 555-01xx format as required by
repository compliance rules (PR #288).
"""

import pytest
from deepfake_detector import (
    AcousticFeatures,
    LivenessClassification,
    ConfidenceLevel,
    analyze_call_audio,
    compute_liveness_score,
    classify_liveness,
)


# ---------------------------------------------------------------------------
# Feature extraction & score computation tests
# ---------------------------------------------------------------------------

class TestComputeLivenessScore:

    def test_clear_human_features_score_high(self):
        """Human voice: high spectral variance, normal noise floor, natural jitter."""
        features = AcousticFeatures(
            spectral_flatness_variance=0.08,   # high = human-like
            phase_noise_floor_db=-50.0,        # normal microphone noise
            pitch_jitter_coefficient=0.035,    # natural human jitter
        )
        score = compute_liveness_score(features)
        assert score is not None
        assert score >= 0.70, f"Expected human score >= 0.70, got {score}"

    def test_clear_synthetic_features_score_low(self):
        """TTS voice: low spectral variance, ultra-clean audio, near-zero jitter."""
        features = AcousticFeatures(
            spectral_flatness_variance=0.002,  # very low = TTS-like
            phase_noise_floor_db=-91.0,        # unnaturally clean = TTS
            pitch_jitter_coefficient=0.001,    # too regular = TTS
        )
        score = compute_liveness_score(features)
        assert score is not None
        assert score < 0.35, f"Expected synthetic score < 0.35, got {score}"

    def test_indeterminate_with_only_one_feature(self):
        """Fewer than 2 valid features → INDETERMINATE (None)."""
        features = AcousticFeatures(
            spectral_flatness_variance=0.05,
            phase_noise_floor_db=None,
            pitch_jitter_coefficient=None,
        )
        score = compute_liveness_score(features)
        assert score is None

    def test_indeterminate_with_all_none_features(self):
        """All features None (e.g., extreme packet loss) → None."""
        features = AcousticFeatures(
            spectral_flatness_variance=None,
            phase_noise_floor_db=None,
            pitch_jitter_coefficient=None,
        )
        score = compute_liveness_score(features)
        assert score is None


# ---------------------------------------------------------------------------
# Classification tests
# ---------------------------------------------------------------------------

class TestClassifyLiveness:

    def test_high_score_classifies_as_human(self):
        classification, confidence = classify_liveness(0.85)
        assert classification == LivenessClassification.HUMAN
        assert confidence == ConfidenceLevel.HIGH

    def test_mid_score_classifies_as_likely_synthetic(self):
        classification, confidence = classify_liveness(0.50)
        assert classification == LivenessClassification.LIKELY_SYNTHETIC
        assert confidence == ConfidenceLevel.MEDIUM

    def test_low_score_classifies_as_synthetic(self):
        classification, confidence = classify_liveness(0.20)
        assert classification == LivenessClassification.SYNTHETIC
        assert confidence == ConfidenceLevel.HIGH

    def test_none_score_classifies_as_indeterminate(self):
        classification, confidence = classify_liveness(None)
        assert classification == LivenessClassification.INDETERMINATE
        assert confidence == ConfidenceLevel.LOW


# ---------------------------------------------------------------------------
# End-to-end analyze_call_audio tests
# ---------------------------------------------------------------------------

class TestAnalyzeCallAudio:

    def test_synthetic_voice_triggers_block_and_escalate(self):
        """Fully synthetic call should produce block_and_escalate_to_human action."""
        features = AcousticFeatures(
            spectral_flatness_variance=0.002,
            phase_noise_floor_db=-92.0,
            pitch_jitter_coefficient=0.0015,
        )
        result = analyze_call_audio("555-0101", features)
        assert result.classification == LivenessClassification.SYNTHETIC
        assert result.recommended_action == "block_and_escalate_to_human"
        assert result.liveness_score is not None
        assert result.liveness_score < 0.35

    def test_human_voice_proceeds_normally(self):
        """Genuine human call should produce proceed_normally action."""
        features = AcousticFeatures(
            spectral_flatness_variance=0.075,
            phase_noise_floor_db=-48.0,
            pitch_jitter_coefficient=0.038,
        )
        result = analyze_call_audio("555-0145", features)
        assert result.classification == LivenessClassification.HUMAN
        assert result.recommended_action == "proceed_normally"
        assert result.liveness_score >= 0.70

    def test_indeterminate_applies_standard_verification(self):
        """Poor audio quality → INDETERMINATE → standard_verification fallback."""
        features = AcousticFeatures(
            spectral_flatness_variance=None,
            phase_noise_floor_db=None,
            pitch_jitter_coefficient=None,
        )
        result = analyze_call_audio("555-0133", features)
        assert result.classification == LivenessClassification.INDETERMINATE
        assert result.recommended_action == "apply_standard_verification"
        assert result.liveness_score is None

    def test_compliance_rejects_real_phone_numbers(self):
        """Real phone numbers must raise ValueError to protect PII compliance."""
        features = AcousticFeatures(
            spectral_flatness_variance=0.05,
            phase_noise_floor_db=-55.0,
            pitch_jitter_coefficient=0.02,
        )
        with pytest.raises(ValueError, match="555-01xx"):
            analyze_call_audio("415-867-5309", features)

    def test_compliance_rejects_international_numbers(self):
        """International format numbers must also be rejected."""
        features = AcousticFeatures(
            spectral_flatness_variance=0.05,
            phase_noise_floor_db=-55.0,
            pitch_jitter_coefficient=0.02,
        )
        with pytest.raises(ValueError):
            analyze_call_audio("+44-20-7946-0958", features)

    def test_valid_test_numbers_are_accepted(self):
        """All 555-01xx numbers must be accepted without error."""
        features = AcousticFeatures(
            spectral_flatness_variance=0.05,
            phase_noise_floor_db=-55.0,
            pitch_jitter_coefficient=0.02,
        )
        for number in ["555-0100", "555-0101", "555-0150", "555-0199"]:
            result = analyze_call_audio(number, features)
            assert result.caller_number == number
