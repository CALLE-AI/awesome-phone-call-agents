"""
call-prosodic-entrainment-optimizer
Offline experimental feature comparison and TTS directive suggestion.

Computes cosine similarity between caller and agent prosodic feature vectors,
and generates TTS parameter deltas to converge agent speech toward the caller's
prosodic style. No audio, TTS, timing, logging, or outcome evaluation is included.

Scientific basis:
  - Communication Accommodation Theory (Giles et al., 2023): DOI 10.1016/j.langsci.2023.101571
  - Modeling Vocal Entrainment via Deep Unsupervised Learning (Nasir et al., IEEE TAFFC 2022):
    DOI 10.1109/TAFFC.2020.3024972
  - Context-Aware Entrainment Measurement (Lahiri et al., arXiv 2022):
    DOI 10.48550/arXiv.2211.03279
"""

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class CallMode(str, Enum):
    SALES = "SALES"
    SUPPORT = "SUPPORT"
    DEFAULT = "DEFAULT"


class EntrainmentStatus(str, Enum):
    OPTIMAL = "OPTIMAL"          # >= 0.90: back off, no change needed
    TARGET_REACHED = "TARGET_REACHED"  # >= 0.75: minor monitoring only
    LOW_ENTRAINMENT = "LOW_ENTRAINMENT"  # < 0.75: apply directive
    CALIBRATING = "CALIBRATING"  # < 5s window: not enough data yet


@dataclass
class ProsodieFeatures:
    """
    Prosodic feature vector for a single speaker, extracted from a 1-second window.
    F0 in Hz, speech_rate in words per minute, rms_energy as normalized float.
    """
    f0_hz: float           # Fundamental frequency (pitch)
    speech_rate_wpm: float  # Speech rate in words per minute
    rms_energy: float      # Normalized RMS energy [0.0, 1.0]


@dataclass
class TTSDirective:
    """
    Parameter deltas to inject into the TTS synthesis engine to adjust agent voice.
    Bounded by safety limits defined in references/safety.md.
    """
    pitch_shift_semitones: float = 0.0   # Max ±3.0 per window
    rate_multiplier: float = 1.0          # Range [0.80, 1.20]
    energy_scale: float = 1.0             # Range [0.70, 1.30]

    def is_identity(self) -> bool:
        """Returns True if no adjustment is needed."""
        return (
            abs(self.pitch_shift_semitones) < 0.05
            and abs(self.rate_multiplier - 1.0) < 0.01
            and abs(self.energy_scale - 1.0) < 0.01
        )


@dataclass
class EntrainmentResult:
    caller_number: str
    caller_features: ProsodieFeatures
    agent_features: ProsodieFeatures
    entrainment_score: float
    status: EntrainmentStatus
    directive: TTSDirective


# Tunable thresholds
TARGET_THRESHOLD = 0.75   # Below this → issue directive
OPTIMAL_CEILING = 0.90    # Above this → back off (no directive)
MAX_PITCH_DELTA = 3.0     # Semitones per window (safety cap)
MAX_RATE_DELTA = 0.20     # ±20% rate adjustment cap
MAX_ENERGY_DELTA = 0.30   # ±30% energy adjustment cap

# Hz per semitone conversion at reference A4=440Hz
HZ_PER_SEMITONE_AT_REFERENCE = 440.0 * (2 ** (1 / 12) - 1)  # ~26.2 Hz


def _normalize_vector(v: list[float]) -> list[float]:
    """L2-normalize a feature vector for cosine similarity."""
    magnitude = math.sqrt(sum(x ** 2 for x in v))
    if magnitude < 1e-9:
        return [0.0] * len(v)
    return [x / magnitude for x in v]


def compute_entrainment_score(
    caller: ProsodieFeatures,
    agent: ProsodieFeatures,
) -> float:
    """
    Computes cosine similarity between caller and agent prosodic feature vectors.
    Returns a score in [0.0, 1.0] where 1.0 = perfect entrainment.

    Feature normalization scales each dimension to a comparable range before
    cosine similarity to prevent any single feature from dominating.
    """
    # Scale factors to bring features to similar numeric ranges
    F0_SCALE = 1 / 300.0        # F0 typically 80–300 Hz
    RATE_SCALE = 1 / 200.0      # Rate typically 80–200 WPM
    ENERGY_SCALE = 1.0          # Already normalized [0, 1]

    caller_vec = [
        caller.f0_hz * F0_SCALE,
        caller.speech_rate_wpm * RATE_SCALE,
        caller.rms_energy * ENERGY_SCALE,
    ]
    agent_vec = [
        agent.f0_hz * F0_SCALE,
        agent.speech_rate_wpm * RATE_SCALE,
        agent.rms_energy * ENERGY_SCALE,
    ]

    c_norm = _normalize_vector(caller_vec)
    a_norm = _normalize_vector(agent_vec)

    dot = sum(c * a for c, a in zip(c_norm, a_norm))
    # Cosine similarity for non-negative vectors is in [0, 1]
    return max(0.0, min(1.0, dot))


