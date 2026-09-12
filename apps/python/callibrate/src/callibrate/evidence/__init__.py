"""Deterministic readings of a finished call. No model runs in this package."""

from callibrate.evidence.readback import ReadbackEvidence, affirms, corroborate, covers_value
from callibrate.evidence.reconcile import build_evidence, scan_safety
from callibrate.evidence.transcript import (
    NormalizedTurn,
    disclosure_spoken,
    normalize_turns,
    speaker_role,
    spoken_schedule,
)

__all__ = [
    "NormalizedTurn",
    "ReadbackEvidence",
    "affirms",
    "build_evidence",
    "corroborate",
    "covers_value",
    "disclosure_spoken",
    "normalize_turns",
    "scan_safety",
    "speaker_role",
    "spoken_schedule",
]
