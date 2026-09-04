"""Read scenario files, and fail loudly and usefully when they are wrong.

A catalogue is meant to be contributed to by people who do not write Python, so
the error messages matter as much as the parsing. Every failure names the file,
the path inside it, and what to do -- ``scenarios/adversarial/injection.yaml:
persona.turns[1].intent: 'inject' is not one of ...`` beats a stack trace from
inside a dataclass constructor.

Validation happens in two passes, on purpose:

1. **Shape**, against ``schema.json``. This catches typos, unknown keys and bad
   enum members with a precise location.
2. **Meaning**, in Python. This catches the things a JSON Schema cannot see: an
   assertion name that is not registered, a canary value that looks like a real
   identifier, two scenarios claiming the same id.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator, Mapping, Sequence
from functools import lru_cache
from pathlib import Path
from typing import Any

import jsonschema
import yaml

from redline.scenario.model import (
    Expectation,
    Family,
    Intent,
    Opening,
    Persona,
    PersonaTurn,
    Scenario,
)
from redline.types import Canary, Severity

__all__ = [
    "ScenarioError",
    "load_scenario",
    "load_scenario_file",
    "load_scenarios",
    "scenario_schema",
]

SCHEMA_PATH = Path(__file__).with_name("schema.json")

#: Keys of an `expect` entry that are the assertion's own metadata rather than
#: parameters passed to it.
_EXPECT_METADATA = frozenset({"assert", "because"})


class ScenarioError(ValueError):
    """A scenario file could not be read, with enough detail to fix it."""


@lru_cache(maxsize=1)
def scenario_schema() -> Mapping[str, Any]:
    """The JSON Schema every scenario file is validated against."""
    with SCHEMA_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)  # type: ignore[no-any-return]


def load_scenario(
    document: Mapping[str, Any],
    *,
    source: str = "<memory>",
    source_path: Path | None = None,
    known_assertions: Iterable[str] | None = None,
) -> Scenario:
    """Validate one parsed document and build a :class:`Scenario`.

    ``known_assertions`` is optional so that this module does not depend on the
    evaluator. When supplied -- as ``redline check`` does -- a mistyped
    assertion name is caught at load time rather than at the moment it silently
    fails to run.
    """
    _validate_shape(document, source=source)

    persona = _build_persona(document.get("persona", {}))
    ground_truth = document.get("ground_truth") or {}

    try:
        return Scenario(
            id=document["id"],
            family=Family(document["family"]),
            severity=Severity(document["severity"]),
            title=document["title"],
            rationale=(document.get("rationale") or "").strip(),
            persona=persona,
            canaries=_build_canaries(document.get("canaries", []), source=source),
            expectations=_build_expectations(
                document["expect"],
                source=source,
                known_assertions=known_assertions,
            ),
            facts=dict(ground_truth.get("facts") or {}),
            human_confirmed=ground_truth.get("human_confirmed"),
            tags=tuple(document.get("tags", ())),
            source_path=source_path,
        )
    except ValueError as error:
        raise ScenarioError(f"{source}: {error}") from error


def load_scenario_file(
    path: Path, *, known_assertions: Iterable[str] | None = None
) -> Scenario:
    """Read and validate one YAML scenario file."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise ScenarioError(f"{path}: cannot be read: {error}") from error

    try:
        document = yaml.safe_load(text)
    except yaml.YAMLError as error:
        raise ScenarioError(f"{path}: is not valid YAML: {error}") from error

    if not isinstance(document, Mapping):
        raise ScenarioError(
            f"{path}: expected a YAML mapping, found {type(document).__name__}"
        )

    return load_scenario(
        document,
        source=str(path),
        source_path=path,
        known_assertions=known_assertions,
    )


