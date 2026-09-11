"""Score how likely a stated 'yes' is to become an actual show-up.

A stated yes is a noisy signal, not a confirmation -- acquiescence bias means
people agree to be pleasant and then don't follow through. This module reads
the evidence text CALL-E extracts from the transcript (or the simulator's
synthetic equivalent) and turns hedging vs. firm language into a calibrated
probability, combined with the candidate's prior show-up rate.

The calibration curve here is hand-tuned from the phrase patterns used in
generation (mobilize/sim/population.py) and validated against the simulator's
known ground truth in the evaluation harness (mobilize/sim/harness.py). It is
NOT a claim about real human speech patterns beyond what the reality
validation step (real CALL-E calls checked against these scores) confirms.
"""

from __future__ import annotations

import re

FIRM_MARKERS = [
    r"\bleaving\b", r"\bon my way\b", r"\bright now\b", r"\bnow\b",
    r"\babsolutely\b", r"\bdefinitely\b", r"\bfor sure\b", r"\bgrabbing my keys\b",
]
HEDGE_MARKERS = [
    r"\bi'?ll try\b", r"\bmaybe\b", r"\bprobably\b", r"\bi think\b",
    r"\bsee what i can do\b", r"\bif i can\b", r"\bshould be able\b",
    r"\bmight\b", r"\bwe'?ll see\b",
]


def score_commitment_text(evidence: str) -> float:
    """Return a 0..1 firmness score from evidence text alone (language only)."""
    text = evidence.lower()
    firm_hits = sum(1 for pat in FIRM_MARKERS if re.search(pat, text))
    hedge_hits = sum(1 for pat in HEDGE_MARKERS if re.search(pat, text))

    if firm_hits == 0 and hedge_hits == 0:
        return 0.5  # neutral phrasing, no signal either way

    raw = firm_hits - hedge_hits
    # squash to (0, 1), centered at 0.5, saturating for strongly worded evidence
    return _sigmoid(raw * 0.9)


def calibrated_commitment(
    *,
    evidence: str,
    candidate_prior_showup_rate: float,
    language_weight: float = 0.6,
) -> float:
    """Combine language-derived firmness with the candidate's historical prior.

    language_weight controls how much the transcript wording (vs. the prior)
    drives the final score. Tunable; the evaluation harness sweeps this.
    """
    language_score = score_commitment_text(evidence)
    return language_weight * language_score + (1 - language_weight) * candidate_prior_showup_rate


def _sigmoid(x: float) -> float:
    import math

    return 1.0 / (1.0 + math.exp(-x))
