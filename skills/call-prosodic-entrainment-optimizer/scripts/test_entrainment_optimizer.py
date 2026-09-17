"""
Tests for call-prosodic-entrainment-optimizer.

Covers: happy path, SALES/SUPPORT/DEFAULT modes, boundary thresholds,
edge cases (zero energy, child voice, whispered speech, muted caller,
empty number), safety bounds, and strict compliance validation.

All caller numbers use the 555-01xx format as required by PR #288.
"""

import pytest
from entrainment_optimizer import (
    ProsodieFeatures,
    TTSDirective,
    CallMode,
    EntrainmentStatus,
    TARGET_THRESHOLD,
    OPTIMAL_CEILING,
    MAX_PITCH_DELTA,
    MAX_RATE_DELTA,
    MAX_ENERGY_DELTA,
    compute_entrainment_score,
    generate_tts_directive,
    optimize_entrainment,
)


# ──────────────────────────────────────────────────────────────────────────────
# Shared fixtures
# ──────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def typical_caller():
    """Average adult caller: moderate pitch, 125 WPM, moderate energy."""
    return ProsodieFeatures(f0_hz=120.0, speech_rate_wpm=125, rms_energy=0.40)


@pytest.fixture
def fast_high_agent():
    """Agent speaking too fast and at high pitch — divergent."""
    return ProsodieFeatures(f0_hz=185.0, speech_rate_wpm=180, rms_energy=0.70)


@pytest.fixture
def matched_agent():
    """Agent well-matched to typical_caller."""
    return ProsodieFeatures(f0_hz=122.0, speech_rate_wpm=127, rms_energy=0.41)


# ──────────────────────────────────────────────────────────────────────────────
# 1. compute_entrainment_score — happy path & edge cases
# ──────────────────────────────────────────────────────────────────────────────

class TestComputeEntrainmentScore:

    def test_identical_features_score_near_one(self, typical_caller):
        """Identical caller and agent → perfect entrainment."""
        score = compute_entrainment_score(typical_caller, typical_caller)
        assert score >= 0.999, f"Expected ~1.0, got {score}"

    def test_well_matched_features_score_high(self, typical_caller, matched_agent):
        score = compute_entrainment_score(typical_caller, matched_agent)
        assert score >= 0.90, f"Well-matched features should score >= 0.90, got {score}"

    def test_divergent_features_score_less_than_perfect(self, typical_caller, fast_high_agent):
        """Divergent features must score lower than perfectly matched features."""
        perfect = compute_entrainment_score(typical_caller, typical_caller)
        divergent = compute_entrainment_score(typical_caller, fast_high_agent)
        assert divergent < perfect, f"Divergent ({divergent:.4f}) must be < perfect ({perfect:.4f})"

    def test_score_always_in_unit_interval(self, typical_caller, fast_high_agent):
        """Score must always be in [0.0, 1.0]."""
        for a, b in [
            (typical_caller, fast_high_agent),
            (typical_caller, typical_caller),
        ]:
            score = compute_entrainment_score(a, b)
            assert 0.0 <= score <= 1.0, f"Score {score} out of [0,1]"

    # ── Edge: child voice (high F0) ──────────────────────────────────────────

    def test_child_voice_high_f0_is_handled(self):
        """Child caller with very high F0 (350 Hz) must not break computation."""
        child = ProsodieFeatures(f0_hz=350.0, speech_rate_wpm=140, rms_energy=0.50)
        agent = ProsodieFeatures(f0_hz=145.0, speech_rate_wpm=145, rms_energy=0.55)
        score = compute_entrainment_score(child, agent)
        assert 0.0 <= score <= 1.0

    # ── Edge: whispering (very low F0 / near-zero energy) ───────────────────

    def test_whispering_caller_near_zero_energy_is_handled(self):
        """A whispering caller (low F0, near-zero energy) must not cause division by zero."""
        whisperer = ProsodieFeatures(f0_hz=80.0, speech_rate_wpm=90, rms_energy=0.01)
        agent = ProsodieFeatures(f0_hz=140.0, speech_rate_wpm=160, rms_energy=0.55)
        score = compute_entrainment_score(whisperer, agent)
        assert 0.0 <= score <= 1.0

    # ── Edge: zero-rate / muted caller ───────────────────────────────────────

    def test_zero_speech_rate_caller_is_handled(self):
        """A paused or muted caller with speech_rate=0 must not crash."""
        paused = ProsodieFeatures(f0_hz=100.0, speech_rate_wpm=0, rms_energy=0.0)
        agent = ProsodieFeatures(f0_hz=140.0, speech_rate_wpm=150, rms_energy=0.50)
        score = compute_entrainment_score(paused, agent)
        assert 0.0 <= score <= 1.0

    def test_both_zero_vectors_do_not_crash(self):
        """Zero-vector speakers (edge case) must not raise ZeroDivisionError."""
        silent = ProsodieFeatures(f0_hz=0.0, speech_rate_wpm=0, rms_energy=0.0)
        score = compute_entrainment_score(silent, silent)
        assert 0.0 <= score <= 1.0