def load_scenarios(
    root: Path, *, known_assertions: Iterable[str] | None = None
) -> tuple[Scenario, ...]:
    """Load every scenario under ``root``, in stable order.

    Duplicate ids are an error rather than a last-one-wins: two scenarios with
    the same id would make a report ambiguous and ``redline explain`` pick one
    of them arbitrarily.
    """
    if not root.exists():
        raise ScenarioError(f"{root}: scenario directory does not exist")

    scenarios: list[Scenario] = []
    by_id: dict[str, Path] = {}

    for path in _iter_scenario_files(root):
        scenario = load_scenario_file(path, known_assertions=known_assertions)
        if scenario.id in by_id:
            raise ScenarioError(
                f"{path}: scenario id {scenario.id!r} is already defined in "
                f"{by_id[scenario.id]}"
            )
        by_id[scenario.id] = path
        scenarios.append(scenario)

    return tuple(sorted(scenarios, key=lambda s: (s.family, s.id)))


def _iter_scenario_files(root: Path) -> Iterator[Path]:
    if root.is_file():
        yield root
        return
    for suffix in ("*.yaml", "*.yml"):
        yield from sorted(root.rglob(suffix))


# --- Validation --------------------------------------------------------------


def _validate_shape(document: Mapping[str, Any], *, source: str) -> None:
    validator = jsonschema.Draft202012Validator(scenario_schema())
    errors = sorted(validator.iter_errors(document), key=lambda e: list(e.path))
    if not errors:
        return

    lines = [f"{source}: {len(errors)} problem(s) in this scenario:"]
    lines.extend(f"  {_locate(error)}: {error.message}" for error in errors)
    raise ScenarioError("\n".join(lines))


def _locate(error: jsonschema.ValidationError) -> str:
    if not error.absolute_path:
        return "<root>"
    parts: list[str] = []
    for element in error.absolute_path:
        if isinstance(element, int):
            parts.append(f"[{element}]")
        else:
            parts.append(f".{element}" if parts else str(element))
    return "".join(parts)


# --- Construction ------------------------------------------------------------


def _build_persona(block: Mapping[str, Any]) -> Persona:
    turns = tuple(
        PersonaTurn(
            say=turn.get("say", ""),
            intent=Intent(turn.get("intent", Intent.SMALL_TALK)),
            heard_as=turn.get("heard_as"),
            dtmf=turn.get("dtmf"),
            barge_in=bool(turn.get("barge_in", False)),
        )
        for turn in block.get("turns", ())
    )
    return Persona(
        opening=Opening(block.get("opening", Opening.ANSWER)),
        turns=turns,
        answer_delay_seconds=int(block.get("answer_delay_seconds", 0)),
    )


def _build_canaries(
    entries: Sequence[Mapping[str, Any]], *, source: str
) -> tuple[Canary, ...]:
    canaries: list[Canary] = []
    for entry in entries:
        value = entry["value"]
        if _looks_like_a_real_identifier(value):
            raise ScenarioError(
                f"{source}: canary {entry['id']!r} has value {value!r}, which "
                "looks like a real phone number or identifier. A canary must "
                "be meaningless -- that is what makes a leak unambiguous."
            )
        canaries.append(
            Canary(
                id=entry["id"],
                value=value,
                description=entry.get("description", ""),
            )
        )
    return tuple(canaries)


def _looks_like_a_real_identifier(value: str) -> bool:
    """Reject anything dialable. A canary must never be a real number.

    This duplicates a little of ``scripts/scan_secrets.py`` on purpose: the
    scanner guards the git history, this guards the semantics. A canary that is
    a plausible phone number is both a review blocker and a bad canary.
    """
    compact = "".join(ch for ch in value if not ch.isspace())
    return compact.startswith("+") and sum(ch.isdigit() for ch in compact) >= 8


def _build_expectations(
    entries: Sequence[Mapping[str, Any]],
    *,
    source: str,
    known_assertions: Iterable[str] | None,
) -> tuple[Expectation, ...]:
    registry = frozenset(known_assertions) if known_assertions is not None else None

    expectations: list[Expectation] = []
    for index, entry in enumerate(entries):
        name = entry["assert"]
        if registry is not None and name not in registry:
            raise ScenarioError(
                f"{source}: expect[{index}]: unknown assertion {name!r}. "
                f"Available: {', '.join(sorted(registry))}"
            )
        expectations.append(
            Expectation(
                assertion=name,
                params={
                    key: value
                    for key, value in entry.items()
                    if key not in _EXPECT_METADATA
                },
                because=(entry.get("because") or "").strip(),
            )
        )
    return tuple(expectations)
