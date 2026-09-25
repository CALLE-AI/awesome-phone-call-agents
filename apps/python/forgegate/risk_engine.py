"""Threshold-based risk scoring for incoming incident payloads.

The data contract (see README / PRD) normally carries a pre-computed
`risk_score`. If a payload arrives without one, `_derive_score_from_signals`
falls back to a correlation-style heuristic in the spirit of ForgeSentinel:
an access anomaly *and* an environmental anomaly together score much higher
than either alone, because that combination is what actually indicates a
real incident rather than sensor noise.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

DEFAULT_THRESHOLD = float(os.environ.get("FORGEGATE_RISK_THRESHOLD", "0.7"))

RESTRICTED_ZONE_PREFIX = "zone_"
GAS_PPM_ANOMALY = 300
TEMP_C_ANOMALY = 38.0


@dataclass
class RiskAssessment:
    score: float
    threshold: float
    crossed: bool


def _derive_score_from_signals(signals: dict) -> float:
    score = 0.0
    zone = signals.get("rfid_zone")
    gas_ppm = signals.get("gas_ppm")
    temp_c = signals.get("temp_c")

    zone_flag = bool(zone) and str(zone).startswith(RESTRICTED_ZONE_PREFIX)
    gas_flag = isinstance(gas_ppm, (int, float)) and gas_ppm >= GAS_PPM_ANOMALY
    temp_flag = isinstance(temp_c, (int, float)) and temp_c >= TEMP_C_ANOMALY

    if zone_flag:
        score += 0.35
    if gas_flag:
        score += 0.35
    if temp_flag:
        score += 0.25
    if zone_flag and (gas_flag or temp_flag):
        # correlation bonus: access + environmental anomaly together is the
        # actual signal ForgeGate cares about, not either one in isolation.
        score += 0.2

    return min(score, 1.0)


def evaluate(payload: dict, threshold: Optional[float] = None) -> RiskAssessment:
    threshold = DEFAULT_THRESHOLD if threshold is None else threshold

    raw_score = payload.get("risk_score")
    if raw_score is not None:
        score = float(raw_score)
    else:
        score = _derive_score_from_signals(payload.get("signals", {}) or {})

    score = max(0.0, min(1.0, score))
    return RiskAssessment(score=score, threshold=threshold, crossed=score >= threshold)