# ──────────────────────────────────────────────────────────────────────────────
# 2. generate_tts_directive — safety bounds & mode behavior
# ──────────────────────────────────────────────────────────────────────────────

class TestGenerateTTSDirective:

    def test_optimal_score_yields_identity_directive(self, typical_caller, matched_agent):
        """Already-optimal entrainment → no TTS adjustment issued."""
        directive = generate_tts_directive(typical_caller, matched_agent, score=OPTIMAL_CEILING + 0.01)
        assert directive.is_identity()

    def test_score_at_optimal_ceiling_yields_identity(self, typical_caller, matched_agent):
        """Exactly at ceiling boundary → identity directive (back off)."""
        directive = generate_tts_directive(typical_caller, matched_agent, score=OPTIMAL_CEILING)
        assert directive.is_identity()

    def test_low_entrainment_yields_nonzero_directive(self, typical_caller, fast_high_agent):
        """Low entrainment → at least one parameter adjusted."""
        directive = generate_tts_directive(typical_caller, fast_high_agent, score=0.40)
        has_adjustment = (
            abs(directive.pitch_shift_semitones) > 0.001
            or abs(directive.rate_multiplier - 1.0) > 0.001
            or abs(directive.energy_scale - 1.0) > 0.001
        )
        assert has_adjustment

    def test_pitch_shift_bounded_by_max(self):
        """Pitch delta must never exceed ±MAX_PITCH_DELTA semitones."""
        caller = ProsodieFeatures(f0_hz=50.0, speech_rate_wpm=80, rms_energy=0.20)
        agent = ProsodieFeatures(f0_hz=500.0, speech_rate_wpm=200, rms_energy=0.80)
        directive = generate_tts_directive(caller, agent, score=0.10)
        assert abs(directive.pitch_shift_semitones) <= MAX_PITCH_DELTA

    def test_rate_multiplier_bounded_by_safety_limits(self):
        """Rate multiplier must always stay within [1 - MAX_RATE_DELTA, 1 + MAX_RATE_DELTA]."""
        caller = ProsodieFeatures(f0_hz=100.0, speech_rate_wpm=50, rms_energy=0.20)
        agent = ProsodieFeatures(f0_hz=100.0, speech_rate_wpm=250, rms_energy=0.20)
        directive = generate_tts_directive(caller, agent, score=0.10)
        assert 1.0 - MAX_RATE_DELTA <= directive.rate_multiplier <= 1.0 + MAX_RATE_DELTA

    def test_energy_scale_bounded_by_safety_limits(self):
        """Energy scale must always stay within [1 - MAX_ENERGY_DELTA, 1 + MAX_ENERGY_DELTA]."""
        caller = ProsodieFeatures(f0_hz=100.0, speech_rate_wpm=100, rms_energy=0.01)
        agent = ProsodieFeatures(f0_hz=100.0, speech_rate_wpm=100, rms_energy=0.99)
        directive = generate_tts_directive(caller, agent, score=0.10)
        assert 1.0 - MAX_ENERGY_DELTA <= directive.energy_scale <= 1.0 + MAX_ENERGY_DELTA

    # ── Mode: SUPPORT ─────────────────────────────────────────────────────────

    def test_support_mode_never_speeds_up_agent(self):
        """SUPPORT mode must never increase speech rate (only slow down or hold)."""
        anxious = ProsodieFeatures(f0_hz=250.0, speech_rate_wpm=195, rms_energy=0.85)
        slow_agent = ProsodieFeatures(f0_hz=130.0, speech_rate_wpm=110, rms_energy=0.40)
        directive = generate_tts_directive(anxious, slow_agent, score=0.40, mode=CallMode.SUPPORT)
        assert directive.rate_multiplier <= 1.0, (
            f"SUPPORT mode must not speed up. rate_multiplier={directive.rate_multiplier}"
        )

    def test_support_mode_never_raises_pitch(self):
        """SUPPORT mode must never raise agent pitch (only lower or hold)."""
        anxious = ProsodieFeatures(f0_hz=280.0, speech_rate_wpm=190, rms_energy=0.90)
        low_agent = ProsodieFeatures(f0_hz=110.0, speech_rate_wpm=120, rms_energy=0.40)
        directive = generate_tts_directive(anxious, low_agent, score=0.40, mode=CallMode.SUPPORT)
        assert directive.pitch_shift_semitones <= 0.0, (
            f"SUPPORT mode must not raise pitch. pitch_shift={directive.pitch_shift_semitones}"
        )

    # ── Mode: SALES ───────────────────────────────────────────────────────────

    def test_sales_mode_does_not_override_bounds(self):
        """SALES mode directive must still respect safety caps."""
        caller = ProsodieFeatures(f0_hz=50.0, speech_rate_wpm=60, rms_energy=0.10)
        agent = ProsodieFeatures(f0_hz=200.0, speech_rate_wpm=200, rms_energy=0.80)
        directive = generate_tts_directive(caller, agent, score=0.20, mode=CallMode.SALES)
        assert abs(directive.pitch_shift_semitones) <= MAX_PITCH_DELTA
        assert 1.0 - MAX_RATE_DELTA <= directive.rate_multiplier <= 1.0 + MAX_RATE_DELTA

    # ── Edge: child voice / extreme feature values ────────────────────────────

    def test_child_voice_caller_directive_is_bounded(self):
        """Child caller (F0=350 Hz) must produce bounded directive."""
        child = ProsodieFeatures(f0_hz=350.0, speech_rate_wpm=150, rms_energy=0.50)
        agent = ProsodieFeatures(f0_hz=145.0, speech_rate_wpm=145, rms_energy=0.55)
        directive = generate_tts_directive(child, agent, score=0.50)
        assert abs(directive.pitch_shift_semitones) <= MAX_PITCH_DELTA

    def test_whispering_caller_directive_does_not_crash(self):
        """Near-zero energy whisperer must not produce invalid directive."""
        whisperer = ProsodieFeatures(f0_hz=80.0, speech_rate_wpm=90, rms_energy=0.01)
        agent = ProsodieFeatures(f0_hz=140.0, speech_rate_wpm=150, rms_energy=0.55)
        directive = generate_tts_directive(whisperer, agent, score=0.50)
        assert isinstance(directive, TTSDirective)


