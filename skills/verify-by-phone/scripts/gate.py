#!/usr/bin/env python3
"""The abstention gate: one definition, shared by every script in this skill.

Standard library only. Split conformal prediction with the finite-sample
correction: with a calibration fold of size n and miscoverage level alpha, the
prediction set built from the ceil((n+1)(1-alpha))/n quantile of calibration
nonconformity scores contains the true label with probability at least 1 - alpha
on exchangeable data. The system answers only when that set is a single value
and that value is not "unknown".

This file exists because the rule was previously written twice: calibrate.py
computed a conformal threshold while extract_answer.py gated on an unrelated
hardcoded 0.65, so the abstention the skill advertised was not the abstention it
performed. Two copies of a rule are two rules.
"""

from __future__ import annotations

import math

CLASSES = ("yes", "no", "unknown")


def class_scores(answer: str, trust: float) -> dict[str, float]:
    """Spread a scored answer across the label space.

    Mirrors ExtractionResult.class_scores in the reference implementation:
    an explicit unknown splits its residual mass evenly across yes and no,
    a polar answer keeps more residual mass on unknown than on its opposite.
    """
    if answer == "unknown":
        return {"yes": (1 - trust) / 2, "no": (1 - trust) / 2, "unknown": trust}
    other = 1 - trust
    scores = {"yes": other * 0.4, "no": other * 0.4, "unknown": other * 0.6}
    scores[answer] = trust
    return scores


def conformal_quantile(cal_nonconformity: list[float], alpha: float) -> float:
    """The finite-sample-corrected (1 - alpha) quantile of calibration scores."""
    if not cal_nonconformity:
        raise ValueError("empty calibration fold")
    if not 0 < alpha < 1:
        raise ValueError("alpha must be in (0, 1)")
    ordered = sorted(cal_nonconformity)
    n = len(ordered)
    rank = math.ceil((n + 1) * (1 - alpha))
    return float("inf") if rank > n else ordered[rank - 1]


def nonconformity(scores: dict[str, float], true_label: str) -> float:
    return 1.0 - scores[true_label]


def prediction_set(scores: dict[str, float], qhat: float) -> set[str]:
    return {label for label in CLASSES if 1.0 - scores[label] <= qhat}


def abstains(scores: dict[str, float], answer: str, qhat: float) -> bool:
    """Answer only when the calibrated set is a singleton that IS the answer.

    Three conditions, all meaning "do not answer":
      1. the prediction set is not a single value,
      2. that single value is not the answer we are about to report,
      3. the answer is "unknown".

    Condition 2 is the one that is easy to omit and was omitted here. Testing
    `len(pset) != 1 or answer == "unknown"` compares the SIZE of the set
    against the EXTRACTED answer without ever checking that they agree, so a
    low-trust polar answer whose calibrated set is exactly {"unknown"} passed
    both checks and was served as a confident "yes". The set said the only
    plausible label was unknown; the gate answered anyway. Reported by a
    maintainer during upstream review of this skill.

    The reference harness never hit this because it derives the answer as the
    argmax of the scores, and the argmax is "unknown" throughout the region
    where the set is {"unknown"}. Extraction does not use the argmax, so the
    skill could hit it and the harness could not. A gate must not depend on
    which caller it has.
    """
    pset = prediction_set(scores, qhat)
    return pset != {answer} or answer == "unknown"
