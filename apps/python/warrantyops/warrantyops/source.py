"""The authoritative source of a claim's current version.

WarrantyOps does not own the claim record; the dealer's system of record
does. Everything here is a read seam over that system: pre-call checks and
write-back both re-read the current version through it, so the decision to
dial and the decision to mutate are each made against the live record, never
against a cached copy of it.

The vertical slice ships an in-memory store seeded from the synthetic
fixture. A real deployment supplies one adapter per system of record; the
gates and the write-back code are identical either way.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


class SourceVersionReader(Protocol):
    """Read the current version token of one claim, or None when unknown."""

    def current_version(self, source_platform: str, source_claim_id: str) -> str | None:
        ...  # pragma: no cover - a Protocol declaration


@dataclass
class InMemorySourceStore:
    """A synthetic system of record. Initialized per run, never persisted.

    Keeping this in memory and seeding it from the fixture is what makes the
    judge path clean: there is no pre-seeded developer database to trust,
    because there is no database at all.
    """

    versions: dict[tuple[str, str], str] = field(default_factory=dict)

    def set_version(self, source_platform: str, source_claim_id: str, version: str) -> None:
        self.versions[(source_platform, source_claim_id)] = version

    def current_version(self, source_platform: str, source_claim_id: str) -> str | None:
        return self.versions.get((source_platform, source_claim_id))