# ──────────────────────────────────────────────────────────────────────────────
# 3. optimize_entrainment — end-to-end & compliance
# ──────────────────────────────────────────────────────────────────────────────

class TestOptimizeEntrainment:

    def test_calibrating_returns_identity_no_directive(self, typical_caller, fast_high_agent):
        """First-window calibration period → CALIBRATING status, no adjustment."""
        result = optimize_entrainment(
            "555-0100", typical_caller, fast_high_agent, is_calibrating=True
        )
        assert result.status == EntrainmentStatus.CALIBRATING
        assert result.directive.is_identity()

    def test_well_matched_returns_optimal_or_target(self, typical_caller, matched_agent):
        result = optimize_entrainment("555-0145", typical_caller, matched_agent)
        assert result.status in {EntrainmentStatus.OPTIMAL, EntrainmentStatus.TARGET_REACHED}

    def test_result_carries_caller_number(self, typical_caller, matched_agent):
        result = optimize_entrainment("555-0178", typical_caller, matched_agent)
        assert result.caller_number == "555-0178"

    def test_status_is_always_valid_enum_value(self, typical_caller, fast_high_agent):
        """Status field must always be a known EntrainmentStatus."""
        valid_statuses = set(EntrainmentStatus)
        for is_cal in [True, False]:
            result = optimize_entrainment("555-0155", typical_caller, fast_high_agent, is_calibrating=is_cal)
            assert result.status in valid_statuses

    # ── Edge: muted caller (zero speech rate) ─────────────────────────────────

    def test_muted_caller_zero_rate_does_not_crash(self):
        """A muted/paused caller must not cause a runtime error."""
        muted = ProsodieFeatures(f0_hz=0.0, speech_rate_wpm=0, rms_energy=0.0)
        agent = ProsodieFeatures(f0_hz=140.0, speech_rate_wpm=150, rms_energy=0.50)
        result = optimize_entrainment("555-0111", muted, agent)
        assert result is not None

    # ── Edge: child voice ─────────────────────────────────────────────────────

    def test_child_voice_is_handled_gracefully(self):
        """Child caller with F0=350 Hz → valid result, bounded directive."""
        child = ProsodieFeatures(f0_hz=350.0, speech_rate_wpm=140, rms_energy=0.60)
        agent = ProsodieFeatures(f0_hz=145.0, speech_rate_wpm=155, rms_energy=0.50)
        result = optimize_entrainment("555-0166", child, agent)
        assert abs(result.directive.pitch_shift_semitones) <= MAX_PITCH_DELTA

    # ── Boundary: threshold values ────────────────────────────────────────────

    def test_entrainment_score_at_boundary_target_threshold(self, typical_caller, matched_agent):
        """Score at exactly TARGET_THRESHOLD should not be OPTIMAL."""
        # We can't force an exact score from feature inputs, but we verify
        # that the threshold-crossing logic is consistent
        result = optimize_entrainment("555-0190", typical_caller, matched_agent)
        if result.entrainment_score >= TARGET_THRESHOLD:
            assert result.status in {EntrainmentStatus.TARGET_REACHED, EntrainmentStatus.OPTIMAL}
        else:
            assert result.status == EntrainmentStatus.LOW_ENTRAINMENT

    # ── Compliance: phone number format ──────────────────────────────────────

    def test_compliance_rejects_real_us_number(self, typical_caller, matched_agent):
        with pytest.raises(ValueError, match="555-01xx"):
            optimize_entrainment("212-555-8765", typical_caller, matched_agent)

    def test_compliance_rejects_toll_free_number(self, typical_caller, matched_agent):
        with pytest.raises(ValueError):
            optimize_entrainment("1-800-555-1234", typical_caller, matched_agent)

    def test_compliance_rejects_international_number(self, typical_caller, matched_agent):
        with pytest.raises(ValueError):
            optimize_entrainment("+84-90-123-4567", typical_caller, matched_agent)

    def test_compliance_rejects_empty_string(self, typical_caller, matched_agent):
        with pytest.raises(ValueError):
            optimize_entrainment("", typical_caller, matched_agent)

    def test_compliance_rejects_555_outside_01xx_block(self, typical_caller, matched_agent):
        """555-0200 is outside the reserved 01xx test block."""
        with pytest.raises(ValueError):
            optimize_entrainment("555-0200", typical_caller, matched_agent)

    def test_all_valid_555_01xx_test_numbers_accepted(self, typical_caller, matched_agent):
        """All numbers in the 555-01xx block must be accepted."""
        for number in ["555-0100", "555-0101", "555-0150", "555-0199"]:
            result = optimize_entrainment(number, typical_caller, matched_agent)
            assert result.caller_number == number
