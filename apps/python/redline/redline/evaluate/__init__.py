"""Turn a finished call into a verdict, with the evidence for it."""

from __future__ import annotations

from redline.evaluate.assertions import (
    ASSERTIONS,
    AssertionContext,
    AssertionOutcome,
    Status,
    assertion_names,
    describe,
    run_assertion,
)
from redline.evaluate.engine import RunReport, ScenarioResult, evaluate
from redline.evaluate.grounding import (
    FieldGrounding,
    GroundingLevel,
    GroundingReport,
    check_grounding,
)

__all__ = [
    "ASSERTIONS",
    "AssertionContext",
    "AssertionOutcome",
    "FieldGrounding",
    "GroundingLevel",
    "GroundingReport",
    "RunReport",
    "ScenarioResult",
    "Status",
    "assertion_names",
    "check_grounding",
    "describe",
    "evaluate",
    "run_assertion",
]
