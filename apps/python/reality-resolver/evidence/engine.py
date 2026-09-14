"""Combines the four evidence rules into a single decision-critical
uncertainty verdict.

Per the architecture: a structured source asserts a state (R1), a
human source diverges from it (R2), nothing fresher has resolved that
divergence (R3), and the decision has a near deadline (R4). All four
true means the uncertainty is decision-critical - a call may be
justified. Any one false means it is not - see resolver.py, which
treats "not decision-critical" as NO_CALL_NEEDED without ever reaching
the compliance gate or CALL-E.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from .model import EvidenceMatrix
from .rules import (
    RuleResult,
    r1_structured_state,
    r2_human_qualification,
    r3_unresolved_evidence,
    r4_decision_deadline,
)


@dataclass(frozen=True)
class ReasoningResult:
    rules: tuple[RuleResult, ...]
    decision_critical: bool


def evaluate(matrix: EvidenceMatrix, deadline: datetime, now: datetime, threshold: timedelta) -> ReasoningResult:
    rules = (
        r1_structured_state(matrix),
        r2_human_qualification(matrix),
        r3_unresolved_evidence(matrix),
        r4_decision_deadline(deadline, now, threshold),
    )
    return ReasoningResult(rules=rules, decision_critical=all(rule.triggered for rule in rules))
