"""Turn findings into a patch, and the wording that patch applies."""

from __future__ import annotations

from redline.remediate.clauses import (
    CLAUSES,
    RATIONALES,
    clause_for,
    rationale_for,
)
from redline.remediate.generator import (
    HARDENING_HEADER,
    Patch,
    Remedy,
    RemedyKind,
    generate_patch,
)

__all__ = [
    "CLAUSES",
    "HARDENING_HEADER",
    "RATIONALES",
    "Patch",
    "Remedy",
    "RemedyKind",
    "clause_for",
    "generate_patch",
    "rationale_for",
]
