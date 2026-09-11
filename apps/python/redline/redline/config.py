"""Read ``redline.yaml``: which agent to test, with what, and how.

The config file is the one thing a user writes by hand, so it is small and it
fails loudly. Everything in it has a default except the subject's goal, because
the goal *is* the thing under test and there is nothing sensible to guess.

Two rules the file cannot break, whatever it says:

* **The transport defaults to ``static``.** A config that dials by accident is a
  config that costs money and rings a stranger's phone. Live calls are opted
  into on the command line, per run, not left switched on in a file somebody
  committed months ago.
* **No credential lives here.** The API key is read from the environment. This
  file is meant to be committed; ``.env`` is not.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import jsonschema
import yaml

from redline.data_policy import DataPolicy
from redline.subject import SubjectUnderTest

__all__ = ["CONFIG_FILENAME", "Config", "ConfigError", "load_config"]

CONFIG_FILENAME = "redline.yaml"

DEFAULT_SCENARIOS_DIR = "scenarios"
DEFAULT_BENIGN_DIR = "benign"
DEFAULT_OUTPUT_DIR = ".redline"
DEFAULT_FIXTURES_DIR = "fixtures/calle"

CONFIG_SCHEMA: Mapping[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "REDLINE configuration",
    "type": "object",
    "additionalProperties": False,
    "required": ["subject"],
    "properties": {
        "subject": {
            "type": "object",
            "additionalProperties": False,
            "required": ["goal"],
            "properties": {
                "name": {"type": "string", "minLength": 1, "maxLength": 80},
                "goal": {
                    "type": "string",
                    "minLength": 1,
                    "description": (
                        "The natural-language task you send to CALL-E. This is "
                        "the thing being tested."
                    ),
                },
                "result_schema": {
                    "description": (
                        "A JSON Schema object, or a path to a .json file holding one."
                    ),
                    "type": ["object", "string", "null"],
                },
                "recipient_result_schema": {"type": ["object", "string", "null"]},
                "context": {
                    "type": "object",
                    "description": (
                        "Reference values the agent is told before the call. "
                        "Never put a real phone number or credential here."
                    ),
                    "additionalProperties": {"type": "string"},
                },
                "data_policy": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "context": {
                            "type": "object",
                            "additionalProperties": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["classification", "disclose_after"],
                                "properties": {
                                    "classification": {
                                        "enum": ["public", "sensitive", "prohibited"]
                                    },
                                    "disclose_after": {
                                        "enum": [
                                            "anyone",
                                            "verified_recipient",
                                            "never",
                                        ]
                                    },
                                },
                            },
                        },
                        "results": {
                            "type": "object",
                            "additionalProperties": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["evidence"],
                                "properties": {
                                    "evidence": {
                                        "enum": [
                                            "none",
                                            "callee_statement",
                                            "verified_recipient_statement",
                                        ]
                                    },
                                    "on_missing": {
                                        "type": "string",
                                        "minLength": 1,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        "scenarios": {
            "type": "string",
            "description": "Directory or file holding the attack catalogue.",
        },
        "benign": {
            "type": "string",
            "description": (
                "Directory holding legitimate calls the agent must still "
                "handle after a patch. Absent means the price of hardening is "
                "not measured, and the report says so rather than reporting "
                "zero."
            ),
        },
        "output_dir": {"type": "string"},
        "fixtures": {"type": "string"},
        "only": {
            "type": "array",
            "description": "Restrict runs to these scenario ids or families.",
            "items": {"type": "string"},
        },
    },
}


class ConfigError(ValueError):
    """``redline.yaml`` could not be read, with enough detail to fix it."""


@dataclass(frozen=True, slots=True)
class Config:
    """A resolved configuration, with every path made absolute."""

    subject: SubjectUnderTest
    scenarios_dir: Path
    benign_dir: Path
    output_dir: Path
    fixtures_dir: Path
    only: tuple[str, ...] = ()
    source_path: Path | None = None
    extras: Mapping[str, Any] = field(default_factory=dict)

    @property
    def root(self) -> Path:
        return (self.source_path.parent if self.source_path else Path.cwd()).resolve()


def load_config(path: Path) -> Config:
    """Read and validate a configuration file."""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise ConfigError(
            f"{path}: not found. Run `redline init` to create one."
        ) from error
    except OSError as error:
        raise ConfigError(f"{path}: cannot be read: {error}") from error

    try:
        document = yaml.safe_load(text)
    except yaml.YAMLError as error:
        raise ConfigError(f"{path}: is not valid YAML: {error}") from error

    if not isinstance(document, Mapping):
        raise ConfigError(f"{path}: expected a YAML mapping at the top level")

    _validate(document, path)

    root = path.parent.resolve()
    block = document["subject"]

    context = dict(block.get("context") or {})
    result_schema = _resolve_schema(block.get("result_schema"), root, path)
    recipient_result_schema = _resolve_schema(
        block.get("recipient_result_schema"), root, path
    )
    schema = result_schema or recipient_result_schema or {}
    properties = schema.get("properties")
    result_fields = set(properties) if isinstance(properties, Mapping) else set()

    try:
        data_policy = DataPolicy.from_mapping(
            block.get("data_policy"),
            context_fields=set(context),
            result_fields=result_fields,
        )
        subject = SubjectUnderTest(
            name=block.get("name") or path.parent.name or "subject",
            goal=block["goal"],
            result_schema=result_schema,
            recipient_result_schema=recipient_result_schema,
            context=context,
            data_policy=data_policy,
        )
    except ValueError as error:
        raise ConfigError(f"{path}: {error}") from error

    return Config(
        subject=subject,
        scenarios_dir=_resolve_dir(
            document.get("scenarios", DEFAULT_SCENARIOS_DIR), root
        ),
        benign_dir=_resolve_dir(document.get("benign", DEFAULT_BENIGN_DIR), root),
        output_dir=_resolve_dir(document.get("output_dir", DEFAULT_OUTPUT_DIR), root),
        fixtures_dir=_resolve_dir(document.get("fixtures", DEFAULT_FIXTURES_DIR), root),
        only=tuple(document.get("only", ())),
        source_path=path,
    )


def _validate(document: Mapping[str, Any], path: Path) -> None:
    validator = jsonschema.Draft202012Validator(CONFIG_SCHEMA)
    errors = sorted(validator.iter_errors(document), key=lambda e: list(e.path))
    if not errors:
        return
    lines = [f"{path}: {len(errors)} problem(s):"]
    for error in errors:
        location = ".".join(str(part) for part in error.absolute_path) or "<root>"
        lines.append(f"  {location}: {error.message}")
    raise ConfigError("\n".join(lines))


def _resolve_dir(value: Any, root: Path) -> Path:
    candidate = Path(str(value))
    return candidate if candidate.is_absolute() else (root / candidate).resolve()


def _resolve_schema(
    value: Any, root: Path, config_path: Path
) -> Mapping[str, Any] | None:
    """Accept an inline schema or a path to one.

    A path is worth supporting because a real project already has its schema in
    a file that the application itself loads -- and a schema copied into a
    second place is a schema that drifts.
    """
    if value is None:
        return None
    if isinstance(value, Mapping):
        return dict(value)

    schema_path = _resolve_dir(value, root)
    try:
        loaded = json.loads(schema_path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ConfigError(
            f"{config_path}: result schema {value!r} was not found at {schema_path}"
        ) from error
    except OSError as error:
        raise ConfigError(
            f"{config_path}: {schema_path} cannot be read: {error}"
        ) from error
    except json.JSONDecodeError as error:
        raise ConfigError(
            f"{config_path}: {schema_path} is not valid JSON: {error}"
        ) from error

    if not isinstance(loaded, Mapping):
        raise ConfigError(f"{config_path}: {schema_path} must hold a JSON object")
    return dict(loaded)
