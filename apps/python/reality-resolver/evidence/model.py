"""Evidence and Case data model for the Reality Resolver decision engine.

A Case bundles the evidence relevant to one decision-critical question
(for example "will this appointment happen?") with the deadline by
which the decision must be made, the proximity threshold that makes
that deadline "close" (R4), and the case-specific action labels the
verdict maps to (see verdict.py). Nothing case-specific belongs in
evidence/rules.py or evidence/engine.py - every case-specific number or
label lives here, loaded from JSON.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Any

from client import parse_utc_timestamp


class EvidenceType(Enum):
    STRUCTURED = "structured"
    HUMAN = "human"
    ABSENCE = "absence"


class Ambiguity(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass(frozen=True)
class Evidence:
    source: str
    type: EvidenceType
    freshness: timedelta  # how long ago this evidence was captured
    claim: str
    ambiguity: Ambiguity


@dataclass(frozen=True)
class EvidenceMatrix:
    items: tuple[Evidence, ...]

    def of_type(self, evidence_type: EvidenceType) -> tuple[Evidence, ...]:
        return tuple(item for item in self.items if item.type == evidence_type)


@dataclass(frozen=True)
class Case:
    """One decision-critical question and everything needed to resolve it.

    decision_deadline_threshold and decision_options are case-specific
    data, not engine defaults - see evidence/rules.py's R4 docstring for
    why nothing arbitrary lives in the generic engine.
    """

    name: str
    evidence: EvidenceMatrix
    deadline: datetime  # absolute UTC timestamp
    decision_deadline_threshold: timedelta
    decision_options: dict[str, str]  # e.g. {"if_confirmed": "KEEP_SLOT", "if_cancelled": "RELEASE_SLOT"} - the unresolved/blocked/no-call actions are fixed engine constants (verdict.ACTION_*), not case data
    call_phone: str
    call_task_hint: str


def load_case(path: str | Path) -> Case:
    data: dict[str, Any] = json.loads(Path(path).read_text(encoding="utf-8"))
    evidence_items = tuple(
        Evidence(
            source=item["source"],
            type=EvidenceType(item["type"]),
            freshness=timedelta(hours=item["freshness_hours"]),
            claim=item["claim"],
            ambiguity=Ambiguity(item["ambiguity"]),
        )
        for item in data["evidence"]
    )
    return Case(
        name=data["name"],
        evidence=EvidenceMatrix(evidence_items),
        deadline=parse_utc_timestamp(data["deadline"]),
        decision_deadline_threshold=timedelta(hours=data["decision_deadline_threshold_hours"]),
        decision_options=data["decision_options"],
        call_phone=data["call_phone"],
        call_task_hint=data["call_task_hint"],
    )
