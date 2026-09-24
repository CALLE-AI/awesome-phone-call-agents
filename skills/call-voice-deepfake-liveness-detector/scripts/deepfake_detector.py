"""
call-voice-deepfake-liveness-detector
Core acoustic liveness analysis engine.

Offline experimental scoring of supplied numeric acoustic features.
Returns illustrative review labels; no audio extraction, identity verification,
call blocking, or benchmark validation is implemented here.

Scientific basis:
  - ASVspoof 2021 (IEEE/ACM TASLP 2023): DOI 10.1109/TASLP.2023.3285283
  - ADD 2022 Challenge (ICASSP 2022): DOI 10.1109/ICASSP43922.2022.9746939
"""

import math
import statistics
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class LivenessClassification(str, Enum):
    HUMAN = "HUMAN"
    LIKELY_SYNTHETIC = "LIKELY_SYNTHETIC"
    SYNTHETIC = "SYNTHETIC"
    INDETERMINATE = "INDETERMINATE"


class ConfidenceLevel(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


@dataclass
class AcousticFeatures:
    """
    Acoustic feature vector extracted from a 500ms audio segment.
    These features are derived from the ASVspoof literature to discriminate
    between genuine and AI-synthesized speech.
    """
    spectral_flatness_variance: Optional[float]  # Low in TTS (too smooth)
    phase_noise_floor_db: Optional[float]        # High (less negative) in TTS (no mic noise)
    pitch_jitter_coefficient: Optional[float]    # Low in TTS (too regular)


@dataclass
class LivenessResult:
    caller_number: str
    features: AcousticFeatures
    liveness_score: Optional[float]
    classification: LivenessClassification
    confidence: ConfidenceLevel
    recommended_action: str


# Illustrative thresholds, not validated against ASVspoof or NIST benchmarks
SYNTHETIC_THRESHOLD = 0.35          # Below this → flag as synthetic
HUMAN_THRESHOLD = 0.70              # Above this → confident human
MIN_QUALITY_NOISE_DB = -80.0        # Below this noise floor → audio too clean, suspicious
JITTER_SYNTHETIC_MAX = 0.005        # TTS jitter is typically below this value
FLATNESS_SYNTHETIC_MAX = 0.015      # TTS spectral flatness variance is typically below this


def _normalize_spectral_score(variance: float) -> float:
    """
    Map spectral flatness variance to a [0, 1] score.
    Low variance (TTS-like) → score near 0.
    High variance (human-like) → score near 1.
    """
    # Sigmoid-style normalization: threshold around 0.015
    return 1.0 / (1.0 + math.exp(-200 * (variance - FLATNESS_SYNTHETIC_MAX)))


def _normalize_noise_floor_score(noise_db: float) -> float:
    """
    Map phase noise floor (in dB) to a [0, 1] score.
    Very clean audio (large negative dB like -90) is suspicious (TTS).
    Normal microphone noise (e.g., -50 dB) is human-like.
    """
    # Noise floor: human mic typically -40 to -60 dB; clean TTS: -80 to -95 dB
    # Map: -95 dB → ~0.0 (synthetic), -40 dB → ~1.0 (human)
    normalized = (noise_db - (-95.0)) / ((-40.0) - (-95.0))
    return max(0.0, min(1.0, normalized))


def _normalize_jitter_score(jitter: float) -> float:
    """
    Map pitch jitter coefficient to a [0, 1] score.
    Very low jitter (TTS) → score near 0.
    Normal human jitter (> 0.005) → score near 1.
    """
    return 1.0 / (1.0 + math.exp(-600 * (jitter - JITTER_SYNTHETIC_MAX)))


def compute_liveness_score(features: AcousticFeatures) -> Optional[float]:
    """
    Aggregates the three acoustic sub-scores into a single liveness score.
    Requires at least 2 valid features; otherwise returns None (INDETERMINATE).
    """
    scores = []

    if features.spectral_flatness_variance is not None:
        scores.append(_normalize_spectral_score(features.spectral_flatness_variance))
    if features.phase_noise_floor_db is not None:
        scores.append(_normalize_noise_floor_score(features.phase_noise_floor_db))
    if features.pitch_jitter_coefficient is not None:
        scores.append(_normalize_jitter_score(features.pitch_jitter_coefficient))

    if len(scores) < 2:
        return None  # Insufficient data → INDETERMINATE

    return statistics.mean(scores)


def classify_liveness(score: Optional[float]) -> tuple[LivenessClassification, ConfidenceLevel]:
    """Classify the liveness score into a human-readable decision."""
    if score is None:
        return LivenessClassification.INDETERMINATE, ConfidenceLevel.LOW
    if score >= HUMAN_THRESHOLD:
        return LivenessClassification.HUMAN, ConfidenceLevel.HIGH
    if score >= SYNTHETIC_THRESHOLD:
        return LivenessClassification.LIKELY_SYNTHETIC, ConfidenceLevel.MEDIUM
    return LivenessClassification.SYNTHETIC, ConfidenceLevel.HIGH


def get_recommended_action(classification: LivenessClassification) -> str:
    actions = {
        LivenessClassification.HUMAN: "proceed_normally",
        LivenessClassification.LIKELY_SYNTHETIC: "insert_friction_challenge",
        LivenessClassification.SYNTHETIC: "block_and_escalate_to_human",
        LivenessClassification.INDETERMINATE: "apply_standard_verification",
    }
    return actions[classification]


def analyze_call_audio(caller_number: str, features: AcousticFeatures) -> LivenessResult:
    """
    Main entry point for the skill. Analyzes acoustic features and returns
    a structured liveness assessment with recommended agent action.

    Args:
        caller_number: The inbound caller's phone number. Must be in 555-01xx
                       format for all test and demonstration invocations.
        features: AcousticFeatures extracted from the 500ms audio segment.

    Returns:
        LivenessResult containing liveness_score, classification, and action.

    Raises:
        ValueError: If caller_number does not conform to the 555-01xx test format
                    during non-production invocations.
    """
    if not caller_number.startswith("555-01"):
        raise ValueError(
            f"Compliance violation: caller_number '{caller_number}' must use the "
            "555-01xx test number format. Real phone numbers are prohibited in "
            "skill tests and demonstrations (per repository rule PR #288)."
        )

    score = compute_liveness_score(features)
    classification, confidence = classify_liveness(score)
    action = get_recommended_action(classification)

    return LivenessResult(
        caller_number=caller_number,
        features=features,
        liveness_score=round(score, 4) if score is not None else None,
        classification=classification,
        confidence=confidence,
        recommended_action=action,
    )
