"""Loader for outcome-code-map.yaml.

This module reads the mapping table and answers questions about it. It holds no
semantics of its own: every outcome name it can return comes from the table.
Grep for an outcome name and you should find it in the table and in
`record.OUTCOMES`, nowhere else.

Hard rules enforced here:

* An entry marked `documented: false` is a load error. Undocumented values
  belong in `unmappable`, which never produces a semantic outcome.
* An unknown match key never falls through to a default outcome.
* A malformed table fails loudly at load time rather than silently degrading.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

import yaml

from record import MAPPABLE_OUTCOMES, UNRESOLVED_REASONS

DEFAULT_MAP_FILENAME = "outcome-code-map.yaml"
MAP_PATH_ENV_VAR = "CALLE_OUTCOME_MAP"
SUPPORTED_SCHEMA_VERSION = 1
SUPPORTED_PREDICATES = ("equals", "in", "absent", "absent_or_empty")


class MappingError(Exception):
    """Raised when the mapping table is malformed or internally inconsistent."""


@dataclass(frozen=True)
class Surface:
    name: str
    title: str
    documented: bool
    contract_ref: str | None
    status_field: str
    non_terminal_values: tuple[str, ...]
    terminal_values: tuple[str, ...]
    terminal_values_source: str | None


@dataclass(frozen=True)
class Entry:
    """A documented case. The only source of a semantic outcome."""

    id: str
    surface: str
    match: Mapping[str, Any]
    outcome: str
    source: str


@dataclass(frozen=True)
class Unmappable:
    """A published value that carries no documented outcome meaning."""

    id: str
    surface: str
    match: Mapping[str, Any]
    reason: str
    note: str
    source: str | None = None
    issue_ref: int | None = None


@dataclass(frozen=True)
class Guard:
    """A documented self-contradiction. Fires before mapping."""

    id: str
    surface: str
    when: tuple[Mapping[str, Any], ...]
    reason: str
    note: str
    issue_ref: int | None = None


def default_map_path() -> Path:
    """Resolve the mapping table.

    Order: explicit environment override, then the copy shipped beside this
    module. The table is synchronised from the skill by
    `skills/call-outcome-reconciler/scripts/sync-mapping.mjs`; `test_mapping.py`
    fails if the two copies drift.
    """
    override = os.environ.get(MAP_PATH_ENV_VAR)
    if override:
        return Path(override)
    return Path(__file__).resolve().parent / DEFAULT_MAP_FILENAME


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise MappingError(message)


def _matches(match: Mapping[str, Any], payload: Mapping[str, Any]) -> bool:
    """Every declared key must be present and equal. No partial or fuzzy match."""
    for key, expected in match.items():
        if key not in payload:
            return False
        if payload[key] != expected:
            return False
    return True


def _predicate_holds(clause: Mapping[str, Any], payload: Mapping[str, Any]) -> bool:
    field_name = clause["field"]
    present = field_name in payload
    value = payload.get(field_name)
    if "equals" in clause:
        return present and value == clause["equals"]
    if "in" in clause:
        return present and value in clause["in"]
    if "absent" in clause:
        return (not present) == bool(clause["absent"])
    if "absent_or_empty" in clause:
        empty = (not present) or value in (None, "", [], {})
        return empty == bool(clause["absent_or_empty"])
    return False


class OutcomeMap:
    """An in-memory view of the mapping table."""

    def __init__(self, raw: Mapping[str, Any], path: Path | None = None) -> None:
        self.path = path
        self._raw = raw
        self.map_version: str = str(raw.get("map_version", ""))
        self.upstream_contract_ref: str | None = raw.get("upstream_contract_ref")
        self.upstream_contract_version: str | None = raw.get("upstream_contract_version")
        self.surfaces: dict[str, Surface] = {}
        self.entries: list[Entry] = []
        self.unmappable: list[Unmappable] = []
        self.guards: list[Guard] = []
        self._validate_and_build(raw)

    # -- loading ----------------------------------------------------------

    @classmethod
    def load(cls, path: Path | None = None) -> "OutcomeMap":
        resolved = path or default_map_path()
        try:
            text = resolved.read_text(encoding="utf-8")
        except OSError as exc:
            raise MappingError(f"Cannot read mapping table at {resolved}: {exc}") from exc
        try:
            raw = yaml.safe_load(text)
        except yaml.YAMLError as exc:
            raise MappingError(f"Mapping table at {resolved} is not valid YAML: {exc}") from exc
        _require(isinstance(raw, dict), f"Mapping table at {resolved} must be a mapping")
        return cls(raw, path=resolved)

    def _validate_and_build(self, raw: Mapping[str, Any]) -> None:
        version = raw.get("schema_version")
        _require(
            version == SUPPORTED_SCHEMA_VERSION,
            f"Unsupported mapping schema_version {version!r}; expected {SUPPORTED_SCHEMA_VERSION}",
        )
        _require(bool(self.map_version), "Mapping table is missing map_version")

        surfaces = raw.get("surfaces")
        _require(isinstance(surfaces, dict) and bool(surfaces), "Mapping table declares no surfaces")
        for name, body in surfaces.items():
            _require(isinstance(body, dict), f"Surface {name!r} must be a mapping")
            polling = body.get("polling") or {}
            _require(isinstance(polling, dict), f"Surface {name!r} has a malformed polling block")
            status_field = body.get("status_field")
            _require(
                isinstance(status_field, str) and bool(status_field),
                f"Surface {name!r} must declare a status_field",
            )
            self.surfaces[name] = Surface(
                name=name,
                title=str(body.get("title", name)),
                documented=bool(body.get("documented", False)),
                contract_ref=body.get("contract_ref"),
                status_field=status_field,
                non_terminal_values=tuple(polling.get("non_terminal_values") or ()),
                terminal_values=tuple(polling.get("terminal_values") or ()),
                terminal_values_source=polling.get("terminal_values_source"),
            )

        seen_ids: set[str] = set()

        def claim_id(candidate: Any, kind: str) -> str:
            _require(isinstance(candidate, str) and bool(candidate), f"{kind} is missing an id")
            _require(candidate not in seen_ids, f"Duplicate id in mapping table: {candidate}")
            seen_ids.add(candidate)
            return candidate

        for item in raw.get("entries") or []:
            _require(isinstance(item, dict), "Every entry must be a mapping")
            entry_id = claim_id(item.get("id"), "Entry")
            surface = item.get("surface")
            _require(
                surface in self.surfaces,
                f"Entry {entry_id} names unknown surface {surface!r}",
            )
            _require(
                item.get("documented") is True,
                f"Entry {entry_id} is not marked documented: true. "
                "Undocumented values belong in the unmappable section; "
                "this layer never maps an undocumented value to an outcome.",
            )
            outcome = item.get("outcome")
            _require(
                outcome in MAPPABLE_OUTCOMES,
                f"Entry {entry_id} declares unmappable outcome {outcome!r}; "
                f"expected one of {', '.join(MAPPABLE_OUTCOMES)}",
            )
            match = item.get("match")
            _require(
                isinstance(match, dict) and bool(match),
                f"Entry {entry_id} must declare a non-empty match block",
            )
            source = item.get("source")
            _require(
                isinstance(source, str) and bool(source),
                f"Entry {entry_id} must cite a source for the documented case",
            )
            self.entries.append(
                Entry(id=entry_id, surface=surface, match=dict(match), outcome=outcome, source=source)
            )

        for item in raw.get("unmappable") or []:
            _require(isinstance(item, dict), "Every unmappable item must be a mapping")
            item_id = claim_id(item.get("id"), "Unmappable item")
            surface = item.get("surface")
            _require(
                surface in self.surfaces,
                f"Unmappable item {item_id} names unknown surface {surface!r}",
            )
            reason = item.get("reason")
            _require(
                reason in UNRESOLVED_REASONS,
                f"Unmappable item {item_id} declares unknown reason {reason!r}",
            )
            match = item.get("match")
            _require(
                isinstance(match, dict) and bool(match),
                f"Unmappable item {item_id} must declare a non-empty match block",
            )
            self.unmappable.append(
                Unmappable(
                    id=item_id,
                    surface=surface,
                    match=dict(match),
                    reason=reason,
                    note=str(item.get("note", "")),
                    source=item.get("source"),
                    issue_ref=item.get("issue_ref"),
                )
            )

        for item in raw.get("consistency_guards") or []:
            _require(isinstance(item, dict), "Every consistency guard must be a mapping")
            guard_id = claim_id(item.get("id"), "Consistency guard")
            surface = item.get("surface")
            _require(
                surface in self.surfaces,
                f"Guard {guard_id} names unknown surface {surface!r}",
            )
            reason = item.get("reason")
            _require(
                reason in UNRESOLVED_REASONS,
                f"Guard {guard_id} declares unknown reason {reason!r}",
            )
            clauses = item.get("when")
            _require(
                isinstance(clauses, list) and bool(clauses),
                f"Guard {guard_id} must declare a non-empty when block",
            )
            for clause in clauses:
                _require(isinstance(clause, dict), f"Guard {guard_id} has a malformed clause")
                _require("field" in clause, f"Guard {guard_id} has a clause without a field")
                used = [p for p in SUPPORTED_PREDICATES if p in clause]
                _require(
                    len(used) == 1,
                    f"Guard {guard_id} clause on {clause.get('field')!r} must use exactly one of "
                    f"{', '.join(SUPPORTED_PREDICATES)}",
                )
            self.guards.append(
                Guard(
                    id=guard_id,
                    surface=surface,
                    when=tuple(dict(c) for c in clauses),
                    reason=reason,
                    note=str(item.get("note", "")),
                    issue_ref=item.get("issue_ref"),
                )
            )

    # -- queries ----------------------------------------------------------

    def knows_surface(self, surface: str) -> bool:
        return surface in self.surfaces

    def status_value(self, surface: str, payload: Mapping[str, Any]) -> str | None:
        declared = self.surfaces.get(surface)
        if declared is None:
            return None
        value = payload.get(declared.status_field)
        return value if isinstance(value, str) else None

    def is_terminal(self, surface: str, payload: Mapping[str, Any]) -> bool:
        """Whether polling should stop. Operational only, not a semantic claim."""
        declared = self.surfaces.get(surface)
        if declared is None:
            return False
        value = self.status_value(surface, payload)
        if value is None:
            return False
        if value in declared.non_terminal_values:
            return False
        return value in declared.terminal_values

    def failing_guard(self, surface: str, payload: Mapping[str, Any]) -> Guard | None:
        for guard in self.guards:
            if guard.surface != surface:
                continue
            if all(_predicate_holds(clause, payload) for clause in guard.when):
                return guard
        return None

    def lookup(self, surface: str, payload: Mapping[str, Any]) -> Entry | None:
        for entry in self.entries:
            if entry.surface == surface and _matches(entry.match, payload):
                return entry
        return None

    def find_unmappable(self, surface: str, payload: Mapping[str, Any]) -> Unmappable | None:
        for item in self.unmappable:
            if item.surface == surface and _matches(item.match, payload):
                return item
        return None