def generate_tts_directive(
    caller: ProsodieFeatures,
    agent: ProsodieFeatures,
    score: float,
    mode: CallMode = CallMode.DEFAULT,
) -> TTSDirective:
    """
    Generates bounded TTS parameter deltas to converge agent speech toward caller.
    Uses a fixed 0.05 interpolation factor and independent parameter caps.
    This does not enforce a 5% output cap or an elapsed-time window.
    """
    if score >= OPTIMAL_CEILING:
        return TTSDirective()  # No adjustment: already at optimal entrainment

    # Compute deltas proportional to the divergence, capped by safety limits
    step_factor = 0.05  # interpolation factor; host controls invocation timing

    # Pitch: convert Hz delta to semitones
    f0_delta_hz = caller.f0_hz - agent.f0_hz
    semitone_delta = f0_delta_hz / HZ_PER_SEMITONE_AT_REFERENCE
    pitch_shift = max(-MAX_PITCH_DELTA, min(MAX_PITCH_DELTA, semitone_delta * step_factor))

    # Rate: compute multiplier delta
    rate_ratio = caller.speech_rate_wpm / max(agent.speech_rate_wpm, 1.0)
    rate_mult = 1.0 + max(-MAX_RATE_DELTA, min(MAX_RATE_DELTA, (rate_ratio - 1.0) * step_factor))

    # Energy scale
    energy_ratio = caller.rms_energy / max(agent.rms_energy, 0.01)
    energy_s = max(1.0 - MAX_ENERGY_DELTA, min(1.0 + MAX_ENERGY_DELTA, energy_ratio * step_factor + (1.0 - step_factor)))

    # SUPPORT mode: force downward adjustments regardless of caller's level
    if mode == CallMode.SUPPORT:
        pitch_shift = min(pitch_shift, 0.0)       # only lower pitch
        rate_mult = min(rate_mult, 1.0)            # only slow down
        energy_s = min(energy_s, 1.0)             # only soften

    return TTSDirective(
        pitch_shift_semitones=round(pitch_shift, 3),
        rate_multiplier=round(rate_mult, 4),
        energy_scale=round(energy_s, 4),
    )


def optimize_entrainment(
    caller_number: str,
    caller: ProsodieFeatures,
    agent: ProsodieFeatures,
    mode: CallMode = CallMode.DEFAULT,
    is_calibrating: bool = False,
) -> EntrainmentResult:
    """
    Main entry point for the skill. Computes entrainment score and issues
    a TTSDirective to optimize agent speech convergence toward caller.

    Args:
        caller_number: Must be in 555-01xx format for all test and demo invocations.
        caller: Prosodic features extracted from the caller's audio.
        agent: Current prosodic features of the agent's TTS output.
        mode: CallMode preset (SALES, SUPPORT, DEFAULT).
        is_calibrating: Host-controlled flag suppressing adjustments; no timer here.

    Returns:
        EntrainmentResult containing score, status, and TTSDirective.

    Raises:
        ValueError: If caller_number does not conform to the 555-01xx test format.
    """
    if not caller_number.startswith("555-01"):
        raise ValueError(
            f"Compliance violation: caller_number '{caller_number}' must use the "
            "555-01xx test number format. Real phone numbers are prohibited in "
            "skill tests and demonstrations (per repository rule PR #288)."
        )

    if is_calibrating:
        return EntrainmentResult(
            caller_number=caller_number,
            caller_features=caller,
            agent_features=agent,
            entrainment_score=0.0,
            status=EntrainmentStatus.CALIBRATING,
            directive=TTSDirective(),  # No adjustment during calibration
        )

    score = compute_entrainment_score(caller, agent)

    if score >= OPTIMAL_CEILING:
        status = EntrainmentStatus.OPTIMAL
    elif score >= TARGET_THRESHOLD:
        status = EntrainmentStatus.TARGET_REACHED
    else:
        status = EntrainmentStatus.LOW_ENTRAINMENT

    directive = generate_tts_directive(caller, agent, score, mode)

    return EntrainmentResult(
        caller_number=caller_number,
        caller_features=caller,
        agent_features=agent,
        entrainment_score=round(score, 4),
        status=status,
        directive=directive,
    )
